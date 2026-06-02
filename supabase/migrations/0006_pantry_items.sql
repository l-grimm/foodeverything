-- 0006_pantry_items.sql
--
-- Digital pantry. Each grocery-photo ingestion writes one pantry_sessions
-- row (audit log) + N pantry_items rows (the queryable inventory).
--
-- v1: presence-only. quantity, unit, finished_at columns are added now but
-- unused until v2 (mark-finished, partial-amount tracking). Including them
-- in the initial schema means v2 needs no migration — just code.
--
-- recipe_coverage() RPC powers the "what can I make?" view. Ingredients
-- match on lower(trim(name)) — GPT extraction is prompted to emit canonical
-- singular forms on both pantry and recipe sides, so this works without
-- fancier normalization. Salt/pepper/oil/water are assumed always-present
-- per user decision; flour/butter/etc. must be photographed intentionally.

create table public.pantry_items (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,                            -- canonical, lowercase, singular
  name_raw          text,                                     -- verbatim what GPT saw on the photo
  category          text check (category in (
                      'produce', 'dairy', 'protein', 'grain', 'pantry_staple', 'other'
                    )),
  source_session_id uuid references public.pantry_sessions(id) on delete set null,
  source_image_url  text,
  quantity          numeric,                                  -- v2
  unit              text,                                     -- v2
  added_at          timestamptz not null default now(),
  finished_at       timestamptz                               -- v2; null = still have it
);

create index pantry_items_active_name_idx
  on public.pantry_items (lower(trim(name)))
  where finished_at is null;

-- Recipe coverage. One row per recipe with at least one ingredient.
-- coverage = matched_count / total_count, in [0, 1].
create or replace function public.recipe_coverage()
returns table (
  recipe_id     uuid,
  matched_count int,
  total_count   int,
  coverage      numeric
)
language sql
stable
as $$
  with assumed as (
    select unnest(array['salt', 'pepper', 'black pepper', 'oil', 'olive oil', 'water']) as name
  ),
  pantry as (
    select lower(trim(name)) as name from public.pantry_items where finished_at is null
    union
    select name from assumed
  )
  select
    r.id,
    count(*) filter (where p.name is not null)::int                                            as matched_count,
    count(*)::int                                                                              as total_count,
    round((count(*) filter (where p.name is not null))::numeric / nullif(count(*), 0)::numeric, 3) as coverage
  from public.recipes r
  join public.recipe_ingredients ri on ri.recipe_id = r.id
  left join pantry p on p.name = lower(trim(ri.name))
  group by r.id;
$$;
