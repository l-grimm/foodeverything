export type CookingTurn = { action: "start" | "message" | "repeat"; text: string };

/** Serialize state changes, but interrupt speech immediately. An interrupted
 * HTTP turn still returns its signed state before the next turn is submitted.
 * This prevents lost approvals and avoids answering with an outdated token.
 */
export class CookingConversation<State> {
  private state: State | null = null;
  private queue: CookingTurn[] = [];
  private revision = 0;
  private closed = false;
  private running: Promise<void> | null = null;

  constructor(private handlers: {
    exchange: (state: State | null, turn: CookingTurn) => Promise<State>;
    state: (state: State) => void;
    reply: (state: State) => Promise<void>;
    interrupt: () => void;
    thinking: () => void;
    error: (error: unknown) => void;
  }) {}

  interrupt() {
    if (this.closed) return;
    this.revision++;
    this.handlers.interrupt();
  }

  submit(action: CookingTurn["action"], text = "") {
    if (this.closed) return Promise.resolve();
    this.interrupt();
    this.queue.push({ action, text });
    if (!this.running) this.running = this.drain();
    return this.running;
  }

  close() {
    this.interrupt();
    this.closed = true;
    this.queue = [];
  }

  private async drain() {
    // Start after submit has assigned running, even if an adapter throws before
    // its first await. All subsequent turns join this same promise.
    await Promise.resolve();
    try {
      while (!this.closed && this.queue.length) {
        const turn = this.queue.shift()!;
        const revision = this.revision;
        this.handlers.thinking();
        try {
          const state = await this.handlers.exchange(this.state, turn);
          if (this.closed) return;
          this.state = state;
          this.handlers.state(state);
          if (revision === this.revision && !this.queue.length) await this.handlers.reply(state);
        } catch (error) {
          if (!this.closed) this.handlers.error(error);
        }
      }
    } finally {
      this.running = null;
    }
  }
}

/** One continuous WebRTC microphone stream. OpenAI's VAD identifies turns and
 * interruptions; final transcripts are delivered in committed-turn order.
 * This transport never changes recipe state or approves substitutions.
 */
export class CookingLiveInput {
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private closed = false;
  private committed: string[] = [];
  private transcripts = new Map<string, string>();
  private delivered = new Set<string>();
  private pendingOpenReject: ((reason: Error) => void) | null = null;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private handlers: {
    speech: () => void;
    transcript: (text: string) => void;
    empty: () => void;
    error: (error: Error, fatal: boolean) => void;
  }, private createPeer = () => new RTCPeerConnection()) {}

  async connect(stream: MediaStream, negotiate: (sdp: string) => Promise<string>) {
    if (this.closed) throw new Error("This conversation has ended.");
    const peer = this.createPeer();
    this.peer = peer;
    const track = stream.getAudioTracks()[0];
    if (!track || track.readyState === "ended") throw new Error("The microphone is unavailable.");
    peer.addTrack(track, stream);
    const channel = peer.createDataChannel("oai-events");
    this.channel = channel;
    channel.onmessage = event => {
      try { this.receive(JSON.parse(event.data)); }
      catch { this.fail("Couldn't read the voice connection. Please reconnect."); }
    };
    channel.onerror = () => this.fail("The voice connection was interrupted. Please reconnect.");
    channel.onclose = () => { if (!this.closed) this.fail("The voice conversation disconnected. Please reconnect."); };
    peer.onconnectionstatechange = () => {
      if (this.closed) return;
      if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
      if (peer.connectionState === "failed") this.fail("The voice conversation disconnected. Please reconnect.");
      if (peer.connectionState === "disconnected") {
        this.disconnectTimer = setTimeout(() => {
          if (peer.connectionState === "disconnected") this.fail("The voice conversation disconnected. Please reconnect.");
        }, 5000);
      }
    };
    const opened = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error("Opening the voice connection timed out. Please reconnect.")); }, 25_000);
      this.pendingOpenReject = error => { clearTimeout(timer); reject(error); };
      channel.onopen = () => { clearTimeout(timer); this.pendingOpenReject = null; resolve(); };
    });
    // Register rejection immediately: a network error may arrive while SDP is
    // being negotiated, before the open promise is awaited below.
    void opened.catch(() => {});
    try {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const answer = await negotiate(peer.localDescription?.sdp ?? offer.sdp ?? "");
      if (this.closed) throw new Error("This conversation has ended.");
      await peer.setRemoteDescription({ type: "answer", sdp: answer });
      await opened;
    } catch (error) {
      this.close();
      throw error;
    }
  }

  receive(event: { type: string; item_id?: string; transcript?: string }) {
    if (this.closed) return;
    if (event.type === "error") { this.fail("The voice connection reported an error. Please reconnect."); return; }
    if (event.type === "input_audio_buffer.speech_started") this.handlers.speech();
    const id = event.item_id;
    if (!id || this.delivered.has(id)) return;
    if (event.type === "input_audio_buffer.committed" && !this.committed.includes(id)) this.committed.push(id);
    if (event.type === "conversation.item.input_audio_transcription.completed") this.transcripts.set(id, event.transcript?.trim() ?? "");
    if (event.type === "conversation.item.input_audio_transcription.failed") {
      this.transcripts.set(id, "");
      this.handlers.error(new Error("I didn't catch that. Please say it again—I'm still listening."), false);
    }
    while (this.committed.length && this.transcripts.has(this.committed[0])) {
      const next = this.committed.shift()!;
      const text = this.transcripts.get(next)!;
      this.transcripts.delete(next);
      this.delivered.add(next);
      if (text) this.handlers.transcript(text); else this.handlers.empty();
    }
  }

  close() {
    this.closed = true;
    if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
    this.pendingOpenReject?.(new Error("This conversation has ended."));
    this.pendingOpenReject = null;
    if (this.channel) {
      this.channel.onopen = null; this.channel.onmessage = null;
      this.channel.onerror = null; this.channel.onclose = null;
      this.channel.close();
    }
    if (this.peer) { this.peer.onconnectionstatechange = null; this.peer.close(); }
    this.committed = []; this.transcripts.clear(); this.delivered.clear();
  }

  private fail(message: string) {
    if (this.closed) return;
    this.handlers.error(new Error(message), true);
    this.close();
  }
}
