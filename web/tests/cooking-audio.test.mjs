import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/cooking-audio.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { CookingAudioPlayer, CookingTurnDetector, unlockCookingAudio } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);

function audioFixture() {
  const sources = [];
  const context = {
    currentTime: 0, sampleRate: 48000, destination: { name: "speaker" },
    resumeCalled: false,
    resume() { this.resumeCalled = true; return Promise.resolve(); },
    createBuffer(channels, frames, rate) { return { duration: frames / rate, channels, frames }; },
    createBufferSource() {
      const node = {
        buffer: null, onended: null, connections: [], stopped: false, startArgs: null,
        connect(destination) { this.connections.push(destination); },
        disconnect() { this.connections = []; },
        start(...args) { this.startArgs = args; },
        stop() { this.stopped = true; },
      };
      sources.push(node); return node;
    },
  };
  const meter = { name: "waveform" };
  return { context, meter, sources, player: new CookingAudioPlayer(context, meter) };
}

test("Start unlocks the same AudioContext used for later network speech", async () => {
  const { context, sources } = audioFixture();
  const resumed = unlockCookingAudio(context);
  assert.equal(context.resumeCalled, true);
  assert.equal(sources[0].buffer.frames, 1);
  assert.deepEqual(sources[0].connections, [context.destination]);
  assert.deepEqual(sources[0].startArgs, []);
  await resumed;
});

test("decoded speech reaches both the speaker and the actual waveform analyser", () => {
  const { player, sources, context, meter } = audioFixture();
  const buffer = { duration: 10 };
  player.play(buffer, () => {});
  assert.equal(sources[0].buffer, buffer);
  assert.deepEqual(sources[0].connections, [meter, context.destination]);
  assert.deepEqual(sources[0].startArgs, [0, 0]);
});

test("natural speech completion hands control to automatic listening once", () => {
  const { player, sources } = audioFixture();
  let listens = 0;
  player.play({ duration: 10 }, () => { listens++; });
  const ended = sources[0].onended;
  ended(); ended();
  assert.equal(listens, 1);
  assert.equal(player.canResume, false);
});

test("pause silences speech and resume continues at its saved offset", () => {
  const { player, context, sources } = audioFixture();
  let listens = 0;
  player.play({ duration: 10 }, () => { listens++; });
  context.currentTime = 3.25;
  player.pause();
  assert.equal(sources[0].stopped, true);
  assert.equal(sources[0].onended, null);
  assert.equal(listens, 0);
  context.currentTime = 20;
  player.resume();
  assert.deepEqual(sources[1].startArgs, [0, 3.25]);
  sources[1].onended();
  assert.equal(listens, 1);
});

test("cancelled or replaced speech never starts the microphone", () => {
  const { player, sources } = audioFixture();
  let listens = 0;
  player.play({ duration: 10 }, () => { listens++; });
  const staleEnded = sources[0].onended;
  player.play({ duration: 5 }, () => { listens++; });
  staleEnded();
  assert.equal(listens, 0);
  const cancelledEnded = sources[1].onended;
  player.stop(); cancelledEnded();
  assert.equal(listens, 0);
  assert.equal(player.canResume, false);
});

test("extended silence never submits a voice turn", () => {
  const detector = new CookingTurnDetector();
  for (let time = 0; time <= 60_000; time += 40) assert.equal(detector.sample(0.002, time), false);
  assert.equal(detector.hasSpeech, false);
});

test("a short kitchen clatter does not submit a voice turn", () => {
  const detector = new CookingTurnDetector();
  for (let time = 0; time < 2000; time += 40) {
    assert.equal(detector.sample(time === 200 || time === 240 ? 0.2 : 0.002, time), false);
  }
  assert.equal(detector.hasSpeech, false);
});

test("speech followed by 1.4 seconds of silence ends the turn automatically", () => {
  const detector = new CookingTurnDetector();
  for (let time = 0; time <= 800; time += 40) assert.equal(detector.sample(0.05, time), false);
  assert.equal(detector.hasSpeech, true);
  for (let time = 840; time < 2200; time += 40) assert.equal(detector.sample(0.002, time), false);
  assert.equal(detector.sample(0.002, 2200), true);
});

test("separate kitchen clatters do not accumulate into a speech turn", () => {
  const detector = new CookingTurnDetector();
  for (let time = 0; time < 30_000; time += 40) {
    assert.equal(detector.sample(time % 1000 === 0 ? 0.2 : 0.002, time), false);
  }
  assert.equal(detector.hasSpeech, false);
});

test("a brief pause in the middle of a sentence does not end the turn", () => {
  const detector = new CookingTurnDetector();
  for (let time = 0; time <= 500; time += 40) detector.sample(0.05, time);
  for (let time = 520; time < 1400; time += 40) assert.equal(detector.sample(0.002, time), false);
  for (let time = 1400; time < 2000; time += 40) assert.equal(detector.sample(0.05, time), false);
});

test("short answers such as no or next can form a turn", () => {
  const detector = new CookingTurnDetector();
  for (let time = 0; time <= 160; time += 40) detector.sample(0.05, time);
  assert.equal(detector.hasSpeech, true);
  assert.equal(detector.sample(0.002, 1560), true);
});
