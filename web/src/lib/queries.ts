import "server-only";
import { supabaseAdmin } from "./supabase";
import {
  MAIN_COURSES,
  TREAT_COURSES,
  currentSeasonWindow,
} from "./pill-catalogs";
import type {
  IngredientWithPantry,
  Recipe,
  RecipeWithCoverage,
} from "./types";

// All filter fields are arrays so the UI can do multi-select (spring AND
// summer for shoulder months, e.g.). q stays a scalar — search is one box.
export type RecipeFilters = {
  q?: string;
  family?: boolean;
  favorite?: boolean;
  course?: string[];
  season?: string[];
  holiday?: string[];
  cuisine?: string[];
  platform?: string[];
  tags?: string[];
  // Author filter accepts real author names plus two special tokens:
  //   "Family"    — matches is_family_recipe = true
  //   "No author" — matches author is null and not flagged family
  author?: string[];
  needsReview?: boolean;
  page?: number;
  pageSize?: number;
};

const AUTHOR_FAMILY = "Family";
const AUTHOR_NONE = "No author";

export type RecipeListResult = {
  recipes: RecipeWithCoverage[];
  total: number;
  hasPantry: boolean;
};

export type SectionKey = "cookNow" | "recent" | "treats";
export type SectionTab = "seasonal" | "coverage";

// Recently-added cutoff for the home-page section.
const RECENT_DAYS = 14;

// Mirror of the assumed-staple list in the recipe_coverage() SQL function
// (migrations 0006 + 0007). Items here are EXCLUDED from coverage counts
// entirely — not counted as matched, not counted in the total, not shown
// as missing. They render as plain rows so the recipe is still readable.
const ASSUMED_STAPLES = new Set([
  "salt",
  "pepper",
  "black pepper",
  "oil",
  "olive oil",
  "water",
  "salt and pepper",
  // sparkling water aliases to water (below) and water is already in the
  // staples set, but recording the canonical here is a safety net so any
  // future caller of the JS normalizer treats it as ever-present.
]);

// Mirror of public.normalize_ingredient() (migration 0011). Keep both
// implementations in sync — recipe_coverage() uses the SQL version for
// the home page sort, getRecipe() below uses this TS version for the
// detail page's per-ingredient have/missing marker.
const SIZE_PREFIX = /^(extra\s+large|extra\s+small|jumbo|large|medium|small|mini)\s+/;
const ALIASES: Record<string, string> = {
  "all purpose flour": "flour",
  "ap flour": "flour",
  "granulated sugar": "sugar",
  "white sugar": "sugar",
  "cane sugar": "sugar",
  "kosher salt": "salt",
  "sea salt": "salt",
  "table salt": "salt",
  "fine sea salt": "salt",
  "flaky salt": "salt",
  "coarse salt": "salt",
  "diamond crystal kosher salt": "salt",
  "diamond crystal salt": "salt",
  "morton kosher salt": "salt",
  "freshly ground black pepper": "pepper",
  "ground black pepper": "pepper",
  "ground pepper": "pepper",
  "black pepper": "pepper",
  "salt and ground pepper": "salt and pepper",
  "s&p": "salt and pepper",
  "s & p": "salt and pepper",
  "salt and freshly ground pepper": "salt and pepper",
  "salt and freshly ground black pepper": "salt and pepper",
  "salt and black pepper": "salt and pepper",
  "salt and ground black pepper": "salt and pepper",
  "miso paste": "miso",
  "white miso": "miso",
  "red miso": "miso",
  "yellow miso": "miso",
  "brown miso": "miso",
  "shiro miso": "miso",
  "aka miso": "miso",
  "toasted sesame oil": "sesame oil",
  "roasted sesame oil": "sesame oil",
  "dark sesame oil": "sesame oil",
  "extra virgin olive oil": "olive oil",
  "virgin olive oil": "olive oil",
  "evoo": "olive oil",
  "garlic clove": "garlic",
  "clove of garlic": "garlic",
  "garlic head": "garlic",
  "head of garlic": "garlic",
  "fresh garlic": "garlic",
  "lemon wedge": "lemon",
  "lemon zest": "lemon",
  "lemon juice": "lemon",
  "lemon peel": "lemon",
  "lemon slice": "lemon",
  "juice of lemon": "lemon",
  "lime wedge": "lime",
  "lime zest": "lime",
  "lime juice": "lime",
  "lime peel": "lime",
  "lime slice": "lime",
  "juice of lime": "lime",
  "chile flake": "red pepper flake",
  "chili flake": "red pepper flake",
  "chilli flake": "red pepper flake",
  "red chile flake": "red pepper flake",
  "red chili flake": "red pepper flake",
  "red chilli flake": "red pepper flake",
  "crushed red pepper": "red pepper flake",
  "crushed red pepper flake": "red pepper flake",
  "piment d'espelette": "red pepper flake",
  "espelette pepper": "red pepper flake",
  "parmesan": "parmesan cheese",
  "parm": "parmesan cheese",
  "parmigiano": "parmesan cheese",
  "parmigiano reggiano": "parmesan cheese",
  "parmesan reggiano": "parmesan cheese",
  "parmigiano cheese": "parmesan cheese",
  "parmigiano reggiano cheese": "parmesan cheese",
  "grated parmesan": "parmesan cheese",
  "grated parmigiano": "parmesan cheese",
  "pecorino or parmesan": "parmesan cheese",
  "parmesan or pecorino": "parmesan cheese",
  "buffalo sauce": "hot sauce",
  "hot pepper sauce": "hot sauce",
  "vegetable oil": "canola oil",
  "grapeseed oil": "canola oil",
  "neutral oil": "canola oil",
  "vegetable or grapeseed oil": "canola oil",
  "grapeseed or vegetable oil": "canola oil",
  "apple cider vinegar": "champagne vinegar",
  "parsley leave": "parsley",
  "parsley leaves and tender stem": "parsley",
  "fresh parsley": "parsley",
  "thyme leave": "thyme",
  "fresh thyme": "thyme",
  "linguine": "spaghetti",
  "cumin seed": "cumin",
  "ground cumin": "cumin",
  "whole cumin": "cumin",
  "coriander seed": "coriander",
  "ground coriander": "coriander",
  "whole coriander": "coriander",
  "sichuan peppercorn": "szechuan peppercorn",
  "chicken bouillon": "chicken stock",
  "vegetable stock": "chicken stock",
  "sparkling water": "water",
  "bread crumb": "breadcrumb",
  "english cucumber": "cucumber",
  "whole milk": "milk",
  "skim milk": "milk",
  "beef chuck roast": "beef chuck",
  "beef roast": "beef chuck",
  "chuck roast": "beef chuck",
  "anchovy paste": "anchovy",
  "unsalted butter": "butter",
  "salted butter": "butter",
  "pancetta": "speck",
};

