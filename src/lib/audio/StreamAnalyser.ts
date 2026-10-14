import { mouthFromSpectrum, rmsLevel, CLOSED_MOUTH, type MouthShape } from "./lipsync";

/**
 * Wraps an AnalyserNode attached to a MediaStream. Used for both the remote
 * (assistant) voice — to drive the mouth — and the local mic — to drive the
 * listening reaction. Not connected to the speakers: playback goes through an
 * <audio> element so we don't double the output.
 */
export class StreamAnalyser {
  private analyser: AnalyserNode;
  private source: MediaStreamAudioSourceNode;
  private freq: Uint8Array<ArrayBuffer>;
  private time: Uint8Array<ArrayBuffer>;

  constructor(
    private ctx: AudioContext,
    stream: MediaStream,
    fftSize = 1024,
  ) {
    this.source = ctx.createMediaStreamSource(stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = fftSize;
    this.analyser.smoothingTimeConstant = 0.35;
    this.source.connect(this.analyser);
    this.freq = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
    this.time = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
  }

  mouth(): MouthShape {
    if (this.ctx.state !== "running") return CLOSED_MOUTH;
    this.analyser.getByteFrequencyData(this.freq);
    return mouthFromSpectrum(this.freq, this.ctx.sampleRate);
  }

  level(): number {
    if (this.ctx.state !== "running") return 0;
    this.analyser.getByteTimeDomainData(this.time);
    return rmsLevel(this.time);
  }

  dispose() {
    try {
      this.source.disconnect();
      this.analyser.disconnect();
    } catch {
      /* already disconnected */
    }
  }
}
