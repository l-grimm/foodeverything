/** Playback stays in the AudioContext unlocked by Start, including on mobile.
 * A separately created HTMLAudioElement can require a second user gesture after
 * the network request, even when an AudioContext has already been unlocked.
 */
export function unlockCookingAudio(context: AudioContext) {
  const resumed = context.resume();
  const silent = context.createBufferSource();
  silent.buffer = context.createBuffer(1, 1, context.sampleRate);
  silent.connect(context.destination);
  silent.onended = () => silent.disconnect();
  silent.start();
  return resumed;
}

export class CookingAudioPlayer {
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  private offset = 0;
  private startedAt = 0;
  private ended: (() => void) | null = null;

  constructor(private context: AudioContext, private meter: AnalyserNode) {}

  play(buffer: AudioBuffer, onEnded: () => void) {
    this.stop();
    this.buffer = buffer;
    this.ended = onEnded;
    this.resume();
  }

  get canResume() { return this.buffer !== null && this.offset < this.buffer.duration; }

  pause() {
    if (!this.source) return;
    this.offset = Math.min(this.buffer!.duration, this.offset + this.context.currentTime - this.startedAt);
    this.detach();
  }

  resume() {
    if (!this.buffer || !this.canResume) return;
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.meter);
    // The microphone also connects to meter, so meter itself is never connected
    // to the speakers. Only the assistant's source reaches the destination.
    source.connect(this.context.destination);
    this.source = source;
    this.startedAt = this.context.currentTime;
    source.onended = () => {
      if (this.source !== source) return;
      this.source = null;
      source.disconnect();
      this.buffer = null;
      this.offset = 0;
      const callback = this.ended;
      this.ended = null;
      callback?.();
    };
    source.start(0, this.offset);
  }

  stop() {
    this.detach();
    this.buffer = null;
    this.offset = 0;
    this.ended = null;
  }

  private detach() {
    if (!this.source) return;
    this.source.onended = null;
    this.source.stop();
    this.source.disconnect();
    this.source = null;
  }
}
