-- 0007_coverage_exclude_staples.sql
--
-- Refines the recipe_coverage() RPC from migration 0006. Original behavior:
-- salt/pepper/oil/water were assumed-present and counted toward matched +
-- total. That inflated coverage numbers (a recipe with 9 real ingredients +
-- 2 staples reported as e.g. 11/11 once you photographed the 9 reals).
--
-- New behavior: those six staples are EXCLUDED from both matched and total.
-- Coverage now reflects only the ingredients you'd actually shop for.

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
  ),
  considered as (
    select ri.id, ri.recipe_id, lower(trim(ri.name)) as norm_name
    from public.recipe_ingredients ri
    where lower(trim(ri.name)) not in (select name from assumed)
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
