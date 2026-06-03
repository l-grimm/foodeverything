-- 0009_aliases_miso_sesame_oil.sql
--
-- Two more alias buckets after observing real-world mismatches:
--
-- 1. Miso variants. User's pantry typically holds "miso paste" or a colored
--    miso ("white miso", "red miso"); recipes usually just say "miso".
--    Alias all common forms to the canonical "miso".
--
-- 2. Sesame oil variants. The everyday cooking ingredient is the toasted /
--    roasted dark-amber stuff; recipes write any of "sesame oil", "toasted
--    sesame oil", or "roasted sesame oil" interchangeably. Collapse them.

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
