-- 0029_recipe_coverage_dedupe_join.sql
--
-- Join-amplification fix in recipe_coverage(). The cache-backed
-- version of the function (migration 0028) inflated both matched_count
-- and total_count when the pantry contained multiple items mapping to
-- the same canonical (e.g. "red onion" + "yellow onion" + "shallot" +
-- "onion powder" all -> "onion"). Every considered recipe ingredient
-- with that canonical was duplicated by the left join.
--
-- Symptom: tzatziki (6 ingredients in recipe_ingredients) reported
-- total_count = 7. Home page showed "missing 1" on recipes whose
-- detail page had every ingredient checked.
--
-- Fix:
--   1. distinct in the pantry CTE so each canonical appears once
--   2. count(distinct c.id) in the totals as belt + suspenders against
--      the same recipe listing duplicate ingredients (e.g. "salt" plus
--      "kosher salt" both -> "salt")

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
    select distinct coalesce(c.canonical_name, public.normalize_ingredient(p.name)) as name
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
    count(distinct c.id) filter (where p.name is not null)::int as matched_count,
    count(distinct c.id)::int as total_count,
    case when count(distinct c.id) > 0
      then round(
        (count(distinct c.id) filter (where p.name is not null))::numeric
          / count(distinct c.id)::numeric, 3)
      else 0::numeric
    end as coverage
  from public.recipes r
  left join considered c on c.recipe_id = r.id
  left join pantry p on p.name = c.norm_name
  group by r.id;
$$;
