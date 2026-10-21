# Cooking assistant

**Start** on a recipe detail page unlocks spoken audio and requests microphone
permission. Once the recipe is ready, the assistant welcomes the cook, asks about
guest restrictions, and waits. After a clear answer, it asks about the equipment
needed for this recipe and waits again. Equipment questions or missing tools are
resolved before cooking. Every fresh session repeats guest setup.

The conversation stays open through assistant speech, processing, and spoken
pauses. There are no manual listening or pause controls. Say “okay”, “next”, or
“done” to continue one cooking step at a time; questions and repeats retain the
step. “Pause” holds the recipe; “resume” repeats the current step or setup question.
Closing the conversation (or saying “end conversation”) releases the microphone.
A collapsed text input remains available as a fallback.

A proposed substitution requires explicit approval. “Yes” or “yes please” approves
only when a specific proposal is pending; “okay” alone does not. “No” rejects that
proposal. The assistant cannot manufacture approval through a generated decision.
Approved changes are saved separately, preserving the source recipe.

WebRTC carries continuous microphone audio to an OpenAI transcription session.
Server voice activity detection identifies user turns and interrupts assistant
playback as soon as speech starts. Completed transcripts are processed in order;
HTTP turns are serialized so interruptions cannot lose signed state or approvals.
The backend negotiates SDP using server-only credentials and a short-lived
transcription credential; the browser receives only SDP, never an API key.
The input connection does not generate responses or modify recipe state.

The blue waveform reads PCM samples through Web Audio's AnalyserNode from both
the live microphone and decoded assistant speech. Silence is a flat line.
Microphone input is never routed to speakers. Echo cancellation, noise suppression,
and provider voice detection reduce kitchen noise; noisy-room performance and
speaker echo still need checks on the target device.

Speech plays through AudioBufferSourceNode in the AudioContext unlocked by Start.
If the browser suspends audio or the connection fails, a visible recovery control
appears. The microphone remains connected during a spoken pause; close the
conversation to end audio transmission.

## Local configuration

Reuse the existing backend with its server-only `OPENAI_API_KEY`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, and `WEBHOOK_TOKEN`. Set `WEBHOOK_BASE_URL` (for local
work, `http://localhost:8000`) and matching `WEBHOOK_TOKEN` in `web/.env.local`.
Never use `NEXT_PUBLIC_` for credentials. This repository is a personal,
single-user app without end-user authentication; new routes retain that access
model and reject cross-origin browser requests. Account authentication and
distributed rate limits are needed before opening it as a public service.

Run the Python backend with the repository's Python 3.11+ environment:

```sh
uv run uvicorn food_everything.api.main:app --reload --port 8000
```

Run `npm run dev` in `web`. Use HTTPS or localhost for microphone access. Denied
microphone permissions, unsupported WebRTC, and blocked playback have visible
messages. Audio goes directly to OpenAI over the negotiated WebRTC connection;
transcripts and recipe turns pass through the authenticated backend via Next.js.
Speech generation remains server-side. Neither recordings nor transcripts are
written to Supabase. Continuous audio is transmitted until the conversation closes,
including while the assistant speaks and while recipe guidance is paused.

Optional backend model settings: `COOKING_MODEL` (default `gpt-4o-mini`),
`COOKING_LIVE_TRANSCRIPTION_MODEL` (`gpt-4o-mini-transcribe`),
`COOKING_TRANSCRIPTION_MODEL` (legacy recording endpoint), and
`COOKING_SPEECH_MODEL` (`gpt-4o-mini-tts`). Model availability depends on the
existing OpenAI account. Official references:
[live transcription](https://developers.openai.com/api/docs/guides/realtime-transcription),
[speech generation](https://developers.openai.com/api/docs/guides/text-to-speech),
[structured output](https://developers.openai.com/api/docs/guides/structured-outputs).

## Preservation and persistence

Original recipe and ingredient rows are read only. Approved substitutions remain
separate overlays, used when narrating instructions. The browser saves signed
preferences with approved modifications in localStorage. The saved copy contains
recipe ID, recipe version, and approved changes; guest answers, equipment answers,
and conversation history stay in the active session token. Clearing site data removes that copy.
Future sessions restore approved modifications as **suggestions requiring new
approval**, considering today's guests. Changes to source ingredients or
instructions invalidate saved suggestions. Signed sessions expire after eight
hours; their approved suggestions can still be restored into a fresh session.
Signing prevents client edits from manufacturing approvals; it is not encryption.

Cloud persistence is **off by default**. Migration
`supabase/migrations/0034_cooking_recipe_variants.sql` is a draft and must not be
applied to the live database without explicit owner approval. After an approved
migration, setting `COOKING_VARIANTS_ENABLED=true` on the backend enables reads
and writes solely to that new table. RLS blocks anonymous access; the existing
server service role owns access. Each recipe/version has one saved variant in
this single-user app. Cloud save failures retain the session and browser copy
and display a warning. Never enable this flag against live Supabase without
approval.

## Validation

```sh
PYTHONPATH=src uv run python -m unittest discover -s tests -v
cd web
npx tsc --noEmit
npm test
npm run lint
npm run build
```

Tests mock OpenAI and Supabase. They cover setup waiting states, natural next-step
commands, pause/resume state, substitution approvals, continuous input, transcript
ordering, interrupted requests, resource cleanup, and credential isolation.

`web/tests/fixtures/cooking-handsfree.tsx` is a local browser fixture using the real
component and Web Audio with synthetic microphone input and a mocked WebRTC peer.
It scripts guest setup, equipment confirmation, next, a question, pause, and resume
with a single microphone and connection. Temporarily re-export it as a local Next
page to run it; remove that route afterward and never deploy it.

Mock tests cannot establish provider/account availability or real microphone,
echo, speaker, mobile backgrounding, or noisy-kitchen behavior. Those require an
explicitly authorized live integration check. Cloud persistence remains disabled.
