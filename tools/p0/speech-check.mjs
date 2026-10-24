// P0 minimal speech check: Piper speaks each corpus line, whisper.cpp transcribes it back, we score WER and timing.
// Usage: node tools/p0/speech-check.mjs [outDir]   (expects the files in .models/ described in docs/p0)
// Round-trip WER measures TTS intelligibility + ASR together; real-voice ASR is checked separately by the user.
import { spawnSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const M = resolve(import.meta.dirname, '../../.models');
const piperDir = join(M, 'piper-bin/x/piper');
// WHISPER_CLI=.models/whisper-vulkan/bin/whisper-cli.exe for the local Vulkan (GPU) build.
const whisper = resolve(process.env.WHISPER_CLI ?? join(M, 'whisper-bin/x/Release/whisper-cli.exe'));
const asrModel = join(M, 'whisper-model/ggml-small-q5_1.bin');
const voices = { fr: join(M, 'voice-fr/fr_FR-siwis-medium.onnx'), en: join(M, 'voice-en/en_GB-cori-medium.onnx') };
const out = resolve(process.argv[2] ?? join(tmpdir(), 'jarvis-speech-check'));
mkdirSync(out, { recursive: true });

const corpus = [
  ['fr', "Rappelle-moi d'appeler Jean-François demain à 14 h 30."],
  ['fr', 'Le rendez-vous chez le dentiste est le 3 mars 2027.'],
  ['fr', 'Ouvre le fichier rapport final dans le dossier Documents.'],
  ['fr', 'Peux-tu résumer ce PDF en trois points ?'],
  ['fr', 'Lance les tests puis fais un commit sur la branche main.'],
  ['en', 'Schedule a meeting with Sophie on Friday at 9:45 AM.'],
  ['en', 'The total comes to 1,249 dollars and 99 cents, including tax.'],
  ['en', 'Open Visual Studio Code and run npm test.'],
  ['en', 'Remind me to buy croissants at the boulangerie on Rue Saint-Denis.'],
  ['en', "What's the weather in Montréal this weekend?"],
];

// Normalize for scoring: lowercase, strip accents/punctuation, so "14 h 30" vs "14h30" still differ but case/commas don't.
const words = (s) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(/\s+/).filter(Boolean);
function wer(ref, hyp) {
  const r = words(ref), h = words(hyp);
  let prev = Array.from({ length: h.length + 1 }, (_, j) => j);
  for (let i = 1; i <= r.length; i++) {
    const cur = [i];
    for (let j = 1; j <= h.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
    prev = cur;
  }
  return r.length ? prev[h.length] / r.length : 0;
}
assert.equal(wer('a b c', 'a b c'), 0);
assert.equal(wer('a b c d', 'a x c'), 0.5);
assert.equal(wer('Bonjour, Montréal!', 'bonjour montreal'), 0);

const run = (cmd, args, opts) => {
  const t = performance.now();
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} failed (${r.status}): ${(r.stderr || '').slice(-500)}`);
  return { ms: performance.now() - t, stdout: r.stdout };
};

const rows = [];
for (const [i, [lang, text]] of corpus.entries()) {
  const wav = join(out, `${String(i + 1).padStart(2, '0')}-${lang}.wav`);
  const tts = run(join(piperDir, 'piper.exe'), ['-m', voices[lang], '-f', wav, '--espeak_data', join(piperDir, 'espeak-ng-data')], { input: text, cwd: piperDir });
  const audioSec = (statSync(wav).size - 44) / (22050 * 2); // Piper medium voices: 22.05 kHz mono 16-bit
  const transcribe = (l) => run(whisper, ['-m', asrModel, '-f', wav, '-l', l, '-t', '6', '-nt', '-np'], { cwd: out });
  const forced = transcribe(lang);
  const auto = transcribe('auto');
  rows.push({
    i: i + 1, lang, ttsMs: Math.round(tts.ms), audioSec: +audioSec.toFixed(2), ttsRtf: +(tts.ms / 1000 / audioSec).toFixed(2),
    asrMs: Math.round(forced.ms), werForced: +wer(text, forced.stdout).toFixed(2), werAuto: +wer(text, auto.stdout).toFixed(2),
    ref: text, hyp: forced.stdout.trim(), hypAuto: auto.stdout.trim(),
  });
  console.log(`#${i + 1} ${lang} tts ${rows.at(-1).ttsMs}ms (rtf ${rows.at(-1).ttsRtf}) asr ${rows.at(-1).asrMs}ms wer ${rows.at(-1).werForced}/${rows.at(-1).werAuto}`);
  console.log(`   ref : ${text}\n   asr : ${rows.at(-1).hyp}\n   auto: ${rows.at(-1).hypAuto}`);
}

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
const mean = (xs) => +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3);
for (const lang of ['fr', 'en']) {
  const r = rows.filter((x) => x.lang === lang);
  console.log(`${lang}: mean WER forced ${mean(r.map((x) => x.werForced))}, auto ${mean(r.map((x) => x.werAuto))}`);
}
console.log(`TTS ms p50 ${pct(rows.map((r) => r.ttsMs), 0.5)} p95 ${pct(rows.map((r) => r.ttsMs), 0.95)}; ASR ms p50 ${pct(rows.map((r) => r.asrMs), 0.5)} p95 ${pct(rows.map((r) => r.asrMs), 0.95)}`);
console.log(`wav samples: ${out}`);
