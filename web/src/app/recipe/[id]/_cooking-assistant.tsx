"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Send, Volume2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CookingAudioPlayer, unlockCookingAudio } from "@/lib/cooking-audio";
import { CookingConversation, CookingLiveInput } from "@/lib/cooking-conversation";

type Modification = { ingredient_id: string; original: string; replacement: string; note: string };
type Session = {
  token: string; saved_token: string; reply: string; step: number; total: number;
  phase: string; pending: Modification | null; approved: Modification[]; paused: boolean; warning: string;
};
type Status = "preparing" | "thinking" | "speaking" | "listening" | "paused" | "error";
type Access = { stream: MediaStream | null; error: string };
type Resources = { context: AudioContext; microphone: Promise<Access> };

export function CookingAssistant({ recipeId, title, hasSteps }: {
  recipeId: string; title: string; hasSteps: boolean;
}) {
  const [resources, setResources] = useState<Resources | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const startButton = useRef<HTMLButtonElement>(null);
  useEffect(() => () => {
    if (!resources) return;
    if (resources.context.state !== "closed") void resources.context.close();
    void resources.microphone.then(({ stream }) => stream?.getTracks().forEach(track => track.stop()));
  }, [resources]);

  function open() {
    if (typeof AudioContext === "undefined" || typeof RTCPeerConnection === "undefined") {
      setUnavailable(true); return;
    }
    const context = new AudioContext();
    void unlockCookingAudio(context).catch(() => { /* A recovery gesture is shown if required by the browser. */ });
    const microphone: Promise<Access> = typeof navigator.mediaDevices?.getUserMedia === "function"
      ? navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
        .then(stream => ({ stream, error: "" }))
        .catch(() => ({ stream: null, error: "Allow microphone access for this conversation, then reopen it. You can still type a reply." }))
      : Promise.resolve({ stream: null, error: "This browser cannot open the microphone. Try a supported browser on HTTPS." });
    setResources({ context, microphone });
  }

  return <>
    <Button ref={startButton} size="sm" onClick={open} disabled={!hasSteps}
      title={!hasSteps ? "Add recipe instructions to start cooking" : "Open a spoken cooking conversation"}>
      <Play size={14} aria-hidden="true" /> Start
    </Button>
    {unavailable && <span role="alert" className="text-xs">This browser doesn’t support voice conversations.</span>}
    {resources && <CookingSession recipeId={recipeId} title={title} {...resources} onClose={() => {
      setResources(null);
      requestAnimationFrame(() => startButton.current?.focus());
    }} />}
  </>;
}

