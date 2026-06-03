-- 0010_aliases_garlic.sql
--
-- Garlic forms — recipes commonly say "garlic cloves", "head of garlic",
-- "fresh garlic", etc. when the pantry just has "garlic". Collapse all of
-- those to the canonical "garlic".
--
-- garlic powder is intentionally NOT included — it's a distinct dried
-- spice, not interchangeable with fresh garlic in a recipe.

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
  if s in ('miso paste', 'white miso', 'red miso', 'yellow miso', 'brown miso', 'shiro miso', 'aka miso') then
    return 'miso';
  end if;
  if s in ('toasted sesame oil', 'roasted sesame oil', 'dark sesame oil') then
    return 'sesame oil';
  end if;
  if s in ('garlic clove', 'clove of garlic', 'garlic head', 'head of garlic', 'fresh garlic') then
    return 'garlic';
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
