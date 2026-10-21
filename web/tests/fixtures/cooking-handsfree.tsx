"use client";

// Local-only browser fixture. It is outside app/, so it is never a production
// route. Exercises the real component and browser audio/MediaRecorder APIs with
// synthetic input and mocked providers; it never accesses the physical mic.
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
    const input = new AudioContext();
    const oscillator = input.createOscillator();
    const gain = input.createGain();
    const destination = input.createMediaStreamDestination();
    gain.gain.value = 0;
    oscillator.frequency.value = 180;
    oscillator.connect(gain); gain.connect(destination); oscillator.start();
    let listens = 0, recordings = 0, replies = 0, messages = 0, uploadedBytes = 0;
    let lastStatus = "";
    const update = () => setReport(JSON.stringify({ listens, recordings, replies, messages, uploadedBytes, micEnded: destination.stream.getAudioTracks()[0].readyState === "ended" }));
    navigator.mediaDevices.getUserMedia = async () => {
      await input.resume();
      return destination.stream;
    };
    window.fetch = async (url, options) => {
      const path = String(url);
      if (path.endsWith("/api/cooking/turn")) {
        const body = JSON.parse(String(options?.body));
        if (body.action === "message") messages++;
        update();
        return Response.json({ token: "fixture", saved_token: "fixture", reply: messages ? "Equipment confirmed." : "Any guest dietary restrictions?", step: -1, total: 2, phase: messages ? "equipment" : "guests", pending: null, approved: [], paused: false, warning: "" });
      }
      if (path.endsWith("/api/cooking/speech")) {
        replies++; update();
        return new Response(speechWav(), { headers: { "Content-Type": "audio/wav" } });
      }
      if (path.endsWith("/api/cooking/transcribe")) {
        const audio = (options?.body as FormData).get("audio") as Blob;
        uploadedBytes += audio.size;
        recordings++; update();
        return Response.json({ text: recordings === 1 ? "No guest restrictions." : "I have an oven and a skillet." });
      }
      return originalFetch(url, options);
    };
    const observer = new MutationObserver(() => {
      const status = document.querySelector('[role="status"]')?.textContent ?? "";
      if (status === lastStatus) return;
      lastStatus = status;
      if (!status) { setTimeout(update, 0); return; }
      if (!status.startsWith("Listening")) return;
      listens++; update();
      // Two complete hands-free turns, followed by silence. The oscillator
      // drives the real MediaRecorder stream; no physical microphone is used.
      if (listens <= 2) {
        gain.gain.setValueAtTime(0.12, input.currentTime + 0.15);
        gain.gain.setValueAtTime(0, input.currentTime + 0.95);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    // The fixture becomes usable only after the external browser APIs are mocked.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReady(true);
    return () => {
      window.fetch = originalFetch;
      navigator.mediaDevices.getUserMedia = originalMic;
      observer.disconnect();
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
