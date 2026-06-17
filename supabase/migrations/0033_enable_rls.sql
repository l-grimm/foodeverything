-- 0033_enable_rls.sql
--
-- Enable Row Level Security on every public table. Supabase's Security
-- Advisor flagged all 9 tables as a CRITICAL issue: with RLS off, the
-- publicly-known anon key has full read/edit/delete access to everything.
--
-- Zero impact on the app — both backends (Vercel web + Fly ingest) use
-- the service_role key, which bypasses RLS entirely. We add NO policies
-- here because nothing legitimate uses the anon role. After this
-- migration, anyone hitting the project URL with the anon key gets
-- empty results / permission errors, which is exactly what we want for
-- a single-user app.
--
-- If we ever add browser-direct Supabase queries (e.g. realtime
-- subscriptions, anon-key reads from a client component), each table
-- will need explicit policies at that point.

alter table public.airtable_imports         enable row level security;
alter table public.local_imports            enable row level security;
alter table public.pantry_items             enable row level security;
alter table public.substack_feeds           enable row level security;
alter table public.email_ingestions         enable row level security;
alter table public.pantry_sessions          enable row level security;
alter table public.ingredient_canonical_cache enable row level security;
alter table public.recipes                  enable row level security;
alter table public.recipe_ingredients       enable row level security;
