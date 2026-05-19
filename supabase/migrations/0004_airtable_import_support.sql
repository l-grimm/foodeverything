-- 0004_airtable_import_support.sql
--
-- Supports importing legacy recipes from Airtable:
--   1. `recipes.image_urls` — array of public URLs for recipe images
--      (originals attached to family-recipe Airtable rows, uploaded to
--      Supabase Storage bucket `recipe-images`).
--   2. `airtable_imports` — per-record audit log parallel to
--      `email_ingestions`. Tracks which Airtable record_ids have been
--      processed so re-runs skip already-handled rows. Stores per-record
--      provenance (base + table + status + error).

alter table public.recipes
    add column if not exists image_urls text[];

create table if not exists public.airtable_imports (
    id                 uuid primary key default gen_random_uuid(),
    airtable_record_id text unique not null,
    airtable_base_id   text not null,
    airtable_table     text not null,
    recipe_id          uuid references public.recipes(id) on delete set null,
    status             text check (status in ('ingested', 'failed', 'skipped')),
    error              text,
    imported_at        timestamptz default now()
);

create index if not exists airtable_imports_record_id_idx
    on public.airtable_imports (airtable_record_id);