function normalizeIngredientName(raw: string): string {
  if (!raw) return "";
  let s = raw.trim().toLowerCase();
  // Hyphen → space, collapse whitespace. Then size strip. Then plural →
  // singular. Then alias lookup. Order matters — plural before alias
  // means each alias only needs to list the singular form.
  s = s.replace(/-/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(SIZE_PREFIX, "");
  if (s.length > 4 && s.endsWith("ies")) {
    s = s.slice(0, -3) + "y";
  } else if (s.length > 3 && s.endsWith("es")) {
    const before = s[s.length - 3];
    if (before === "s" || before === "h" || before === "x" || before === "z" || before === "o") {
      s = s.slice(0, -2);
    } else if (!s.endsWith("ss")) {
      s = s.slice(0, -1);
    }
  } else if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) {
    s = s.slice(0, -1);
  }
  if (ALIASES[s]) return ALIASES[s];
  return s;
}

type CoverageRow = {
  recipe_id: string;
  matched_count: number;
  total_count: number;
  coverage: number | string;
};

// supabase-js builder type is intentionally loose; the chain returns the
// same shape so typing it as a generic any-ish helper is fine here.
type RecipeQuery = ReturnType<typeof supabaseAdmin.from<"recipes", never>>["select"] extends (
  ...args: never[]
) => infer R
  ? R
  : never;

function applyFilters(query: RecipeQuery, filters: RecipeFilters): RecipeQuery {
  let q = query;
  // filters.q is intentionally NOT handled here — search matches title OR
  // ingredient name, so the q filter is pre-resolved to an id set in
  // listRecipesForSection and applied separately via .in("id", ids).
  if (filters.family) q = q.eq("is_family_recipe", true);
  if (filters.favorite) q = q.eq("is_favorite", true);
  if (filters.course?.length) q = q.in("course", filters.course);
  if (filters.season?.length) q = q.in("season", filters.season);
  if (filters.holiday?.length) q = q.in("holiday", filters.holiday);
  if (filters.cuisine?.length) q = q.in("cuisine", filters.cuisine);
  if (filters.platform?.length) q = q.in("source_platform", filters.platform);
  if (filters.tags?.length) q = q.overlaps("tags", filters.tags);
  if (filters.needsReview) q = q.eq("extraction_confidence", "needs_review");
  return q;
}

// UUID that can never appear in recipes.id. Used to force an empty result
// set when the search query matched zero recipes via either title or
// ingredient — cleaner than threading an early-return through the rest of
// listRecipesForSection.
const IMPOSSIBLE_RECIPE_ID = "00000000-0000-0000-0000-000000000000";

