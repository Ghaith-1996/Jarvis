// Renderer audio: 16 kHz mono capture from an exact device, WAV encoding, and a TTS playback queue on an exact output.
// Never falls back to another device: a missing device is an error the UI must surface.

export const SAMPLE_RATE = 16_000;

export function encodeWav(chunks: Float32Array[], rate = SAMPLE_RATE): Uint8Array {
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  let o = 44;
  for (const c of chunks) for (let i = 0; i < c.length; i++, o += 2) v.setInt16(o, Math.max(-1, Math.min(1, c[i]!)) * 0x7fff, true);
  return new Uint8Array(buf);
}

export const deviceConstraint = (id: string) => (id === 'default' ? { deviceId: 'default' } : { deviceId: { exact: id } });

export async function listDevices() {
  const all = await navigator.mediaDevices.enumerateDevices();
  return { inputs: all.filter((d) => d.kind === 'audioinput'), outputs: all.filter((d) => d.kind === 'audiooutput') };
}

/** Is the saved device usable? 'ok' | 'moved' (same label, new id: ask the user) | 'missing' | 'unset'. */
export function deviceStatus(saved: { id: string | null; label: string | null }, devices: MediaDeviceInfo[]) {
  if (!saved.id) return { status: 'unset' as const };
  if (saved.id === 'default' || devices.some((d) => d.deviceId === saved.id)) return { status: 'ok' as const };
  const sameLabel = devices.find((d) => d.label && d.label === saved.label);
  return sameLabel ? { status: 'moved' as const, candidate: sameLabel } : { status: 'missing' as const };
}

/** Live mic: level meter always, capture only between start() and stop(). */
export class Mic {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private chunks: Float32Array[] | null = null;
  level = 0;
  onLevel: ((l: number) => void) | null = null;
  onEnded: (() => void) | null = null;

  async open(deviceId: string) {
    this.close();
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { ...deviceConstraint(deviceId), echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    this.stream.getAudioTracks()[0]?.addEventListener('ended', () => this.onEnded?.());
    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    await this.ctx.audioWorklet.addModule('pcm-worklet.js');
    const node = new AudioWorkletNode(this.ctx, 'pcm-tap');
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      let peak = 0;
      for (let i = 0; i < e.data.length; i++) peak = Math.max(peak, Math.abs(e.data[i]!));
      this.level = this.level * 0.8 + peak * 0.2;
      this.onLevel?.(this.level);
      this.chunks?.push(e.data);
    };
    this.ctx.createMediaStreamSource(this.stream).connect(node);
    return this.stream.getAudioTracks()[0]?.label ?? '';
  }

  start() { this.chunks = []; }
  get recording() { return this.chunks !== null; }

  /** Returns WAV bytes and the peak level, or null if nothing was captured. */
  stop(): { wav: Uint8Array; seconds: number; peak: number } | null {
    const chunks = this.chunks;
    this.chunks = null;
    if (!chunks?.length) return null;
    let peak = 0;
    for (const c of chunks) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]!));
    const samples = chunks.reduce((a, c) => a + c.length, 0);
    return { wav: encodeWav(chunks), seconds: samples / SAMPLE_RATE, peak };
  }

  cancel() { this.chunks = null; }

  close() {
    this.chunks = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.stream = null;
    this.ctx = null;
    this.level = 0;
  }
}

/** Plays WAV clips in order on one output device. stop() drops everything queued or in flight. */
export class Player {
  private queue: (() => Promise<Uint8Array>)[] = [];
  private audio: HTMLAudioElement | null = null;
  private generation = 0;
  private playing = false;
  outputId: string | null = null;
  volume = 1;
  muted = false;
  onState: ((speaking: boolean) => void) | null = null;
  onError: ((msg: string) => void) | null = null;

  /** Enqueue a clip to synthesize; order is preserved and only one clip is synthesized ahead of playback. */
  enqueue(make: () => Promise<Uint8Array>) {
    this.queue.push(make);
    void this.drain();
  }

  get speaking() { return this.playing || this.queue.length > 0; }

  private async drain() {
    if (this.playing) return;
    const gen = this.generation;
    this.playing = true;
    this.onState?.(true);
    let next: Promise<Uint8Array> | null = null;
    try {
      while (gen === this.generation) {
        next ??= this.queue.shift()?.() ?? null;
        if (!next) break;
        const bytes: Uint8Array = await next;
        next = this.queue.shift()?.() ?? null; // prefetch while this clip plays
        next?.catch(() => {}); // surfaced when awaited; avoid unhandled rejection if we stop first
        if (gen !== this.generation) break;
        await this.play(bytes, gen);
      }
    } catch (e) {
      if (gen === this.generation) this.onError?.(String((e as Error).message ?? e));
    } finally {
      if (gen === this.generation) { this.playing = false; this.onState?.(false); }
    }
  }

  private async play(bytes: Uint8Array, gen: number) {
    if (!this.outputId) throw new Error('No output device chosen. Pick one in Settings → Devices.');
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'audio/wav' }));
    const a = new Audio(url);
    this.audio = a;
    try {
      await a.setSinkId(this.outputId === 'default' ? '' : this.outputId);
      a.volume = this.volume;
      a.muted = this.muted;
      if (gen !== this.generation) return;
      await new Promise<void>((resolve, reject) => {
        a.onended = () => resolve();
        a.onerror = () => reject(new Error('playback failed'));
        a.onpause = () => resolve(); // stop() pauses
        a.play().catch(reject);
      });
    } finally {
      URL.revokeObjectURL(url);
      if (this.audio === a) this.audio = null;
    }
  }

  setVolume(v: number, muted: boolean) {
    this.volume = v;
    this.muted = muted;
    if (this.audio) { this.audio.volume = v; this.audio.muted = muted; }
  }

  stop() {
    this.generation++;
    this.queue = [];
    this.audio?.pause();
    this.audio = null;
    if (this.playing) { this.playing = false; this.onState?.(false); }
  }
}
