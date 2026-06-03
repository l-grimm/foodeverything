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
]);

// Mirror of public.normalize_ingredient() (migration 0008). Keep both
// implementations in sync — recipe_coverage() uses the SQL version for
// the home page sort, getRecipe() below uses this TS version for the
// detail page's per-ingredient have/missing marker.
const SIZE_PREFIX = /^(extra[-\s]large|extra[-\s]small|jumbo|large|medium|small|mini)\s+/;
const ALIASES: Record<string, string> = {
  "all-purpose flour": "flour",
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
  "freshly ground black pepper": "black pepper",
  "ground black pepper": "black pepper",
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
};

function normalizeIngredientName(raw: string): string {
  if (!raw) return "";
  let s = raw.trim().toLowerCase();
  s = s.replace(SIZE_PREFIX, "");
  if (ALIASES[s]) return ALIASES[s];
  if (s.length > 4 && s.endsWith("ies")) return s.slice(0, -3) + "y";
  if (s.length > 3 && s.endsWith("es")) {
    const before = s[s.length - 3];
    if (before === "s" || before === "h" || before === "x" || before === "z" || before === "o") {
      return s.slice(0, -2);
    }
  }
  if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) return s.slice(0, -1);
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
  if (filters.q) q = q.ilike("title", `%${filters.q}%`);
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

export async function listRecipesForSection(
  section: SectionKey,
  filters: RecipeFilters,
): Promise<RecipeListResult> {
  const pageSize = filters.pageSize ?? 24;
  const page = filters.page ?? 1;

  let query = supabaseAdmin
    .from("recipes")
    .select("*", { count: "exact" })
    .limit(5000) as unknown as RecipeQuery;
  query = applyFilters(query, filters);

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
  const seasonWindow = new Set(currentSeasonWindow());

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

  // Section-specific sort.
  if (section === "cookNow") {
    // Only boost in-season recipes when the user hasn't manually filtered by
    // season — if they explicitly chose winter, ranking by season match is
    // a tautology (every match is in their chosen set).
    const useSeasonBoost = !filters.season?.length;
    enriched.sort((a, b) => {
      if (useSeasonBoost) {
        const aIn = a.season && seasonWindow.has(a.season) ? 1 : 0;
        const bIn = b.season && seasonWindow.has(b.season) ? 1 : 0;
        if (bIn !== aIn) return bIn - aIn;
      }
      if (hasPantry && b.coverage !== a.coverage) return b.coverage - a.coverage;
      const aDate = a.created_at ? Date.parse(a.created_at) : 0;
      const bDate = b.created_at ? Date.parse(b.created_at) : 0;
      return bDate - aDate;
    });
  } else if (section === "recent") {
    enriched.sort((a, b) => {
      const aDate = a.created_at ? Date.parse(a.created_at) : 0;
      const bDate = b.created_at ? Date.parse(b.created_at) : 0;
      return bDate - aDate;
    });
  } else {
    enriched.sort((a, b) => {
      if (hasPantry && b.coverage !== a.coverage) return b.coverage - a.coverage;
      const aDate = a.created_at ? Date.parse(a.created_at) : 0;
      const bDate = b.created_at ? Date.parse(b.created_at) : 0;
      return bDate - aDate;
    });
  }

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
