-- 0024_aliases_salt_and_pepper_compound.sql
--
-- Compound "salt and pepper" ingredient names. Recipes commonly list them
-- as a single line ("Salt and pepper, to taste"). Collapse the many
-- spellings and add the canonical "salt and pepper" to the assumed-staple
-- list so coverage doesn't see them as missing.
--
-- Aliases (post-plural-strip forms):
--   salt and ground pepper / s&p / s & p / salt and freshly ground pepper /
--   salt and freshly ground black pepper / salt and black pepper /
--   salt and ground black pepper  ->  salt and pepper
--
-- recipe_coverage() also gets "salt and pepper" added to its assumed array
-- so the compound counts the same as the individual staples.

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
  if s in (
    'kosher salt', 'sea salt', 'table salt', 'fine sea salt',
    'flaky salt', 'coarse salt',
    'diamond crystal kosher salt', 'diamond crystal salt', 'morton kosher salt'
  ) then
    return 'salt';
  end if;
  if s in ('freshly ground black pepper', 'ground black pepper', 'ground pepper') then
    return 'pepper';
  end if;
  if s in (
    'salt and ground pepper', 's&p', 's & p',
    'salt and freshly ground pepper', 'salt and freshly ground black pepper',
    'salt and black pepper', 'salt and ground black pepper'
  ) then
    return 'salt and pepper';
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
  if s in (
    'vegetable oil', 'grapeseed oil',
    'vegetable or grapeseed oil', 'grapeseed or vegetable oil'
  ) then
    return 'canola oil';
  end if;
  if s in ('apple cider vinegar') then
    return 'champagne vinegar';
  end if;
  if s in ('unsalted butter', 'salted butter') then
    return 'butter';
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
    'crushed red pepper', 'crushed red pepper flake',
    'piment d''espelette', 'espelette pepper'
  ) then
    return 'red pepper flake';
  end if;
  if s in (
    'parmesan', 'parm', 'parmigiano', 'parmigiano reggiano',
    'parmesan reggiano', 'parmigiano cheese', 'parmigiano reggiano cheese',
    'grated parmesan', 'grated parmigiano',
    'pecorino or parmesan', 'parmesan or pecorino'
  ) then
    return 'parmesan cheese';
  end if;
  if s in ('parsley leave', 'parsley leaves and tender stem', 'fresh parsley') then
    return 'parsley';
  end if;
  if s in ('thyme leave', 'fresh thyme') then
    return 'thyme';
  end if;
  if s in ('buffalo sauce', 'hot pepper sauce') then
    return 'hot sauce';
  end if;
  if s in ('cumin seed', 'ground cumin', 'whole cumin') then
    return 'cumin';
  end if;
  if s in ('coriander seed', 'ground coriander', 'whole coriander') then
    return 'coriander';
  end if;
  if s in ('sichuan peppercorn') then
    return 'szechuan peppercorn';
  end if;
  if s in ('chicken bouillon') then
    return 'chicken stock';
  end if;
  if s in ('english cucumber') then
    return 'cucumber';
  end if;
  if s in ('whole milk', 'skim milk') then
    return 'milk';
  end if;
  if s in ('beef chuck roast', 'beef roast', 'chuck roast') then
    return 'beef chuck';
  end if;
  if s in ('anchovy paste') then
    return 'anchovy';
  end if;
  if s in ('pancetta') then
    return 'speck';
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
    select unnest(array[
      'salt', 'pepper', 'black pepper', 'oil', 'olive oil', 'water',
      'salt and pepper'
    ]) as name
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
