"use client";

// Local-only fixture: no physical microphone, provider calls, or database access.
import { useEffect, useState } from "react";
import { CookingAssistant } from "../../src/app/recipe/[id]/_cooking-assistant";

function speechWav() {
  const rate = 16000;
  const count = rate;
  const bytes = new ArrayBuffer(44 + count * 2);
  const view = new DataView(bytes);
  const text = (at: number, value: string) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, 36 + count * 2, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) view.setInt16(44 + i * 2, Math.sin(i * 2 * Math.PI * 330 / rate) * 1200 * Math.sin(Math.PI * i / count), true);
  return bytes;
}

export default function HandsfreeFixture() {
  const [ready, setReady] = useState(false);
  const [report, setReport] = useState("No turns yet");
  useEffect(() => {
    const originalFetch = window.fetch;
    const originalMic = navigator.mediaDevices.getUserMedia;
    const originalPeer = window.RTCPeerConnection;
    const input = new AudioContext();
    const oscillator = input.createOscillator();
    const gain = input.createGain();
    const destination = input.createMediaStreamDestination();
    gain.gain.value = 0.015;
    oscillator.frequency.value = 180;
    oscillator.connect(gain); gain.connect(destination); oscillator.start();
    const track = destination.stream.getAudioTracks()[0];
    const turns: string[] = [];
    let connections = 0, replies = 0, microphones = 0, serial = 0, lastToken = "";
    let tokensInOrder = true, continuousMic = true;
    let channel: { onopen: (() => void) | null; onmessage: ((event: { data: string }) => void) | null; close: () => void } | null = null;
    const update = () => setReport(JSON.stringify({ turns, connections, microphones, replies, tokensInOrder, continuousMic, micEnded: track.readyState === "ended" }));
    navigator.mediaDevices.getUserMedia = async () => { microphones++; await input.resume(); return destination.stream; };
    class FixturePeer {
      localDescription: { type: string; sdp: string } | null = null;
      connectionState = "connected";
      onconnectionstatechange = null;
      addTrack(added: MediaStreamTrack) { continuousMic &&= added === track && track.enabled; }
      createDataChannel() { channel = { onopen: null, onmessage: null, close() {} }; return channel; }
      async createOffer() { return { type: "offer", sdp: "v=0\r\nm=audio fixture-offer" }; }
      async setLocalDescription(offer: { type: string; sdp: string }) { this.localDescription = offer; }
      async setRemoteDescription() { channel?.onopen?.(); }
      close() {}
    }
    window.RTCPeerConnection = FixturePeer as unknown as typeof RTCPeerConnection;
    window.fetch = async (url, options) => {
      const path = String(url);
      if (path.endsWith("/api/cooking/connect")) { connections++; update(); return Response.json({ sdp: "fixture-answer" }); }
      if (path.endsWith("/api/cooking/turn")) {
        const body = JSON.parse(String(options?.body));
        if (body.action !== "start") tokensInOrder &&= body.token === lastToken;
        turns.push(body.text || body.action);
        const index = turns.length - 1;
        const texts = ["Welcome! Any guest dietary restrictions?", "Do you have an oven and a dish?", "First, prepare the vegetables.", "Next, bake the vegetables.", "About twenty minutes. Tell me when you are ready.", "Of course. Say resume when you are ready.", "We are still baking the vegetables."];
        lastToken = `fixture-${turns.length}`;
        update();
        return Response.json({ token: lastToken, saved_token: "fixture", reply: texts[index] ?? "Still here.", step: index < 2 ? -1 : index === 2 ? 0 : 1, total: 2, phase: index === 0 ? "guests" : index === 1 ? "equipment" : "cooking", pending: null, approved: [], paused: index === 5, warning: "" });
      }
      if (path.endsWith("/api/cooking/speech")) {
        replies++; continuousMic &&= track.enabled && track.readyState === "live"; update();
        return new Response(speechWav(), { headers: { "Content-Type": "audio/wav" } });
      }
      if (path.includes("/api/cooking/")) throw new Error("Unexpected provider operation in local fixture");
      return originalFetch(url, options);
    };
    const script = ["No guest restrictions.", "Yes I have those tools.", "Okay.", "How long should it bake?", "Pause.", "Resume."];
    let lastStatus = "";
    const timers: ReturnType<typeof setTimeout>[] = [];
    const observer = new MutationObserver(() => {
      const status = document.querySelector('[role="status"]')?.textContent ?? "";
      if (status === lastStatus) return;
      lastStatus = status;
      if (!status) { timers.push(setTimeout(update, 0)); return; }
      if (status !== "I'm listening" && !status.startsWith("I'm here. Say resume")) return;
      const text = script.shift();
      if (!text) return;
      timers.push(setTimeout(() => {
        continuousMic &&= track.enabled && track.readyState === "live";
        const id = String(++serial);
        const emit = (type: string, transcript?: string) => channel?.onmessage?.({ data: JSON.stringify({ type, item_id: id, transcript }) });
        emit("input_audio_buffer.speech_started");
        emit("input_audio_buffer.committed");
        emit("conversation.item.input_audio_transcription.completed", text);
        update();
      }, 150));
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    setReady(true);
    return () => {
      window.fetch = originalFetch; window.RTCPeerConnection = originalPeer;
      navigator.mediaDevices.getUserMedia = originalMic;
      observer.disconnect(); timers.forEach(clearTimeout);
      destination.stream.getTracks().forEach(track => track.stop());
      void input.close();
    };
  }, []);
  return <div>
    <h1>Hands-free browser regression fixture</h1>
    <p>Mocked providers and synthetic microphone. No real microphone access.</p>
    <output aria-label="Hands-free test results">{report}</output>
    {ready && <CookingAssistant recipeId="fixture" title="Hands-free audio test" hasSteps />}
  </div>;
}
