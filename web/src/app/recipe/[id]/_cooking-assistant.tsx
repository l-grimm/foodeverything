"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Pause, Play, RotateCcw, Send, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Modification = { ingredient_id: string; original: string; replacement: string; note: string };
type Session = {
  token: string; saved_token: string; reply: string; step: number; total: number; phase: string;
  pending: Modification | null; approved: Modification[]; paused: boolean; warning: string;
};
type Status = "thinking" | "speaking" | "ready" | "listening" | "paused";
type Action = "start" | "message" | "approve" | "reject" | "resume" | "repeat" | "next";

export function CookingAssistant({ recipeId, title, hasSteps }: {
  recipeId: string; title: string; hasSteps: boolean;
}) {
  const [context, setContext] = useState<AudioContext | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const startButton = useRef<HTMLButtonElement>(null);
  useEffect(() => () => { if (context && context.state !== "closed") void context.close(); }, [context]);
  function open() {
    if (typeof AudioContext === "undefined") { setUnavailable(true); return; }
    // Audio is unlocked by a user gesture; never bundle an API key here.
    const audioContext = new AudioContext();
    void audioContext.resume();
    setContext(audioContext);
  }
  return <>
    <Button ref={startButton} size="sm" onClick={open} disabled={!hasSteps}
      title={!hasSteps ? "Add recipe instructions to start cooking" : undefined}>
      <Play size={14} aria-hidden="true" /> Start
    </Button>
    {unavailable && <span role="alert" className="text-xs">This browser doesn’t support cooking audio.</span>}
    {context && <CookingSession recipeId={recipeId} title={title} context={context} onClose={() => {
      setContext(null);
      // Wait until the modal is removed and the recipe is no longer inert.
      requestAnimationFrame(() => startButton.current?.focus());
    }} />}
  </>;
}

