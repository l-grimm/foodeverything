-- 0032_tag_taxonomy_cleanup.sql
--
-- Clean up the recipes.tags / recipes.holiday taxonomy mess that accumulated
-- across multiple extractors (URL/Substack/Instagram/TikTok/family-OCR).
--
-- Three things happen, in one transaction:
--
-- 1. Holiday column normalization (dedupe casing, fold synonyms, drop fluff).
--
-- 2. Cross-column moves: where a tag is really a holiday/season/cuisine/course,
--    set that column from the tag (only when target column is NULL — never
--    overwrite extractor-chosen values). The tag itself then gets dropped in
--    step 3 because it's not in the keep-set.
--
-- 3. Tag normalization: lowercase + hyphenate, dedupe via array_agg(distinct),
--    map known synonyms to one canonical form, drop everything not in the
--    curated keep-set (descriptive fluff like "delicious", TikTok hashtag
--    sludge like "easyrecipeideas", recipe-specific one-offs like
--    "fugazzeta", and things already covered by other facets).
--
-- Net effect: ~250 distinct tag values → ~37, all lowercase-hyphenated.
-- Holiday: 17 distinct → 8.

begin;

----------------------------------------------------------------------
-- 1. Holiday column normalization
----------------------------------------------------------------------

update public.recipes
  set holiday = 'Passover'
  where holiday in ('passover', 'פסח');

update public.recipes
  set holiday = 'Hanukkah'
  where holiday = 'Chanukah';

update public.recipes
  set holiday = 'New Year''s'
  where holiday in ('New Year', E'New Year’s');

update public.recipes
  set holiday = null
  where holiday in (
    'None', 'holiday', 'holiday weekend',
    'Jewish Culture Month', 'Recipe Advent Calendar', 'Football'
  );

----------------------------------------------------------------------
-- 2. Cross-column backfills from tags (only when target is NULL)
----------------------------------------------------------------------

-- → holiday
update public.recipes set holiday = 'Passover'
  where holiday is null
    and tags && array['passover', 'Passover', 'passoverrecipes'];

update public.recipes set holiday = 'Thanksgiving'
  where holiday is null
    and tags && array['thanksgiving', 'Thanksgiving'];

update public.recipes set holiday = 'Christmas'
  where holiday is null
    and tags && array['Christmas'];

update public.recipes set holiday = 'Hanukkah'
  where holiday is null
    and tags && array['chanukah'];

-- → season
update public.recipes set season = 'summer'
  where season is null
    and tags && array['summer', 'summerrecipes', 'summerfood', 'summerdrinks', 'летнийрецепт'];

update public.recipes set season = 'winter'
  where season is null
    and tags && array['winter', 'cold-weather'];

update public.recipes set season = 'fall'
  where season is null
    and tags && array['fall', 'autumn', 'fall flavors'];

update public.recipes set season = 'spring'
  where season is null
    and tags && array['spring'];

-- → cuisine
update public.recipes set cuisine = 'Italian'
  where cuisine is null
    and tags && array['italian', 'cucinaitaliana'];

update public.recipes set cuisine = 'Mexican'
  where cuisine is null
    and tags && array['Mexican'];

update public.recipes set cuisine = 'Asian'
  where cuisine is null
    and tags && array['asianfood'];

update public.recipes set cuisine = 'Mediterranean'
  where cuisine is null
    and tags && array['mediterranean', 'Mediterraneanfood'];

update public.recipes set cuisine = 'Middle Eastern'
  where cuisine is null
    and tags && array['middleeasternfood'];

-- → course
update public.recipes set course = 'dessert'
  where course is null
    and tags && array['dessert'];

update public.recipes set course = 'appetizer'
  where course is null
    and tags && array['appetizer'];

update public.recipes set course = 'side'
  where course is null
    and tags && array['side', 'sidedish'];

update public.recipes set course = 'breakfast'
  where course is null
    and tags && array['breakfast', 'brunch'];

update public.recipes set course = 'lunch'
  where course is null
    and tags && array['lunchideas'];

update public.recipes set course = 'snack'
  where course is null
    and tags && array['snack'];

update public.recipes set course = 'dinner'
  where course is null
    and tags && array['dinner'];

update public.recipes set course = 'drink'
  where course is null
    and tags && array['drink'];

----------------------------------------------------------------------
-- 3. Normalize tags: unnest, lowercase, map via CASE, drop unknowns,
-- reaggregate as a deduped array.
----------------------------------------------------------------------

