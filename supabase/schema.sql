-- Reflects the live schema of project hywglmaoixrrfiaezukx as of 2026-05-18.
-- Captured from information_schema queries; refreshed after the full audit.
-- ARRAY columns are text[] unless noted.

create table public.recipes (
    id                    uuid           primary key default gen_random_uuid(),
    title                 text           not null,
    source_url            text,
    source_platform       text           check (source_platform in
                                            ('tiktok','instagram','substack','url','manual')),
    author                text,
    yield                 text,
    prep_time             text,
    cook_time             text,
    total_time            text,
    instructions          text[],
    tags                  text[],
    cuisine               text,
    is_family_recipe      boolean        default false,
    course                text,
    holiday               text,
    season                text,
    my_notes              text,
    my_rating             integer        check (my_rating between 1 and 5),
    made_count            integer        default 0,
    last_made_at          date,
    allergens_present     text[]         default '{}'::text[],
    has_allergen          boolean,
    extraction_confidence text           default 'high' check (extraction_confidence in
                                            ('high','needs_review','manual')),
    processing_status     text           default 'approved' check (processing_status in
                                            ('pending_review','approved','flagged')),
    raw_text              text,
    created_at            timestamptz    default now(),
    updated_at            timestamptz    default now()
);

create table public.recipe_ingredients (
    id        uuid primary key default gen_random_uuid(),
    recipe_id uuid references public.recipes(id) on delete cascade,  -- cascade added by migration 0001
    name      text not null,
    name_raw  text,
    amount    text,
    unit      text,
    prep_note text,
    category  text check (category in
                  ('produce','dairy','protein','grain','pantry_staple','other'))
);

create table public.pantry_sessions (
    id                     uuid primary key default gen_random_uuid(),
    photo_urls             text[],
    identified_ingredients text[],
    confirmed_ingredients  text[],
    created_at             timestamptz default now()
);

create table public.substack_feeds (
    id           uuid primary key default gen_random_uuid(),
    name         text not null,
    feed_url     text not null,
    last_checked timestamptz,
    active       boolean default true,
    created_at   timestamptz default now()
);