function CookingSession({ recipeId, title, context, onClose }: {
  recipeId: string; title: string; context: AudioContext; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const playbackUrl = useRef<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const micStream = useRef<MediaStream | null>(null);
  const micSource = useRef<MediaStreamAudioSourceNode | null>(null);
  const recordingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const resumePlayback = useRef(false);
  const sessionRef = useRef<Session | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<Status>("thinking");
  const [error, setError] = useState("");
  const [storageWarning, setStorageWarning] = useState("");
  const [draft, setDraft] = useState("");
  const [heard, setHeard] = useState("");
  const storageKey = `foodeverything:cooking:${recipeId}`;

  const stopMic = useCallback(() => {
    if (recordingTimer.current) clearTimeout(recordingTimer.current);
    recordingTimer.current = null;
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    recorder.current = null;
    micStream.current?.getTracks().forEach(track => track.stop());
    micStream.current = null;
    micSource.current?.disconnect();
    micSource.current = null;
  }, []);

  const speak = useCallback(async (next: Session, signal: AbortSignal, version: number) => {
    const response = await fetch("/api/cooking/speech", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: next.token }), signal,
    });
    if (!response.ok) throw new Error("Audio unavailable. Read the response below, or use Repeat to try again.");
    const blob = await response.blob();
    if (signal.aborted || version !== generation.current) return;
    if (playbackUrl.current) URL.revokeObjectURL(playbackUrl.current);
    playbackUrl.current = URL.createObjectURL(blob);
    const audio = player.current!;
    audio.src = playbackUrl.current;
    await context.resume();
    if (signal.aborted || version !== generation.current) return;
    try {
      await audio.play();
      if (version === generation.current) setStatus("speaking");
      else audio.pause();
    } catch {
      throw new Error("Tap Repeat to enable spoken audio. You can also read and type below.");
    }
  }, [context]);

  const send = useCallback(async (action: Action, text = "") => {
    const version = ++generation.current;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    player.current?.pause();
    stopMic();
    setStatus("thinking");
    setError("");
    try {
      let savedToken: string | null = null;
      if (action === "start") {
        try { savedToken = localStorage.getItem(storageKey); } catch { /* surfaced when saving */ }
      }
      const response = await fetch("/api/cooking/turn", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipe_id: recipeId, action, text,
          token: action === "start" ? null : sessionRef.current?.token, saved_token: savedToken }),
        signal: request.signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Couldn't process this turn. Please try again.");
      if (version !== generation.current) return;
      const next = result as Session;
      sessionRef.current = next;
      setSession(next);
      if (text) setHeard(text);
      if (next.approved.length) {
        try { localStorage.setItem(storageKey, next.saved_token); }
        catch { setStorageWarning("Your browser couldn't save changes. Keep this session open to retain them."); }
      }
      if (next.paused) { setStatus("paused"); return; }
      setStatus("ready");
      await speak(next, request.signal, version);
    } catch (cause) {
      if (request.signal.aborted || version !== generation.current) return;
      setError(cause instanceof Error ? cause.message : "Something went wrong. Please try again.");
      setStatus("ready");
    }
  }, [recipeId, speak, stopMic, storageKey]);

  useEffect(() => {
    const modal = dialog.current!;
    modal.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const meter = context.createAnalyser();
    meter.fftSize = 512;
    meter.smoothingTimeConstant = 0.72;
    analyser.current = meter;
    const audio = new Audio();
    player.current = audio;
    const source = context.createMediaElementSource(audio);
    source.connect(meter);
    // Mic connects only to the analyser, so it never echoes through speakers.
    source.connect(context.destination);
    audio.onended = () => setStatus("ready");
    audio.onerror = () => { setError("Audio playback failed. Tap Repeat to try again."); setStatus("ready"); };
    // Mount opens a new server session; async responses drive subsequent state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void send("start");
    // A mutable request counter, not a DOM ref: cleanup must invalidate the latest turn.
    const requestGeneration = generation;
    return () => {
      ++requestGeneration.current;
      controller.current?.abort();
      stopMic();
      audio.pause();
      audio.onended = null;
      audio.onerror = null;
      source.disconnect();
      meter.disconnect();
      if (playbackUrl.current) URL.revokeObjectURL(playbackUrl.current);
      document.body.style.overflow = previousOverflow;
      modal.close();
      // Context is closed by the owning component after the modal unmounts.
    };
  }, [context, send, stopMic]);

  useEffect(() => {
    const surface = canvas.current!;
    const drawing = surface.getContext("2d")!;
    const samples = new Uint8Array(256);
    let frame = 0;
    let raf = 0;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const draw = () => {
      frame++;
      if (!reduceMotion.matches || frame % 5 === 0) {
        const width = surface.clientWidth;
        const height = surface.clientHeight;
        const ratio = window.devicePixelRatio || 1;
        if (surface.width !== Math.round(width * ratio) || surface.height !== Math.round(height * ratio)) {
          surface.width = Math.round(width * ratio); surface.height = Math.round(height * ratio);
        }
        drawing.setTransform(ratio, 0, 0, ratio, 0, 0);
        drawing.clearRect(0, 0, width, height);
        analyser.current?.getByteTimeDomainData(samples);
        drawing.strokeStyle = "#0963e7";
        drawing.lineWidth = 3;
        drawing.lineCap = "round";
        drawing.beginPath();
        for (let i = 0; i < samples.length; i++) {
          const x = (i / (samples.length - 1)) * width;
          const envelope = Math.sin(Math.PI * i / (samples.length - 1));
          // Actual PCM amplitude; silence produces a calm horizontal line.
          const amplitude = status === "speaking" || status === "listening" ? (samples[i] - 128) / 128 : 0;
          const y = height / 2 + amplitude * height * 0.46 * envelope;
          if (i === 0) drawing.moveTo(x, y); else drawing.lineTo(x, y);
        }
        drawing.stroke();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [status]);

  async function record() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Voice recording needs a supported browser on HTTPS or localhost. You can type below."); return;
    }
    const version = ++generation.current;
    controller.current?.abort();
    player.current?.pause();
    setError("");
    setStatus("thinking");
    try {
      await context.resume();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (version !== generation.current) { stream.getTracks().forEach(t => t.stop()); return; }
      micStream.current = stream;
      micSource.current = context.createMediaStreamSource(stream);
      micSource.current.connect(analyser.current!);
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(type => MediaRecorder.isTypeSupported(type));
      if (!mime) throw new Error("This browser can't record a supported format. Please type below.");
      const recording = new MediaRecorder(stream, { mimeType: mime });
      recorder.current = recording;
      const chunks: BlobPart[] = [];
      recording.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recording.onstop = async () => {
        stopMic();
        if (version !== generation.current) return;
        const request = new AbortController();
        controller.current = request;
        setStatus("thinking");
        try {
          const form = new FormData();
          form.append("audio", new Blob(chunks, { type: mime }), mime.includes("mp4") ? "turn.mp4" : mime.includes("ogg") ? "turn.ogg" : "turn.webm");
          const response = await fetch("/api/cooking/transcribe", { method: "POST", body: form, signal: request.signal });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error ?? "Couldn't transcribe that turn.");
          if (version !== generation.current) return;
          if (!result.text?.trim()) throw new Error("I didn't hear anything. Please try again.");
          await send("message", result.text);
        } catch (cause) {
          if (request.signal.aborted || version !== generation.current) return;
          setError(cause instanceof Error ? cause.message : "Couldn't transcribe that turn.");
          setStatus("ready");
        }
      };
      recording.onerror = () => {
        ++generation.current; stopMic(); setStatus("ready"); setError("Recording failed. Please try again or type below.");
      };
      recording.start();
      setStatus("listening");
      // Explicit turns avoid interpreting kitchen noise as an instruction.
      recordingTimer.current = setTimeout(() => stopMic(), 60_000);
    } catch (cause) {
      if (version !== generation.current) return;
      stopMic(); setStatus("ready");
      setError(cause instanceof DOMException && cause.name === "NotAllowedError"
        ? "Microphone access was denied. Enable it in browser settings, or type below."
        : cause instanceof Error ? cause.message : "Couldn't open the microphone.");
    }
  }

  async function togglePause() {
    if (status === "paused") {
      await context.resume();
      const audio = player.current;
      if (resumePlayback.current && audio?.src && !audio.ended) {
        try { await audio.play(); setStatus("speaking"); }
        catch { setError("Couldn't resume audio. Tap Repeat."); setStatus("ready"); }
      } else { void send(sessionRef.current ? "resume" : "start"); }
      return;
    }
    ++generation.current;
    resumePlayback.current = status === "speaking";
    controller.current?.abort();
    player.current?.pause();
    stopMic();
    setStatus("paused");
  }

  const busy = status === "thinking";
  const label = { thinking: "Preparing your next turn…", speaking: "Your cooking companion is speaking", ready: "Your turn", listening: "Listening · tap Done when you’re finished", paused: "Take your time. We’re paused." }[status];
  return <dialog ref={dialog} className="cooking-dialog" aria-labelledby="cooking-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col px-6 py-5 sm:px-12 sm:py-6">
      <header className="flex items-center justify-between gap-4">
        <span className="label-mono">FoodEverything · Let’s cook</span>
        <button type="button" onClick={onClose} aria-label="Close cooking assistant" className="cooking-icon-button"><X size={22} /></button>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center py-6 text-center">
        <p className="label-mono mb-3">{session?.phase === "cooking" && session.step >= 0
          ? session.step < session.total ? `Step ${session.step + 1} of ${session.total}` : "Ready to serve"
          : "A little preparation"}</p>
        <h1 id="cooking-title" className="font-display max-w-xl text-3xl leading-tight sm:text-4xl">{title}</h1>
        <canvas ref={canvas} className="my-4 h-20 w-full sm:h-24" aria-hidden="true" />
        <p role="status" className="mb-4 text-sm text-muted-foreground">{label}</p>
        <button type="button" onClick={() => void togglePause()} className="cooking-pause" aria-label={status === "paused" ? "Resume cooking" : "Pause cooking"}>
          {status === "paused" ? <Play size={36} fill="currentColor" /> : <Pause size={36} fill="currentColor" />}
        </button>
        <span className="mt-3 text-sm">{status === "paused" ? "Resume" : "Pause"}</span>
        <p className="mt-5 max-w-lg text-base leading-relaxed" aria-live="polite">{session?.reply ?? "Getting your recipe ready…"}</p>
        {session?.pending && <div className="mt-6 w-full rounded-2xl border border-primary/25 p-5 text-left">
          <p className="label-mono mb-2">Your approval needed</p>
          <p><span className="font-medium">{session.pending.original}</span> → {session.pending.replacement}</p>
          <p className="mt-2 text-sm text-muted-foreground">{session.pending.note}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button disabled={busy || status === "paused"} onClick={() => void send("approve")}>Approve & save</Button>
            <Button variant="outline" disabled={busy || status === "paused"} onClick={() => void send("reject")}>Reject</Button>
          </div>
        </div>}
        {(error || storageWarning || session?.warning) && <div role="alert" className="mt-5 text-sm text-destructive">
          {error && <p>{error}</p>}{storageWarning && <p>{storageWarning}</p>}{session?.warning && <p>{session.warning}</p>}
          {!session && !busy && <Button className="mt-3" variant="outline" onClick={() => void send("start")}>Try again</Button>}
        </div>}
      </main>
      <footer className="space-y-4 pb-4">
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" disabled={!session || busy || status === "paused" || status === "listening"} onClick={() => void send("repeat")}><RotateCcw size={16} /> Repeat</Button>
          <Button disabled={!session || busy || status === "paused"} onClick={() => status === "listening" ? stopMic() : void record()}>
            {status === "listening" ? <><Square size={16} /> Done</> : <><Mic size={16} /> Speak</>}
          </Button>
        </div>
        {heard && <p className="text-center text-xs text-muted-foreground">You: {heard}</p>}
        <form className="flex gap-2" onSubmit={event => {
          event.preventDefault(); if (draft.trim()) { void send("message", draft.trim()); setDraft(""); }
        }}>
          <input value={draft} onChange={event => setDraft(event.target.value)} maxLength={2000}
            disabled={!session || busy || status === "paused" || status === "listening"}
            className="min-w-0 flex-1 rounded-full border border-border bg-transparent px-5 py-3 text-sm outline-primary"
            aria-label="Type a message to your cooking assistant" placeholder="Or type a question…" />
          <button type="submit" className="cooking-icon-button" aria-label="Send message"
            disabled={!draft.trim() || !session || busy || status === "paused" || status === "listening"}><Send size={20} /></button>
        </form>
        <p className="text-center text-xs text-muted-foreground">AI-generated voice · Speak, then tap Done. Approved changes are saved in this browser.</p>
        {!!session?.approved.length && <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer">{session.approved.length} approved change{session.approved.length === 1 ? "" : "s"}</summary>
          <ul className="mt-2 space-y-2">{session.approved.map(m => <li key={m.ingredient_id}>{m.original} → {m.replacement}. {m.note}</li>)}</ul>
        </details>}
      </footer>
    </div>
  </dialog>;
}
