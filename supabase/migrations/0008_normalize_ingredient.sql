-- 0008_normalize_ingredient.sql
--
-- Better pantry ↔ recipe matching. Previously the join used plain
-- lower(trim(name)) which missed "flour" / "all-purpose flour",
-- "eggs" / "egg", "mini cucumber" / "cucumber", etc.
--
-- normalize_ingredient() applies (in order):
--   1. lower + trim
--   2. strip leading size modifier (large/mini/small/jumbo/medium)
--   3. a small alias table for the obvious synonyms (all-purpose flour,
--      granulated sugar, kosher salt, etc.) — deliberately NOT including
--      brown sugar / powdered sugar / sesame oil since those are distinct
--      ingredients
--   4. plural → singular (ies→y, oes/shes/xes/zes/ses → drop es, otherwise
--      drop trailing s if not ss). Imperfect on irregulars like
--      "asparagus" → "asparagu", but both sides normalize the same way so
--      matching still works.
--
-- recipe_coverage() is updated to apply normalize_ingredient on both
-- pantry items and recipe ingredients.

create or replace function public.normalize_ingredient(n text) returns text
language plpgsql
immutable
as $$
declare
  s text;
begin
  if n is null then
    return null;
  end if;
  s := lower(trim(n));

  s := regexp_replace(s, '^(extra[-\s]large|extra[-\s]small|jumbo|large|medium|small|mini)\s+', '');

  if s in ('all-purpose flour', 'all purpose flour', 'ap flour') then
    return 'flour';
  end if;
  if s in ('granulated sugar', 'white sugar', 'cane sugar') then
    return 'sugar';
  end if;
  if s in ('kosher salt', 'sea salt', 'table salt', 'fine sea salt', 'flaky salt') then
    return 'salt';
  end if;
  if s in ('freshly ground black pepper', 'ground black pepper') then
    return 'black pepper';
  end if;

  if length(s) > 4 and right(s, 3) = 'ies' then
    return left(s, length(s) - 3) || 'y';
  end if;
  if length(s) > 3 and right(s, 2) = 'es' and substring(s, length(s) - 2, 1) in ('s', 'h', 'x', 'z', 'o') then
    return left(s, length(s) - 2);
  end if;
  if length(s) > 3 and right(s, 1) = 's' and right(s, 2) <> 'ss' then
    return left(s, length(s) - 1);
  end if;

  return s;
end;
$$;

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
    select public.normalize_ingredient(name) as name
    from public.pantry_items where finished_at is null
  ),
  considered as (
    select ri.id, ri.recipe_id, public.normalize_ingredient(ri.name) as norm_name
    from public.recipe_ingredients ri
    where public.normalize_ingredient(ri.name) not in (select name from assumed)
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
