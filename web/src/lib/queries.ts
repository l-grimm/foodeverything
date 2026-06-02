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
// (migration 0006). Items here are treated as always-present even with an
// empty pantry, so recipes don't show salt/oil as "missing".
const ALWAYS_PRESENT_INGREDIENTS = new Set([
  "salt",
  "pepper",
  "black pepper",
  "oil",
  "olive oil",
  "water",
]);

function normalizeIngredientName(name: string): string {
  return name.trim().toLowerCase();
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
  const haveSet = new Set<string>([
    ...ALWAYS_PRESENT_INGREDIENTS,
    ...pantryItems.map((i) => normalizeIngredientName(i.name)),
  ]);

  const enrichedIngredients: IngredientWithPantry[] = (
    (ingredientsRes.data ?? []) as IngredientWithPantry[]
  ).map((ing) => ({
    ...ing,
    in_pantry: haveSet.has(normalizeIngredientName(ing.name)),
  }));

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
