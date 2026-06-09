-- 0031_recipe_coverage_raw_missing_names.sql
--
-- recipe_coverage().missing_names now returns the raw recipe ingredient
-- names instead of the canonical norm_name. The home-page pill renders
-- this value when there's exactly one gap; using the raw name keeps it
-- consistent with what the recipe detail page shows row-by-row.
--
-- Before: recipe "Jean Touitou's Caper Pasta" -> pill said "chile" while
-- the detail page showed "peperoncino" as missing — same underlying gap,
-- two different strings.
-- After: both show "peperoncino".

drop function if exists public.recipe_coverage();

create or replace function public.recipe_coverage()
returns table (
  recipe_id     uuid,
  matched_count int,
  total_count   int,
  coverage      numeric,
  missing_names text[]
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
    select distinct coalesce(c.canonical_name, public.normalize_ingredient(p.name)) as name
    from public.pantry_items p
    left join public.ingredient_canonical_cache c
      on c.raw_name = lower(trim(p.name))
    where p.finished_at is null
  ),
  considered as (
    select ri.id, ri.recipe_id, ri.name as raw_name,
           coalesce(c.canonical_name, public.normalize_ingredient(ri.name)) as norm_name
    from public.recipe_ingredients ri
    left join public.ingredient_canonical_cache c
      on c.raw_name = lower(trim(ri.name))
    where coalesce(c.canonical_name, public.normalize_ingredient(ri.name)) not in (select name from assumed)
  )
  select
    r.id,
    count(distinct c.id) filter (where p.name is not null)::int as matched_count,
    count(distinct c.id)::int as total_count,
    case when count(distinct c.id) > 0
      then round(
        (count(distinct c.id) filter (where p.name is not null))::numeric
          / count(distinct c.id)::numeric, 3)
      else 0::numeric
    end as coverage,
    array_remove(
      array_agg(distinct c.raw_name) filter (where p.name is null and c.id is not null),
      null
    ) as missing_names
  from public.recipes r
  left join considered c on c.recipe_id = r.id
  left join pantry p on p.name = c.norm_name
  group by r.id;
$$;
