-- 0005_local_imports.sql
--
-- Audit table for local file ingestion (family_ocr pipeline). Parallels
-- email_ingestions and airtable_imports: tracks which file paths have been
-- processed so re-runs skip already-ingested images.

create table if not exists public.local_imports (
    id          uuid primary key default gen_random_uuid(),
    file_path   text unique not null,
    file_hash   text,
    recipe_id   uuid references public.recipes(id) on delete set null,
    status      text check (status in ('ingested', 'failed', 'skipped')),
    error       text,
    imported_at timestamptz default now()
);

create index if not exists local_imports_file_path_idx
    on public.local_imports (file_path);