async function fetchRecipeIdsByQuery(q: string): Promise<string[]> {
  const needle = `%${q}%`;
  const [titleRes, ingRes] = await Promise.all([
    supabaseAdmin.from("recipes").select("id").ilike("title", needle).limit(5000),
    supabaseAdmin
      .from("recipe_ingredients")
      .select("recipe_id")
      .ilike("name", needle)
      .limit(20000),
  ]);
  const ids = new Set<string>();
  for (const r of (titleRes.data ?? []) as { id: string }[]) ids.add(r.id);
  for (const r of (ingRes.data ?? []) as { recipe_id: string | null }[]) {
    if (r.recipe_id) ids.add(r.recipe_id);
  }
  return [...ids];
}

export async function listRecipesForSection(
  section: SectionKey,
  tab: SectionTab,
  filters: RecipeFilters,
): Promise<RecipeListResult> {
  const pageSize = filters.pageSize ?? 24;
  const page = filters.page ?? 1;

  // Search matches title OR any ingredient name. Pre-resolve to an id set
  // so the rest of the filter chain stays a single supabase query.
  let matchingIds: string[] | undefined;
  if (filters.q) {
    const ids = await fetchRecipeIdsByQuery(filters.q);
    matchingIds = ids.length > 0 ? ids : [IMPOSSIBLE_RECIPE_ID];
  }

  let query = supabaseAdmin
    .from("recipes")
    .select("*", { count: "exact" })
    .limit(5000) as unknown as RecipeQuery;
  query = applyFilters(query, filters);
  if (matchingIds) query = query.in("id", matchingIds);

  if (section === "cookNow") {
    // Only override course with the main-courses set when the user hasn't
    // explicitly chosen courses. If they did, respect their choice.
    if (!filters.course?.length) query = query.in("course", MAIN_COURSES);
  } else if (section === "recent") {
    const since = new Date();
    since.setDate(since.getDate() - RECENT_DAYS);
    query = query.gte("created_at", since.toISOString());
  } else if (section === "treats") {
    if (!filters.course?.length) query = query.in("course", TREAT_COURSES);
  }

  // Seasonal tab on cookNow/treats: hard-filter to recipes whose season is
  // in the current season window (which already includes overlapping
  // shoulder months — "almost in season"). User-explicit season filter
  // wins if set. Recent is chronological-only; tab is ignored there.
  if (
    (section === "cookNow" || section === "treats") &&
    tab === "seasonal" &&
    !filters.season?.length
  ) {
    query = query.in("season", currentSeasonWindow() as unknown as string[]);
  }

  const [recipesRes, coverageRes, pantryCountRes] = await Promise.all([
    query,
    supabaseAdmin.rpc("recipe_coverage"),
    supabaseAdmin
      .from("pantry_items")
      .select("*", { count: "exact", head: true })
      .is("finished_at", null),
  ]);

  if (recipesRes.error) throw recipesRes.error;

  const hasPantry = (pantryCountRes.count ?? 0) > 0;

  const coverageMap = new Map<string, { matched: number; total: number; coverage: number }>();
  for (const row of (coverageRes.data as CoverageRow[] | null) ?? []) {
    coverageMap.set(row.recipe_id, {
      matched: row.matched_count,
      total: row.total_count,
      coverage: Number(row.coverage),
    });
  }

  let enriched: RecipeWithCoverage[] = ((recipesRes.data ?? []) as Recipe[]).map((r) => {
    const c = coverageMap.get(r.id);
    return {
      ...r,
      matched_count: c?.matched ?? 0,
      total_count: c?.total ?? 0,
      coverage: c?.coverage ?? 0,
    };
  });

  // Author filter applied in JS because the "Family" and "No author" tokens
  // don't map cleanly to a single SQL column (Family = is_family_recipe,
  // None = author IS NULL). With our 5000-row ceiling this is fast.
  if (filters.author?.length) {
    const wants = filters.author;
    enriched = enriched.filter((r) =>
      wants.some((a) => {
        if (a === AUTHOR_FAMILY) return r.is_family_recipe === true;
        if (a === AUTHOR_NONE) return !r.author && !r.is_family_recipe;
        return r.author === a;
      }),
    );
  }

  // Primary sort: missing ingredients ascending — recipes you're closest
  // to being able to make come first. Coverage-percent-desc was the old
  // primary key, but with mixed recipe sizes a 20/28 (71%, missing 8)
  // outranked an 8/12 (67%, missing 4), which is backwards for the user's
  // mental model. Coverage desc stays as a tiebreak when missing counts
  // are equal. created_at desc is the final tiebreak. Recent section just
  // sorts by date.
  const dateScore = (r: RecipeWithCoverage): number =>
    r.created_at ? Date.parse(r.created_at) : 0;
  enriched.sort((a, b) => {
    if (section !== "recent" && hasPantry) {
      const aMissing = a.total_count - a.matched_count;
      const bMissing = b.total_count - b.matched_count;
      if (aMissing !== bMissing) return aMissing - bMissing;
      if (a.coverage !== b.coverage) return b.coverage - a.coverage;
    }
    return dateScore(b) - dateScore(a);
  });

  const from = (page - 1) * pageSize;
  const paginated = enriched.slice(from, from + pageSize);

  return { recipes: paginated, total: recipesRes.count ?? 0, hasPantry };
}

