import "server-only";
import { supabaseAdmin } from "./supabase";
import type {
  IngredientWithPantry,
  Recipe,
  RecipeWithCoverage,
} from "./types";

export type RecipeFilters = {
  q?: string;
  family?: boolean;
  favorite?: boolean;
  course?: string;
  season?: string;
  holiday?: string;
  cuisine?: string;
  platform?: string;
  needsReview?: boolean;
  page?: number;
  pageSize?: number;
};

export type RecipeListResult = {
  recipes: RecipeWithCoverage[];
  total: number;
  hasPantry: boolean;
};

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

export async function listRecipes(filters: RecipeFilters): Promise<RecipeListResult> {
  const pageSize = filters.pageSize ?? 24;
  const page = filters.page ?? 1;

  let query = supabaseAdmin
    .from("recipes")
    .select("*", { count: "exact" })
    // Higher than the current 808-row catalog to leave headroom; if this
    // ever caps at default 1000, sort would silently lose the tail.
    .limit(5000);

  if (filters.q) {
    // Title-only search. Ingredient search via RPC is a separate backlog item.
    query = query.ilike("title", `%${filters.q}%`);
  }
  if (filters.family) query = query.eq("is_family_recipe", true);
  if (filters.favorite) query = query.eq("is_favorite", true);
  if (filters.course) query = query.eq("course", filters.course);
  if (filters.season) query = query.eq("season", filters.season);
  if (filters.holiday) query = query.eq("holiday", filters.holiday);
  if (filters.cuisine) query = query.eq("cuisine", filters.cuisine);
  if (filters.platform) query = query.eq("source_platform", filters.platform);
  if (filters.needsReview) query = query.eq("extraction_confidence", "needs_review");

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

  const enriched: RecipeWithCoverage[] = ((recipesRes.data ?? []) as Recipe[]).map((r) => {
    const c = coverageMap.get(r.id);
    return {
      ...r,
      matched_count: c?.matched ?? 0,
      total_count: c?.total ?? 0,
      coverage: c?.coverage ?? 0,
    };
  });

  enriched.sort((a, b) => {
    if (hasPantry && b.coverage !== a.coverage) return b.coverage - a.coverage;
    const aDate = a.created_at ? Date.parse(a.created_at) : 0;
    const bDate = b.created_at ? Date.parse(b.created_at) : 0;
    return bDate - aDate;
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
      // Staples are neither "have" nor "missing" — they're outside the count.
      // We mark in_pantry=true defensively so any caller that ignores the
      // staple flag still treats them as not-missing.
      in_pantry: isStaple || pantrySet.has(norm),
    };
  });

  return {
    recipe: recipeRes.data as Recipe | null,
    ingredients: enrichedIngredients,
    hasPantry: pantryItems.length > 0,
  };
}

// Distinct values for filter chips — pulled once on page load so the
// filter UI knows what's actually in the DB.
export async function getFilterFacets(): Promise<{
  courses: string[];
  seasons: string[];
  holidays: string[];
  cuisines: string[];
  platforms: string[];
}> {
  const { data } = await supabaseAdmin
    .from("recipes")
    .select("course,season,holiday,cuisine,source_platform");
  const courses = new Set<string>();
  const seasons = new Set<string>();
  const holidays = new Set<string>();
  const cuisines = new Set<string>();
  const platforms = new Set<string>();
  for (const r of data ?? []) {
    if (r.course) courses.add(r.course);
    if (r.season) seasons.add(r.season);
    if (r.holiday) holidays.add(r.holiday);
    if (r.cuisine) cuisines.add(r.cuisine);
    if (r.source_platform) platforms.add(r.source_platform);
  }
  return {
    courses: [...courses].sort(),
    seasons: [...seasons].sort(),
    holidays: [...holidays].sort(),
    cuisines: [...cuisines].sort(),
    platforms: [...platforms].sort(),
  };
}
