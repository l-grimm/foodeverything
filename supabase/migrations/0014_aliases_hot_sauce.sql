-- 0014_aliases_hot_sauce.sql
--
-- Pantry "buffalo sauce" satisfies recipes calling for the generic "hot
-- sauce". Alias buffalo → hot sauce so the match works in both views.
-- Kept narrow on purpose — sriracha / tabasco / etc. are distinguishable
-- enough that I'd rather wait for the user to flag any of those than
-- bucket them all together up front.

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

  s := regexp_replace(replace(s, '-', ' '), '\s+', ' ', 'g');
  s := trim(s);

  s := regexp_replace(s, '^(extra\s+large|extra\s+small|jumbo|large|medium|small|mini)\s+', '');

  if length(s) > 4 and right(s, 3) = 'ies' then
    s := left(s, length(s) - 3) || 'y';
  elsif length(s) > 3 and right(s, 2) = 'es' and substring(s, length(s) - 2, 1) in ('s', 'h', 'x', 'z', 'o') then
    s := left(s, length(s) - 2);
  elsif length(s) > 3 and right(s, 1) = 's' and right(s, 2) <> 'ss' then
    s := left(s, length(s) - 1);
  end if;

  if s in ('all purpose flour', 'ap flour') then
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
  if s in ('extra virgin olive oil', 'virgin olive oil', 'evoo') then
    return 'olive oil';
  end if;
  if s in ('garlic clove', 'clove of garlic', 'garlic head', 'head of garlic', 'fresh garlic') then
    return 'garlic';
  end if;
  if s in ('lemon wedge', 'lemon zest', 'lemon juice', 'lemon peel', 'lemon slice', 'juice of lemon') then
    return 'lemon';
  end if;
  if s in ('lime wedge', 'lime zest', 'lime juice', 'lime peel', 'lime slice', 'juice of lime') then
    return 'lime';
  end if;
  if s in (
    'chile flake', 'chili flake', 'chilli flake',
    'red chile flake', 'red chili flake', 'red chilli flake',
    'crushed red pepper', 'crushed red pepper flake'
  ) then
    return 'red pepper flake';
  end if;
  if s in (
    'parmesan', 'parm', 'parmigiano', 'parmigiano reggiano',
    'parmesan reggiano', 'parmigiano cheese', 'grated parmesan',
    'grated parmigiano'
  ) then
    return 'parmesan cheese';
  end if;
  if s in ('buffalo sauce') then
    return 'hot sauce';
  end if;

  return s;
end;
$$;