export type RecentPantryItem = {
  id: string;
  name: string;
  added_at: string | null;
};

export async function listRecentPantryItems(
  limit = 500,
): Promise<RecentPantryItem[]> {
  const { data } = await supabaseAdmin
    .from("pantry_items")
    .select("id, name, added_at")
    .is("finished_at", null)
    .order("added_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as RecentPantryItem[];
}

export async function getRecipe(id: string): Promise<{
  recipe: Recipe | null;
  ingredients: IngredientWithPantry[];
  hasPantry: boolean;
}> {
  const [recipeRes, ingredientsRes, pantryRes] = await Promise.all([
    supabaseAdmin.from("recipes").select("*").eq("id", id).maybeSingle(),
    supabaseAdmin
      .from("recipe_ingredients")
      .select("*")
      .eq("recipe_id", id)
      .order("category", { ascending: true }),
    supabaseAdmin.from("pantry_items").select("name").is("finished_at", null),
  ]);

  const pantryItems = (pantryRes.data ?? []) as { name: string }[];
  const pantrySet = new Set<string>(
    pantryItems.map((i) => normalizeIngredientName(i.name)),
  );

  const enrichedIngredients: IngredientWithPantry[] = (
    (ingredientsRes.data ?? []) as IngredientWithPantry[]
  ).map((ing) => {
    const norm = normalizeIngredientName(ing.name);
    const isStaple = ASSUMED_STAPLES.has(norm);
    return {
      ...ing,
      is_assumed_staple: isStaple,
      in_pantry: isStaple || pantrySet.has(norm),
    };
  });

  return {
    recipe: recipeRes.data as Recipe | null,
    ingredients: enrichedIngredients,
    hasPantry: pantryItems.length > 0,
  };
}

// Distinct values for filter sheets. Run once per home-page load.
export async function getFilterFacets(): Promise<{
  courses: string[];
  seasons: string[];
  holidays: string[];
  cuisines: string[];
  platforms: string[];
  tags: string[];
  authors: string[];
}> {
  const { data } = await supabaseAdmin
    .from("recipes")
    .select("course,season,holiday,cuisine,source_platform,tags,author,is_family_recipe")
    .limit(5000);
  const courses = new Set<string>();
  const seasons = new Set<string>();
  const holidays = new Set<string>();
  const cuisines = new Set<string>();
  const platforms = new Set<string>();
  const tags = new Set<string>();
  const authors = new Set<string>();
  let hasFamily = false;
  let hasNone = false;
  for (const r of (data ?? []) as {
    course: string | null;
    season: string | null;
    holiday: string | null;
    cuisine: string | null;
    source_platform: string | null;
    tags: string[] | null;
    author: string | null;
    is_family_recipe: boolean | null;
  }[]) {
    if (r.course) courses.add(r.course);
    if (r.season) seasons.add(r.season);
    if (r.holiday) holidays.add(r.holiday);
    if (r.cuisine) cuisines.add(r.cuisine);
    if (r.source_platform) platforms.add(r.source_platform);
    if (r.tags) for (const t of r.tags) if (t) tags.add(t);
    if (r.author) authors.add(r.author);
    if (r.is_family_recipe) hasFamily = true;
    if (!r.author && !r.is_family_recipe) hasNone = true;
  }
  // Family pinned to top of the author list, No-author pinned to the bottom,
  // real authors alphabetized between them.
  const authorList: string[] = [];
  if (hasFamily) authorList.push(AUTHOR_FAMILY);
  authorList.push(...[...authors].sort());
  if (hasNone) authorList.push(AUTHOR_NONE);
  return {
    courses: [...courses].sort(),
    seasons: [...seasons].sort(),
    holidays: [...holidays].sort(),
    cuisines: [...cuisines].sort(),
    platforms: [...platforms].sort(),
    tags: [...tags].sort(),
    authors: authorList,
  };
}
