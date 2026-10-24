// Local speech: whisper.cpp for ASR (Vulkan build if present, else CPU) and Piper for TTS. Audio is written to a
// temp file only for the duration of one call and always deleted; nothing is retained.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Lang, Pronunciation, SpeechLang, TranscribeResult, Voice } from '../shared/contracts.ts';
import { applyPronunciations, cleanTranscript, toAscii } from '../shared/text.ts';
import { log } from './log.ts';

// Kokoro v1.0 speaker ids in sherpa-onnx's voices.bin (k2-fsa docs, kokoro-multi-lang-v1_0). British voices first.
// English only: the sherpa CLI reads text from its command line in the ANSI code page, so non-ASCII text cannot be passed.
const KOKORO_VOICES: { name: string; sid: number; lang: Lang; label: string }[] = [
  { name: 'bm_george', sid: 26, lang: 'en', label: 'George (British male)' },
  { name: 'bm_daniel', sid: 24, lang: 'en', label: 'Daniel (British male)' },
  { name: 'bm_lewis', sid: 27, lang: 'en', label: 'Lewis (British male)' },
  { name: 'bm_fable', sid: 25, lang: 'en', label: 'Fable (British male)' },
  { name: 'bf_emma', sid: 21, lang: 'en', label: 'Emma (British female)' },
  { name: 'bf_isabella', sid: 22, lang: 'en', label: 'Isabella (British female)' },
  { name: 'am_michael', sid: 16, lang: 'en', label: 'Michael (American male)' },
  { name: 'am_onyx', sid: 17, lang: 'en', label: 'Onyx (American male)' },
];

/** First subfolder of `dir` containing `file` (release archives unpack into a versioned folder). */
function findIn(dir: string, file: string): string | null {
  if (!existsSync(dir)) return null;
  for (const d of readdirSync(dir)) if (existsSync(join(dir, d, file))) return join(dir, d);
  return null;
}

export class Speech {
  readonly whisperGpu: string;
  readonly whisperCpu: string;
  readonly asrModel: string;
  readonly piperDir: string;
  private tmp = join(tmpdir(), 'jarvis-audio');

  constructor(readonly modelsDir: string) {
    this.whisperGpu = join(modelsDir, 'whisper-vulkan/bin/whisper-cli.exe');
    this.whisperCpu = join(modelsDir, 'whisper-bin/x/Release/whisper-cli.exe');
    this.asrModel = join(modelsDir, 'whisper-model/ggml-small-q5_1.bin');
    this.piperDir = join(modelsDir, 'piper-bin/x/piper');
    mkdirSync(this.tmp, { recursive: true });
  }

  get whisperExe() { return existsSync(this.whisperGpu) ? this.whisperGpu : this.whisperCpu; }

  private get sherpaExe() { const d = findIn(join(this.modelsDir, 'sherpa-bin'), 'bin/sherpa-onnx-offline-tts.exe'); return d && join(d, 'bin/sherpa-onnx-offline-tts.exe'); }
  private get kokoroDir() { return findIn(join(this.modelsDir, 'voice-kokoro'), 'voices.bin'); }
  get kokoroAvailable() { return !!this.sherpaExe && !!this.kokoroDir; }

  voices(): Voice[] {
    const out: Voice[] = this.kokoroAvailable ? KOKORO_VOICES.map((v) => ({ id: `kokoro-${v.name}`, lang: v.lang, label: `Kokoro · ${v.label}` })) : [];
    if (!existsSync(this.modelsDir)) return out;
    for (const dir of readdirSync(this.modelsDir).filter((d) => d.startsWith('voice-'))) {
      for (const f of readdirSync(join(this.modelsDir, dir)).filter((f) => f.endsWith('.onnx'))) {
        const id = f.replace(/\.onnx$/, '');
        const lang = id.startsWith('fr') ? 'fr' : id.startsWith('en') ? 'en' : null;
        if (lang) out.push({ id, lang, label: id.replace(/-(medium|low|high|x_low)$/, '').replace(/_/g, ' ') });
      }
    }
    return out;
  }

  private voicePath(id: string) {
    for (const dir of readdirSync(this.modelsDir).filter((d) => d.startsWith('voice-'))) {
      const p = join(this.modelsDir, dir, `${id}.onnx`);
      if (existsSync(p)) return p;
    }
    throw new Error(`voice ${id} not found in ${this.modelsDir}`);
  }

