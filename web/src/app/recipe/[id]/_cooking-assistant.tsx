"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Send, Volume2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CookingAudioPlayer, CookingTurnDetector, unlockCookingAudio } from "@/lib/cooking-audio";

type Modification = { ingredient_id: string; original: string; replacement: string; note: string };
type Session = {
  token: string; saved_token: string; reply: string; step: number; total: number; phase: string;
  pending: Modification | null; approved: Modification[]; paused: boolean; warning: string;
};
type Status = "thinking" | "speaking" | "ready" | "listening" | "paused";
type Action = "start" | "message" | "approve" | "reject" | "resume" | "repeat" | "next";
type MicrophoneAccess = { stream: MediaStream | null; error: string };
type AudioResources = { context: AudioContext; microphone: Promise<MicrophoneAccess> };

export function CookingAssistant({ recipeId, title, hasSteps }: {
  recipeId: string; title: string; hasSteps: boolean;
}) {
  const [resources, setResources] = useState<AudioResources | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const startButton = useRef<HTMLButtonElement>(null);
  useEffect(() => () => {
    if (!resources) return;
    if (resources.context.state !== "closed") void resources.context.close();
    void resources.microphone.then(({ stream }) => stream?.getTracks().forEach(track => track.stop()));
  }, [resources]);
  function open() {
    if (typeof AudioContext === "undefined") { setUnavailable(true); return; }
    // Audio is unlocked by a user gesture; never bundle an API key here.
    const audioContext = new AudioContext();
    void unlockCookingAudio(audioContext).catch(() => { /* Enable sound offers a fresh gesture. */ });
    // Request permission on Start. Keep the mic muted until the assistant has
    // finished speaking, so it cannot transcribe its own voice.
    const microphone: Promise<MicrophoneAccess> = typeof navigator.mediaDevices?.getUserMedia === "function" && typeof MediaRecorder !== "undefined"
      ? navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
        .then(stream => { stream.getTracks().forEach(track => { track.enabled = false; }); return { stream, error: "" }; })
        .catch(() => ({ stream: null, error: "Allow microphone access in your browser to have a hands-free conversation. You can still hear the assistant and type replies." }))
      : Promise.resolve({ stream: null, error: "This browser doesn't support microphone recording. You can still hear the assistant and type replies." });
    setResources({ context: audioContext, microphone });
  }
  return <>
    <Button ref={startButton} size="sm" onClick={open} disabled={!hasSteps}
      title={!hasSteps ? "Add recipe instructions to start cooking" : undefined}>
      <Play size={14} aria-hidden="true" /> Start
    </Button>
    {unavailable && <span role="alert" className="text-xs">This browser doesn’t support cooking audio.</span>}
    {resources && <CookingSession recipeId={recipeId} title={title} context={resources.context} microphone={resources.microphone} onClose={() => {
      setResources(null);
      // Wait until the modal is removed and the recipe is no longer inert.
      requestAnimationFrame(() => startButton.current?.focus());
    }} />}
  </>;
}

