// AudioWorklet: forwards mono Float32 frames (at the AudioContext rate, 16 kHz) to the main thread.
declare const registerProcessor: (name: string, ctor: unknown) => void;
declare class AudioWorkletProcessor { port: MessagePort; }

class PcmTap extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]) {
    const ch = inputs[0]?.[0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('pcm-tap', PcmTap);
