-- 0028_ingredient_canonical_cache.sql
--
-- Move ingredient matching from the hardcoded SQL alias function to a
-- (raw_name -> canonical_name) cache table. New ingredient names get
-- canonicalized via LLM at ingest time and cached forever. Manual
-- overrides stay possible (source = 'manual' wins).
--
-- recipe_coverage() reads canonical via the cache, falling back to the
-- old normalize_ingredient() for any rows not yet in the cache. The old
-- function stays in place as a safety net; future migration will drop it
-- once we're confident the cache covers everything.

create table public.ingredient_canonical_cache (
  raw_name       text primary key,
  canonical_name text not null,
  source         text not null check (source in ('manual', 'llm', 'alias_legacy', 'fallback')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index ingredient_canonical_cache_canonical_idx
  on public.ingredient_canonical_cache (canonical_name);

-- Pre-populate from existing data: every distinct raw name in
-- recipe_ingredients + pantry_items gets mapped via the current
-- normalize_ingredient() output.
insert into public.ingredient_canonical_cache (raw_name, canonical_name, source)
select distinct
  lower(trim(name)) as raw_name,
  public.normalize_ingredient(name) as canonical_name,
  'alias_legacy' as source
from public.recipe_ingredients
where name is not null
on conflict (raw_name) do nothing;

insert into public.ingredient_canonical_cache (raw_name, canonical_name, source)
select distinct
  lower(trim(name)) as raw_name,
  public.normalize_ingredient(name) as canonical_name,
  'alias_legacy' as source
from public.pantry_items
where name is not null
on conflict (raw_name) do nothing;

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
    select unnest(array[
      'salt', 'pepper', 'black pepper', 'oil', 'olive oil', 'water',
      'salt and pepper'
    ]) as name
  ),
  pantry as (
    select coalesce(c.canonical_name, public.normalize_ingredient(p.name)) as name
    from public.pantry_items p
    left join public.ingredient_canonical_cache c
      on c.raw_name = lower(trim(p.name))
    where p.finished_at is null
  ),
  considered as (
    select ri.id, ri.recipe_id,
           coalesce(c.canonical_name, public.normalize_ingredient(ri.name)) as norm_name
    from public.recipe_ingredients ri
    left join public.ingredient_canonical_cache c
      on c.raw_name = lower(trim(ri.name))
    where coalesce(c.canonical_name, public.normalize_ingredient(ri.name)) not in (select name from assumed)
  )
  select
    r.id,
    count(*) filter (where p.name is not null)::int as matched_count,
    count(c.id)::int as total_count,
    case when count(c.id) > 0
      then round((count(*) filter (where p.name is not null))::numeric / count(c.id)::numeric, 3)
      else 0::numeric
    end as coverage
  from public.recipes r
  left join considered c on c.recipe_id = r.id
  left join pantry p on p.name = c.norm_name
  group by r.id;
$$;
