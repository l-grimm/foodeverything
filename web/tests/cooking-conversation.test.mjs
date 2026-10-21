import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/cooking-conversation.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { CookingConversation, CookingLiveInput } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test("interrupting an in-flight turn retains signed state and serializes the next utterance", async () => {
  const first = deferred(), calls = [], states = [], replies = [];
  let interruptions = 0;
  const engine = new CookingConversation({
    exchange: async (previous, turn) => {
      calls.push([previous, turn.text]);
      return calls.length === 1 ? first.promise : { token: "second" };
    },
    state: state => states.push(state.token), reply: async state => { replies.push(state.token); },
    interrupt: () => { interruptions++; }, thinking() {}, error: error => { throw error; },
  });
  const done = engine.submit("start");
  await tick();
  engine.interrupt(); // VAD stops speech as soon as the user starts talking.
  engine.submit("message", "No guest restrictions");
  assert.equal(calls.length, 1);
  assert.equal(interruptions, 3);
  first.resolve({ token: "first" });
  await done;
  assert.deepEqual(calls, [[null, ""], [{ token: "first" }, "No guest restrictions"]]);
  assert.deepEqual(states, ["first", "second"]);
  assert.deepEqual(replies, ["second"]);
});

test("a spoken interruption while preparing audio suppresses stale speech and drains the next turn", async () => {
  const audio = deferred(), replies = [], calls = [];
  let preparing = false;
  const engine = new CookingConversation({
    exchange: async (_, turn) => { calls.push(turn.text); return { text: turn.text }; },
    state() {}, thinking() {}, error: error => { throw error; },
    reply: async state => { if (!state.text) { preparing = true; await audio.promise; } else replies.push(state.text); },
    interrupt: () => { if (preparing) audio.resolve(); },
  });
  const done = engine.submit("start"); await tick();
  engine.submit("message", "What equipment do I need?"); await done;
  assert.deepEqual(calls, ["", "What equipment do I need?"]);
  assert.deepEqual(replies, ["What equipment do I need?"]);
});

test("closing the conversation discards queued turns and late HTTP results", async () => {
  const response = deferred(), states = [];
  const engine = new CookingConversation({ exchange: () => response.promise,
    state: state => states.push(state), reply: async () => assert.fail("closed reply"),
    interrupt() {}, thinking() {}, error: () => assert.fail("closed error"),
  });
  const done = engine.submit("start"); await tick();
  engine.submit("message", "next"); engine.close(); response.resolve({ token: "late" });
  await done; await engine.submit("message", "resume");
  assert.deepEqual(states, []);
});

function inputFixture() {
  const spoken = [], transcripts = [], errors = [];
  let empty = 0;
  const channel = { close() { this.closed = true; } };
  const track = { readyState: "live", enabled: true };
  const stream = { getAudioTracks: () => [track] };
  const peer = { added: [], connectionState: "connected",
    addTrack(...args) { this.added.push(args); }, createDataChannel: () => channel,
    async createOffer() { return { type: "offer", sdp: "v=0\r\nm=audio offer" }; },
    async setLocalDescription(offer) { this.localDescription = offer; },
    async setRemoteDescription(answer) { this.answer = answer; channel.onopen(); },
    close() { this.closed = true; },
  };
  const input = new CookingLiveInput({ speech: () => spoken.push("speech"),
    transcript: text => transcripts.push(text), empty: () => { empty++; },
    error: (error, fatal) => errors.push([error.message, fatal]),
  }, () => peer);
  const event = (type, id, transcript) => input.receive({ type, item_id: id, transcript });
  return { input, event, spoken, transcripts, errors, peer, channel, stream, track, empty: () => empty };
}

test("one continuous track handles welcome, setup answers, steps, interruptions, pause and resume", async () => {
  const f = inputFixture(); let negotiations = 0;
  await f.input.connect(f.stream, async offer => { negotiations++; assert.match(offer, /m=audio/); return "answer"; });
  for (const [id, text] of ["No restrictions", "Yes I have those tools", "Okay", "Pause", "Resume"].entries()) {
    f.event("input_audio_buffer.speech_started", String(id));
    f.event("input_audio_buffer.committed", String(id));
    f.event("conversation.item.input_audio_transcription.completed", String(id), text);
    assert.equal(f.track.enabled, true);
    assert.equal(f.track.readyState, "live");
  }
  assert.equal(negotiations, 1); assert.equal(f.peer.added.length, 1);
  assert.equal(f.spoken.length, 5);
  assert.deepEqual(f.transcripts, ["No restrictions", "Yes I have those tools", "Okay", "Pause", "Resume"]);
  f.input.close(); assert.equal(f.peer.closed, true); assert.equal(f.channel.closed, true);
  // Physical stream belongs to the component; transport cleanup cannot stop a
  // replacement connection from using that same stream.
  assert.equal(f.track.readyState, "live");
  f.event("input_audio_buffer.speech_started", "late"); assert.equal(f.spoken.length, 5);
});

test("out-of-order transcription completions retain utterance order and deduplicate", () => {
  const f = inputFixture();
  f.event("input_audio_buffer.committed", "a"); f.event("input_audio_buffer.committed", "b");
  f.event("conversation.item.input_audio_transcription.completed", "b", "next");
  assert.deepEqual(f.transcripts, []);
  f.event("conversation.item.input_audio_transcription.completed", "a", "no restrictions");
  f.event("conversation.item.input_audio_transcription.completed", "b", "next");
  f.event("input_audio_buffer.committed", "b");
  assert.deepEqual(f.transcripts, ["no restrictions", "next"]);
});

test("empty or failed transcripts never advance a recipe and keep the input alive", () => {
  const f = inputFixture();
  f.event("input_audio_buffer.committed", "a");
  f.event("conversation.item.input_audio_transcription.completed", "a", "  ");
  f.event("input_audio_buffer.committed", "b");
  f.event("conversation.item.input_audio_transcription.failed", "b");
  f.event("input_audio_buffer.committed", "c");
  f.event("conversation.item.input_audio_transcription.completed", "c", "resume");
  assert.equal(f.empty(), 2); assert.equal(f.errors[0][1], false);
  assert.deepEqual(f.transcripts, ["resume"]);
});

test("provider error without an item ID closes the connection and prompts recovery", async () => {
  const f = inputFixture(); await f.input.connect(f.stream, async () => "answer");
  f.event("error"); assert.equal(f.errors[0][1], true); assert.equal(f.peer.closed, true);
});

test("negotiation failures release the peer and data channel", async () => {
  const f = inputFixture();
  await assert.rejects(f.input.connect(f.stream, async () => { throw new Error("offline"); }), /offline/);
  assert.equal(f.peer.closed, true); assert.equal(f.channel.closed, true);
});
