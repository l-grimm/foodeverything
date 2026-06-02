import "server-only";
import { supabaseAdmin } from "./supabase";
import type { Recipe, RecipeIngredient } from "./types";

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
  recipes: Recipe[];
  total: number;
};

export async function listRecipes(filters: RecipeFilters): Promise<RecipeListResult> {
  const pageSize = filters.pageSize ?? 24;
  const page = filters.page ?? 1;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabaseAdmin
    .from("recipes")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (filters.q) {
    // Title-only search. We'll add ingredient search via RPC in a follow-up.
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

  const { data, count, error } = await query;
  if (error) throw error;
  return { recipes: (data ?? []) as Recipe[], total: count ?? 0 };
}

export async function getRecipe(id: string): Promise<{
  recipe: Recipe | null;
  ingredients: RecipeIngredient[];
}> {
  const [{ data: recipe }, { data: ingredients }] = await Promise.all([
    supabaseAdmin.from("recipes").select("*").eq("id", id).maybeSingle(),
    supabaseAdmin
      .from("recipe_ingredients")
      .select("*")
      .eq("recipe_id", id)
      .order("category", { ascending: true }),
  ]);
  return {
    recipe: recipe as Recipe | null,
    ingredients: (ingredients ?? []) as RecipeIngredient[],
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