  async transcribe(wav: Buffer, lang: SpeechLang, signal?: AbortSignal): Promise<TranscribeResult> {
    if (!existsSync(this.asrModel)) throw new Error(this.missing('speech-to-text model'));
    const file = join(this.tmp, `${randomUUID()}.wav`);
    writeFileSync(file, wav);
    const t0 = performance.now();
    try {
      const { stdout, stderr } = await run(this.whisperExe, ['-m', this.asrModel, '-f', file, '-l', lang, '-t', '6', '-nt'], { signal, timeoutMs: 120_000 });
      const detected = stderr.match(/auto-detected language: (\w+)/)?.[1];
      const language: Lang | null = lang !== 'auto' ? lang : detected === 'fr' || detected === 'en' ? detected : null;
      return { text: cleanTranscript(stdout), language, ms: Math.round(performance.now() - t0) };
    } finally {
      try { unlinkSync(file); } catch { /* already gone */ }
    }
  }

  async synthesize(text: string, lang: Lang, voiceId: string, rate: number, rules: Pronunciation[], signal?: AbortSignal): Promise<Buffer> {
    if (voiceId.startsWith('kokoro-')) return this.synthesizeKokoro(applyPronunciations(text, lang, rules), voiceId.slice(7), rate, signal);
    const exe = join(this.piperDir, 'piper.exe');
    if (!existsSync(exe)) throw new Error(this.missing('Piper voice engine'));
    const file = join(this.tmp, `${randomUUID()}.wav`);
    try {
      await run(exe, ['-m', this.voicePath(voiceId), '-f', file, '--length_scale', String(+(1 / rate).toFixed(3)), '--espeak_data', join(this.piperDir, 'espeak-ng-data')],
        { input: applyPronunciations(text, lang, rules), cwd: this.piperDir, signal, timeoutMs: 60_000 });
      return readFileSync(file);
    } finally {
      try { unlinkSync(file); } catch { /* already gone */ }
    }
  }

  private async synthesizeKokoro(text: string, name: string, rate: number, signal?: AbortSignal): Promise<Buffer> {
    const v = KOKORO_VOICES.find((k) => k.name === name);
    const exe = this.sherpaExe, dir = this.kokoroDir;
    if (!v) throw new Error(`unknown Kokoro voice ${name}`);
    if (!exe || !dir) throw new Error('Kokoro voice files missing (sherpa-bin / voice-kokoro)');
    const model = ['model.int8.onnx', 'model.onnx'].map((f) => join(dir, f)).find(existsSync);
    if (!model) throw new Error(`Kokoro model missing in ${dir}`);
    const file = join(this.tmp, `${randomUUID()}.wav`);
    const lexicon = join(dir, v.name.startsWith('b') ? 'lexicon-gb-en.txt' : 'lexicon-us-en.txt'); // British voices, British pronunciation
    const ascii = toAscii(text);
    if (!ascii) throw new Error('nothing speakable in English');
    try {
      await run(exe, [`--kokoro-model=${model}`, `--kokoro-voices=${join(dir, 'voices.bin')}`, `--kokoro-tokens=${join(dir, 'tokens.txt')}`, `--kokoro-lexicon=${lexicon}`,
        `--kokoro-length-scale=${+(1 / rate).toFixed(3)}`, '--num-threads=4', `--sid=${v.sid}`, `--output-filename=${file}`, ascii], { signal, timeoutMs: 60_000 });
      return readFileSync(file);
    } finally {
      try { unlinkSync(file); } catch { /* already gone */ }
    }
  }

  private missing(what: string) {
    return `Speech files not found: no ${what} in ${this.modelsDir}. Choose the folder with your speech files (e.g. D:\\Jarvis\\.models) in Settings → Language and voice → Speech files.`;
  }

  health() {
    return {
      modelsDir: this.modelsDir,
      whisper: existsSync(this.whisperExe) ? this.whisperExe : null,
      whisperBackend: existsSync(this.whisperGpu) ? 'vulkan (GPU)' : existsSync(this.whisperCpu) ? 'cpu' : 'missing',
      asrModel: existsSync(this.asrModel) ? this.asrModel : null,
      piper: existsSync(join(this.piperDir, 'piper.exe')),
      kokoro: this.kokoroAvailable,
      voices: this.voices().map((v) => v.id),
    };
  }
}

function run(cmd: string, args: string[], opts: { input?: string; cwd?: string; signal?: AbortSignal; timeoutMs: number }) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, windowsHide: true, signal: opts.signal });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d) => (stderr = (stderr + d).slice(-20_000)));
    const timer = setTimeout(() => child.kill(), opts.timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else {
        log('warn', 'speech process failed', { cmd, code, stderr: stderr.slice(-500) });
        reject(new Error(`${cmd.split(/[\\/]/).pop()} exited with ${code}`));
      }
    });
    if (opts.input !== undefined) child.stdin.end(opts.input, 'utf8');
    else child.stdin.end();
  });
}
