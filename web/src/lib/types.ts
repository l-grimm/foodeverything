// Types for the Food Everything recipes table. Hand-written to mirror the
// Supabase schema in supabase/schema.sql. Regenerate with `supabase gen
// types typescript` once we wire that up.

export type SourcePlatform = "tiktok" | "instagram" | "substack" | "url" | "manual";
export type ExtractionConfidence = "high" | "needs_review" | "manual";
export type ProcessingStatus = "pending_review" | "approved" | "flagged";
export type Course =
  | "breakfast" | "lunch" | "dinner" | "appetizer"
  | "side" | "dessert" | "snack" | "drink";
export type Season = "spring" | "summer" | "fall" | "winter";
export type IngredientCategory =
  | "produce" | "dairy" | "protein" | "grain" | "pantry_staple" | "other";

export type Recipe = {
  id: string;
  title: string;
  source_url: string | null;
  source_platform: SourcePlatform | null;
  author: string | null;
  yield: string | null;
  prep_time: string | null;
  cook_time: string | null;
  total_time: string | null;
  instructions: string[] | null;
  tags: string[] | null;
  cuisine: string | null;
  is_family_recipe: boolean | null;
  is_favorite: boolean | null;
  course: Course | null;
  holiday: string | null;
  season: Season | null;
  my_notes: string | null;
  my_rating: number | null;
  made_count: number | null;
  last_made_at: string | null;
  allergens_present: string[] | null;
  has_allergen: boolean | null;
  extraction_confidence: ExtractionConfidence | null;
  processing_status: ProcessingStatus | null;
  raw_text: string | null;
  image_urls: string[] | null;
  created_at: string | null;
  updated_at: string | null;
};

export type RecipeIngredient = {
  id: string;
  recipe_id: string | null;
  name: string;
  name_raw: string | null;
  amount: string | null;
  unit: string | null;
  prep_note: string | null;
  category: IngredientCategory | null;
};

// Recipe joined with the output of recipe_coverage() RPC. coverage is in [0, 1].
export type RecipeWithCoverage = Recipe & {
  matched_count: number;
  total_count: number;
  coverage: number;
  // Distinct canonical names of unmatched non-staple ingredients. The
  // home-page pill uses this to show the specific ingredient when there's
  // exactly one gap.
  missing_names: string[];
};

export type IngredientWithPantry = RecipeIngredient & {
  in_pantry: boolean;
  // True for salt/pepper/oil/water variants — these don't count toward
  // matched/total/missing and render without a have/missing marker.
  is_assumed_staple: boolean;
};