function CookingSession({ recipeId, title, context, microphone, onClose }: {
  recipeId: string; title: string; context: AudioContext; microphone: Promise<Access>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const conversation = useRef<CookingConversation<Session> | null>(null);
  const retry = useRef<() => Promise<void>>(async () => {});
  const close = useRef(onClose);
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<Status>("preparing");
  const [error, setError] = useState("");
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [storageWarning, setStorageWarning] = useState("");
  const [heard, setHeard] = useState("");
  const [draft, setDraft] = useState("");
  useEffect(() => { close.current = onClose; }, [onClose]);

  useEffect(() => {
    const modal = dialog.current!;
    modal.showModal();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const lifetime = new AbortController();
    const meter = context.createAnalyser();
    meter.fftSize = 512;
    analyser.current = meter;
    const player = new CookingAudioPlayer(context, meter);
    let speechRequest: AbortController | null = null;
    let input: CookingLiveInput | null = null;
    let inputOpening: Promise<void> | null = null;
    let micSource: MediaStreamAudioSourceNode | null = null;
    let current: Session | null = null;
    const storageKey = `foodeverything:cooking:${recipeId}`;

    function showError(cause: unknown) {
      if (lifetime.signal.aborted) return;
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "The conversation couldn't continue. Please try again.");
      setStatus("error");
    }

    async function post(operation: string, body: object, signal = lifetime.signal) {
      const response = await fetch(`/api/cooking/${operation}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error ?? "The voice service couldn't respond. Please try again.");
      }
      return response;
    }

    function openInput(token: string) {
      if (inputOpening) return inputOpening;
      inputOpening = (async () => {
        const access = await microphone;
        if (lifetime.signal.aborted) throw new DOMException("Closed", "AbortError");
        if (!access.stream) throw new Error(access.error);
        if (!micSource) {
          micSource = context.createMediaStreamSource(access.stream);
          micSource.connect(meter); // Never connect the microphone to speakers.
        }
        input = new CookingLiveInput({
          speech: () => { engine.interrupt(); setStatus("listening"); },
          transcript: text => {
            if (/^(end (the )?(conversation|session)|goodbye)[.!]?$/i.test(text.trim())) {
              close.current(); return;
            }
            setHeard(text);
            void engine.submit("message", text);
          },
          empty: () => {
            if (player.canResume && context.state === "running") { player.resume(); setStatus("speaking"); }
            else setStatus(current?.paused ? "paused" : "listening");
          },
          error: (cause, fatal) => {
            if (fatal) { inputOpening = null; showError(cause); }
            else { setError(cause.message); setStatus(current?.paused ? "paused" : "listening"); }
          },
        });
        await input.connect(access.stream, async sdp => {
          const response = await post("connect", { token, sdp });
          return (await response.json()).sdp;
        });
      })().catch(cause => {
        input?.close(); inputOpening = null;
        throw cause;
      });
      return inputOpening;
    }

    async function speak(next: Session) {
      speechRequest?.abort();
      const request = new AbortController();
      speechRequest = request;
      const aborted = AbortSignal.any([request.signal, lifetime.signal]);
      // Prepare audio and input together. A spoken question must have an open
      // microphone connection ready to receive its answer.
      const audio = post("speech", { token: next.token }, aborted)
        .then(response => response.arrayBuffer()).then(bytes => context.decodeAudioData(bytes));
      const results = await Promise.allSettled([audio, openInput(next.token)]);
      if (aborted.aborted) return;
      if (results[0].status === "rejected") throw results[0].reason;
      const connectionFailed = results[1].status === "rejected";
      if (results[1].status === "rejected") showError(results[1].reason);
      if (context.state !== "running") {
        setAudioBlocked(true);
        throw new Error("Your browser paused spoken audio. Enable sound to continue.");
      }
      setAudioBlocked(false);
      player.play(results[0].value, () => {
        if (!lifetime.signal.aborted) setStatus(connectionFailed ? "error" : next.paused ? "paused" : "listening");
      });
      setStatus("speaking");
    }

    const engine = new CookingConversation<Session>({
      exchange: async (previous, turn) => {
        let saved: string | null = null;
        if (turn.action === "start") { try { saved = localStorage.getItem(storageKey); } catch {} }
        const response = await post("turn", { recipe_id: recipeId, action: turn.action, text: turn.text,
          token: previous?.token ?? null, saved_token: saved });
        return response.json();
      },
      state: next => {
        current = next;
        setSession(next);
        if (next.approved.length) {
          try { localStorage.setItem(storageKey, next.saved_token); }
          catch { setStorageWarning("This browser couldn't save the approved changes for later."); }
        }
      },
      reply: speak,
      interrupt: () => { speechRequest?.abort(); player.pause(); },
      thinking: () => { setError(""); setStatus("thinking"); },
      error: showError,
    });
    conversation.current = engine;
    retry.current = async () => {
      try {
        await unlockCookingAudio(context);
        setAudioBlocked(false); setError("");
        if (current) await speak(current); else await engine.submit("start");
      } catch (cause) { showError(cause); }
    };
    const audioState = () => {
      if (context.state === "running" || context.state === "closed") return;
      player.pause(); setAudioBlocked(true);
      showError(new Error("Your browser paused spoken audio. Enable sound to continue."));
    };
    context.addEventListener("statechange", audioState);
    // Only pressing Start mounts this component and opens a fresh conversation.
    void engine.submit("start");
    return () => {
      lifetime.abort(); engine.close(); speechRequest?.abort(); input?.close(); player.stop();
      context.removeEventListener("statechange", audioState);
      micSource?.disconnect(); meter.disconnect();
      document.body.style.overflow = oldOverflow;
      modal.close();
    };
  }, [context, microphone, recipeId]);

  useEffect(() => {
    const surface = canvas.current!;
    const drawing = surface.getContext("2d")!;
    const samples = new Uint8Array(256);
    let frame = 0;
    let raf = 0;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const draw = () => {
      if (!reduceMotion.matches || ++frame % 5 === 0) {
        const width = surface.clientWidth, height = surface.clientHeight;
        const ratio = window.devicePixelRatio || 1;
        if (surface.width !== Math.round(width * ratio) || surface.height !== Math.round(height * ratio)) {
          surface.width = Math.round(width * ratio); surface.height = Math.round(height * ratio);
        }
        drawing.setTransform(ratio, 0, 0, ratio, 0, 0);
        drawing.clearRect(0, 0, width, height);
        analyser.current?.getByteTimeDomainData(samples);
        drawing.strokeStyle = "#0963e7"; drawing.lineWidth = 3; drawing.lineCap = "round";
        drawing.beginPath();
        for (let i = 0; i < samples.length; i++) {
          const x = i / (samples.length - 1) * width;
          const y = height / 2 + (samples[i] - 128) / 128 * height * 0.46 * Math.sin(Math.PI * i / (samples.length - 1));
          if (i === 0) drawing.moveTo(x, y); else drawing.lineTo(x, y);
        }
        drawing.stroke();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  const labels: Record<Status, string> = {
    preparing: "Getting your recipe ready…", thinking: "I'm thinking—you can keep talking",
    speaking: "Your cooking companion is speaking", listening: "I'm listening",
    paused: "I'm here. Say resume when you're ready", error: "Let's reconnect",
  };
  return <dialog ref={dialog} className="cooking-dialog" aria-labelledby="cooking-title"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col px-6 py-5 sm:px-12 sm:py-6">
      <header className="flex items-center justify-between gap-4">
        <span className="label-mono">FoodEverything · Let’s cook</span>
        <button type="button" onClick={onClose} aria-label="End cooking conversation" className="cooking-icon-button"><X size={22} /></button>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center py-8 text-center">
        <p className="label-mono mb-3">{session?.phase === "cooking" && session.step >= 0
          ? session.step < session.total ? `Step ${session.step + 1} of ${session.total}` : "Ready to serve"
          : "A little preparation"}</p>
        <h1 id="cooking-title" className="font-display max-w-xl text-3xl leading-tight sm:text-4xl">{title}</h1>
        <canvas ref={canvas} className="my-8 h-32 w-full" aria-hidden="true" />
        <p role="status" className="text-sm text-muted-foreground">{labels[status]}</p>
        <p className="mt-6 max-w-lg text-lg leading-relaxed" aria-live="polite">{session?.reply ?? "Getting your recipe ready…"}</p>
        {session?.pending && <div className="mt-6 w-full rounded-2xl border border-primary/25 p-5 text-left">
          <p className="label-mono mb-2">Waiting for your approval</p>
          <p>{session.pending.original} → {session.pending.replacement}</p>
          <p className="mt-2 text-sm text-muted-foreground">{session.pending.note}</p>
        </div>}
        {(error || storageWarning || session?.warning) && <div role="alert" className="mt-5 text-sm text-destructive">
          {error && <><p>{error}</p><Button className="mt-3" onClick={() => void retry.current()}>
            {audioBlocked && <Volume2 size={16} />}{audioBlocked ? "Enable sound" : "Reconnect"}
          </Button></>}
          {storageWarning && <p>{storageWarning}</p>}{session?.warning && <p>{session.warning}</p>}
        </div>}
      </main>
      <footer className="space-y-4 pb-4 text-sm text-muted-foreground">
        <p className="text-center text-xs">AI-generated voice · This conversation stays open until you close it.</p>
        <details><summary className="cursor-pointer text-center">Type a reply</summary>
          <form className="mt-3 flex gap-2" onSubmit={event => {
            event.preventDefault();
            if (draft.trim()) { setHeard(draft.trim()); void conversation.current?.submit("message", draft.trim()); setDraft(""); }
          }}>
            <input value={draft} onChange={event => setDraft(event.target.value)} maxLength={2000}
              disabled={!session} className="min-w-0 flex-1 rounded-full border border-border bg-transparent px-5 py-3 outline-primary"
              aria-label="Type a message to your cooking assistant" placeholder="Type a reply…" />
            <button type="submit" className="cooking-icon-button" aria-label="Send message" disabled={!draft.trim() || !session}><Send size={20} /></button>
          </form>
        </details>
        {heard && <p className="text-center text-xs">You: {heard}</p>}
        {!!session?.approved.length && <details><summary className="cursor-pointer">Approved recipe changes</summary>
          <ul className="mt-2 space-y-2">{session.approved.map(m => <li key={m.ingredient_id}>{m.original} → {m.replacement}. {m.note}</li>)}</ul>
        </details>}
      </footer>
    </div>
  </dialog>;
}
