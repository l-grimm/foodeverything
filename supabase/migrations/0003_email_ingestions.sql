-- 0003_email_ingestions.sql
--
-- Tracks which Gmail messages have been processed by the Gmail recipe
-- pipeline so subsequent runs skip already-handled emails. Stores per-email
-- metadata for visibility ("what got ingested? what failed and why?").
--
-- recipe_id is nullable + ON DELETE SET NULL: if a recipe is deleted later,
-- we keep the ingestion record (so we don't reprocess the same email) but
-- clear the dangling FK.

create table if not exists public.email_ingestions (
    id                uuid primary key default gen_random_uuid(),
    gmail_message_id  text unique not null,
    recipe_id         uuid references public.recipes(id) on delete set null,
    status            text check (status in ('ingested', 'failed', 'skipped')),
    error             text,
    email_subject     text,
    email_from        text,
    email_received_at timestamptz,
    ingested_at       timestamptz default now()
);

create index if not exists email_ingestions_gmail_message_id_idx
    on public.email_ingestions (gmail_message_id);
