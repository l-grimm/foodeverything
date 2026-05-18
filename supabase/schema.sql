-- Reconstructed from information_schema query on 2026-05-18.
-- INCOMPLETE: foreign keys, indexes, constraints, defaults, and CHECK constraints
-- are NOT captured here. Treat this as a column reference, not authoritative DDL.
-- INCOMPLETE: substack_feeds may have additional columns past `feed_url`.
-- ARRAY columns: element type assumed `text[]` — verify in Supabase if it matters.

create table public.recipes (
    id                    uuid           not null,
    title                 text           not null,
    source_url            text,
    source_platform       text,         -- e.g. 'substack', 'tiktok', 'web'
    author                text,
    cuisine               text,
    is_family_recipe      boolean,
    course                text,
    holiday               text,
    season                text,
    my_notes              text,
    my_rating             integer,
    made_count            integer,
    last_made_at          date,
    allergens_present     text[],
    has_allergen          boolean,
    extraction_confidence text,         -- e.g. 'high' / 'medium' / 'low'
    yield                 text,
    prep_time             text,
    cook_time             text,
    total_time            text,
    instructions          text[],
    tags                  text[],
    processing_status     text,         -- e.g. 'pending' / 'extracted' / 'failed'
    raw_text              text,
    created_at            timestamptz,
    updated_at            timestamptz
);

create table public.recipe_ingredients (
    id        uuid not null,
    recipe_id uuid,                     -- FK to recipes.id (assumed)
    name      text not null,
    name_raw  text,                     -- verbatim ingredient line from source
    amount    text,
    unit      text,
    prep_note text,
    category  text
);

create table public.pantry_sessions (
    id                     uuid not null,
    photo_urls             text[],
    identified_ingredients text[],
    confirmed_ingredients  text[],
    created_at             timestamptz
);

create table public.substack_feeds (
    id       uuid not null,
    name     text not null,
    feed_url text not null
    -- possibly more columns not captured in the schema dump
);
