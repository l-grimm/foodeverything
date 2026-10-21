# Cooking assistant

Start on a recipe detail page. Every session asks about guest restrictions and
equipment before cooking. Tap **Speak**, talk, then tap **Done** (maximum 60
seconds). The assistant responds after each turn. You can also type questions,
“next”, “repeat”, or “pause”. The large control pauses playback or an in-flight
turn; Resume continues playback or asks to repeat the current step.

Substitutions require **Approve & save** or the exact spoken command **approve
substitution**. “Yes” alone does not apply a change. **Reject** or **reject
substitution** dismisses the proposal. Questions and repeats retain the step.

The blue waveform reads PCM samples through Web Audio's AnalyserNode, from both
MediaRecorder's microphone stream and the assistant's actual MP3 playback.
Silence is a flat line. Microphone input is never routed to the speakers.
Recording is explicit, so ambient kitchen sounds cannot create a turn.

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
microphone permissions, unsupported recording, and blocked audio playback have
visible recovery messages; text interaction remains available. Audio is sent to
OpenAI via the authenticated Python backend, through Next.js POST route handlers.
Neither audio recordings nor transcripts are written to Supabase.

Optional backend model settings: `COOKING_MODEL` (default `gpt-4o-mini`),
`COOKING_TRANSCRIPTION_MODEL` (`gpt-4o-mini-transcribe`), and
`COOKING_SPEECH_MODEL` (`gpt-4o-mini-tts`). Model availability depends on the
existing OpenAI account. Official references:
[transcription](https://developers.openai.com/api/docs/guides/speech-to-text),
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

Tests mock OpenAI and Supabase. Manual checks with configured local services:
fresh guest prompt every session; equipment query; question/repeat without
advancement; microphone and assistant waveform; pause while recording, awaiting
a reply, and during playback; resume; close during microphone permission prompt;
explicit approval/rejection; restore in a fresh session; denied microphone;
audio failure; browser storage failure. Test apple/pear, stone fruit, almond and
mussel conflicts, raw apple cider vinegar aliases, plus non-conflicting walnuts,
cashews, shrimp and clams. Generated guest restriction and compound ingredient
handling depend on the model and require manual voice checks.