with raw_tags as (
  select r.id, lower(trim(t)) as raw
  from public.recipes r, unnest(coalesce(r.tags, array[]::text[])) as t
),
mapped as (
  select id, case raw
    -- ── Diet ──────────────────────────────────────────────
    when 'vegan' then 'vegan'
    when 'vegan option' then 'vegan'
    when 'vegancurry' then 'vegan'
    when 'vegetarian' then 'vegetarian'
    when 'vegetarian option' then 'vegetarian'
    when 'gluten-free' then 'gluten-free'
    when 'gluten free' then 'gluten-free'
    when 'glutenfreerecipes' then 'gluten-free'
    when 'dairy-free' then 'dairy-free'
    when 'dairy free' then 'dairy-free'
    when 'lactose-free' then 'dairy-free'
    when 'keto' then 'keto'
    when 'low-carb' then 'low-carb'
    when 'low carb' then 'low-carb'
    when 'lowcarb' then 'low-carb'
    when 'paleo' then 'paleo'
    when 'whole30' then 'whole30'
    when 'kosher' then 'kosher'
    when 'nut-free' then 'nut-free'
    when 'nut free' then 'nut-free'
    when 'plant-based' then 'plant-based'
    when 'plantbaseddinner' then 'plant-based'
    when 'grain-free' then 'grain-free'
    when 'grain free' then 'grain-free'
    when 'high-protein' then 'high-protein'
    when 'high protein' then 'high-protein'
    when 'highprotein' then 'high-protein'
    when 'protein-packed' then 'high-protein'

    -- ── Workflow / occasion / technique ───────────────────
    when 'weeknight' then 'weeknight'
    when 'make-ahead' then 'make-ahead'
    when 'make ahead' then 'make-ahead'
    when 'quick' then 'quick'
    when 'easy' then 'easy'
    when 'one-pot' then 'one-pot'
    when 'one pot' then 'one-pot'
    when 'one-pan' then 'one-pan'
    when 'one pan' then 'one-pan'
    when 'no-bake' then 'no-bake'
    when 'no bake' then 'no-bake'
    when 'nobake' then 'no-bake'
    when 'no-cook' then 'no-cook'
    when 'no cook' then 'no-cook'
    when 'sheet-pan' then 'sheet-pan'
    when 'sheet pan' then 'sheet-pan'
    when 'slow-cooker' then 'slow-cooker'
    when 'slow cooker' then 'slow-cooker'
    when 'slow-cooking' then 'slow-cooker'
    when 'crockpot' then 'slow-cooker'
    when 'freezer-friendly' then 'freezer-friendly'
    when 'freezer friendly' then 'freezer-friendly'
    when 'freezable' then 'freezer-friendly'
    when 'freezing' then 'freezer-friendly'
    when 'meal-prep' then 'meal-prep'
    when 'meal prep' then 'meal-prep'
    when 'mealprep' then 'meal-prep'
    when 'five-ingredient' then 'five-ingredient'
    when 'five ingredient' then 'five-ingredient'
    when 'minimal ingredients' then 'five-ingredient'
    when 'grill' then 'grill'
    when 'grilling' then 'grill'
    when 'grilled' then 'grill'
    when 'barbecue' then 'grill'
    when 'baking' then 'baking'
    when 'baked' then 'baking'
    when 'dinner-party' then 'dinner-party'
    when 'dinner party' then 'dinner-party'
    when 'date-night' then 'date-night'
    when 'date night' then 'date-night'
    when 'datenight' then 'date-night'
    when 'kid-friendly' then 'kid-friendly'
    when 'kids' then 'kid-friendly'
    when 'party' then 'party'
    when 'partyfood' then 'party'
    when 'party food' then 'party'
    when 'picnic' then 'picnic'
    when 'comfort-food' then 'comfort-food'
    when 'comfort food' then 'comfort-food'
    when 'comfortfood' then 'comfort-food'
    when 'special-occasion' then 'special-occasion'
    when 'special occasion' then 'special-occasion'
    when 'spicy' then 'spicy'
    when 'seafood' then 'seafood'

    -- Anything else → drop
    else null
  end as canonical
  from raw_tags
),
new_tags as (
  select id, array_agg(distinct canonical) filter (where canonical is not null) as tags
  from mapped
  group by id
)
update public.recipes r
  set tags = coalesce(n.tags, array[]::text[])
  from new_tags n
  where r.id = n.id;

-- Empty tag arrays → null so the facet query stays clean.
update public.recipes
  set tags = null
  where tags is not null
    and (cardinality(tags) = 0);

commit;