function CookingSession({ recipeId, title, context, microphone, onClose }: {
  recipeId: string; title: string; context: AudioContext; microphone: Promise<MicrophoneAccess>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const player = useRef<CookingAudioPlayer | null>(null);
  const decodedReply = useRef<AudioBuffer | null>(null);
  const listenRef = useRef<() => Promise<void>>(async () => {});
  const recorder = useRef<MediaRecorder | null>(null);
  const micStream = useRef<MediaStream | null>(null);
  const micSource = useRef<MediaStreamAudioSourceNode | null>(null);
  const micMeter = useRef<AnalyserNode | null>(null);
  const detectionTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const resumePlayback = useRef(false);
  const sessionRef = useRef<Session | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<Status>("thinking");
  const [error, setError] = useState("");
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [storageWarning, setStorageWarning] = useState("");
  const [draft, setDraft] = useState("");
  const [heard, setHeard] = useState("");
  const storageKey = `foodeverything:cooking:${recipeId}`;

  const stopMic = useCallback(() => {
    if (recordingTimer.current) clearTimeout(recordingTimer.current);
    recordingTimer.current = null;
    if (detectionTimer.current) clearInterval(detectionTimer.current);
    detectionTimer.current = null;
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    recorder.current = null;
    micStream.current?.getTracks().forEach(track => { track.enabled = false; });
    micStream.current = null;
    micSource.current?.disconnect();
    micSource.current = null;
    micMeter.current?.disconnect();
    micMeter.current = null;
  }, []);

  const speak = useCallback(async (next: Session, signal: AbortSignal, version: number) => {
    const response = await fetch("/api/cooking/speech", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: next.token }), signal,
    });
    if (!response.ok) throw new Error("I couldn't generate spoken audio. Tap Repeat to try again.");
    const bytes = await response.arrayBuffer();
    if (signal.aborted || version !== generation.current) return;
    const buffer = await context.decodeAudioData(bytes);
    if (signal.aborted || version !== generation.current) return;
    decodedReply.current = buffer;
    if (context.state !== "running") {
      setAudioBlocked(true);
      throw new Error("Your browser paused the audio. Tap Enable sound to hear me.");
    }
    setAudioBlocked(false);
    player.current!.play(buffer, () => {
      if (next.paused) { setStatus("paused"); return; }
      setStatus("ready");
      void listenRef.current();
    });
    setStatus("speaking");
  }, [context]);

  const send = useCallback(async (action: Action, text = "") => {
    const version = ++generation.current;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    player.current?.stop();
    decodedReply.current = null;
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
    const audio = new CookingAudioPlayer(context, meter);
    player.current = audio;
    const handleAudioState = () => {
      if (context.state === "running" || context.state === "closed") return;
      ++generation.current;
      controller.current?.abort();
      audio.pause();
      resumePlayback.current = audio.canResume;
      stopMic();
      setAudioBlocked(true);
      setStatus("paused");
      setError("Your browser paused the audio. Tap Enable sound to continue.");
    };
    context.addEventListener("statechange", handleAudioState);
    // Mount opens a new server session; async responses drive subsequent state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void send("start");
    // A mutable request counter, not a DOM ref: cleanup must invalidate the latest turn.
    const requestGeneration = generation;
    return () => {
      ++requestGeneration.current;
      controller.current?.abort();
      stopMic();
      audio.stop();
      context.removeEventListener("statechange", handleAudioState);
      meter.disconnect();
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

  const record = useCallback(async () => {
    const version = ++generation.current;
    controller.current?.abort();
    player.current?.stop();
    setError("");
    setStatus("thinking");
    try {
      const access = await microphone;
      if (version !== generation.current) return;
      if (!access.stream) throw new Error(access.error);
      if (context.state !== "running") { setAudioBlocked(true); throw new Error("Tap Enable sound to resume the conversation."); }
      const stream = access.stream;
      stream.getAudioTracks().forEach(track => { track.enabled = true; });
      micStream.current = stream;
      micSource.current = context.createMediaStreamSource(stream);
      micSource.current.connect(analyser.current!);
      const speechMeter = context.createAnalyser();
      speechMeter.fftSize = 1024;
      micMeter.current = speechMeter;
      micSource.current.connect(speechMeter);
      const detector = new CookingTurnDetector();
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(type => MediaRecorder.isTypeSupported(type));
      if (!mime) throw new Error("This browser can't record a supported format. Please type below.");
      const recording = new MediaRecorder(stream, { mimeType: mime });
      recorder.current = recording;
      const chunks: BlobPart[] = [];
      recording.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recording.onstop = async () => {
        stopMic();
        if (version !== generation.current) return;
        if (!detector.hasSpeech) {
          // Roll over long silent recordings without uploading silence or
          // spending an OpenAI turn. No button is needed to keep listening.
          void listenRef.current();
          return;
        }
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
      recording.start(250);
      setStatus("listening");
      const samples = new Float32Array(speechMeter.fftSize);
      detectionTimer.current = setInterval(() => {
        speechMeter.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
        if (detector.sample(rms, performance.now())) stopMic();
      }, 40);
      recordingTimer.current = setTimeout(() => stopMic(), 60_000);
    } catch (cause) {
      if (version !== generation.current) return;
      stopMic(); setStatus("ready");
      setError(cause instanceof DOMException && cause.name === "NotAllowedError"
        ? "Microphone access was denied. Enable it in browser settings, or type below."
        : cause instanceof Error ? cause.message : "Couldn't open the microphone.");
    }
  }, [context, microphone, send, stopMic]);

  useEffect(() => { listenRef.current = record; }, [record]);

  async function enableSound() {
    try {
      await unlockCookingAudio(context);
      if (context.state !== "running") throw new Error("Audio is still paused by the browser. Check this site's sound permission.");
      setAudioBlocked(false);
      setError("");
      if (player.current?.canResume) {
        player.current.resume();
        setStatus("speaking");
      } else if (decodedReply.current) {
        const paused = sessionRef.current?.paused;
        player.current!.play(decodedReply.current, () => {
          if (paused) { setStatus("paused"); return; }
          setStatus("ready"); void listenRef.current();
        });
        setStatus("speaking");
      } else if (sessionRef.current) { void record(); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't enable audio."); }
  }

  async function togglePause() {
    if (status === "paused") {
      await unlockCookingAudio(context);
      const audio = player.current;
      if (resumePlayback.current && audio?.canResume) {
        audio.resume(); setStatus("speaking");
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
  const label = { thinking: "Preparing your next turn…", speaking: "Your cooking companion is speaking", ready: "Ready when you are", listening: "Listening · just speak naturally", paused: "Take your time. We’re paused." }[status];
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
          {audioBlocked && <Button className="mt-3" onClick={() => void enableSound()}><Volume2 size={16} /> Enable sound</Button>}
          {!session && !busy && <Button className="mt-3" variant="outline" onClick={() => void send("start")}>Try again</Button>}
        </div>}
      </main>
      <footer className="space-y-4 pb-4">
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" disabled={!session || busy || status === "paused"} onClick={() => void send("repeat")}><RotateCcw size={16} /> Repeat</Button>
        </div>
        {heard && <p className="text-center text-xs text-muted-foreground">You: {heard}</p>}
        <form className="flex gap-2" onSubmit={event => {
          event.preventDefault(); if (draft.trim()) { void send("message", draft.trim()); setDraft(""); }
        }}>
          <input value={draft} onChange={event => setDraft(event.target.value)} maxLength={2000}
            disabled={!session || busy || status === "paused"}
            className="min-w-0 flex-1 rounded-full border border-border bg-transparent px-5 py-3 text-sm outline-primary"
            aria-label="Type a message to your cooking assistant" placeholder="Or type a question…" />
          <button type="submit" className="cooking-icon-button" aria-label="Send message"
            disabled={!draft.trim() || !session || busy || status === "paused"}><Send size={20} /></button>
        </form>
        <p className="text-center text-xs text-muted-foreground">AI-generated voice · Speak naturally after I finish. I’ll respond when you pause.</p>
        {!!session?.approved.length && <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer">{session.approved.length} approved change{session.approved.length === 1 ? "" : "s"}</summary>
          <ul className="mt-2 space-y-2">{session.approved.map(m => <li key={m.ingredient_id}>{m.original} → {m.replacement}. {m.note}</li>)}</ul>
        </details>}
      </footer>
    </div>
  </dialog>;
}
