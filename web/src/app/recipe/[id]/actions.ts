"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import type { IngredientCategory } from "@/lib/types";

const CATEGORIES: IngredientCategory[] = [
  "produce",
  "dairy",
  "protein",
  "grain",
  "pantry_staple",
  "other",
];

// Shape the client sends back on save. Existing rows carry their DB id;
// newly-added rows have id === null so the server knows to INSERT them.
export type IngredientEditDraft = {
  id: string | null;
  name: string;
  amount: string | null;
  unit: string | null;
  prep_note: string | null;
  category: IngredientCategory | null;
};

export type UpdateRecipePayload = {
  title: string;
  tags: string[];
  instructions: string[];
  ingredients: IngredientEditDraft[];
};

function normalizeCategory(c: IngredientCategory | null): IngredientCategory | null {
  if (c == null) return null;
  return CATEGORIES.includes(c) ? c : null;
}

function tidyString(s: string | null | undefined): string | null {
  if (s == null) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export async function updateRecipe(id: string, payload: UpdateRecipePayload) {
  const title = payload.title.trim();
  if (title.length === 0) {
    throw new Error("Title can't be empty");
  }

  // Drop empty instruction lines so a stray blank textarea doesn't get
  // saved as " " or "" — keeps the served `instructions` clean.
  const instructions = payload.instructions
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Tags: trim + dedupe, drop empties. We don't enforce the curated
  // allowlist on save — users can type custom tags if they want.
  const tags = Array.from(
    new Set(
      payload.tags
        .map((t) => t.trim())
        .filter((t) => t.length > 0),
    ),
  );

  // Drop ingredient rows with no name — they're empty placeholders the
  // user added then never filled in.
  const ingredients = payload.ingredients
    .map((ing) => ({
      id: ing.id,
      name: ing.name.trim(),
      amount: tidyString(ing.amount),
      unit: tidyString(ing.unit),
      prep_note: tidyString(ing.prep_note),
      category: normalizeCategory(ing.category),
    }))
    .filter((ing) => ing.name.length > 0);

  // 1. Update the recipe row itself.
  const { error: recipeErr } = await supabaseAdmin
    .from("recipes")
    .update({
      title,
      tags: tags.length > 0 ? tags : null,
      instructions: instructions.length > 0 ? instructions : null,
    })
    .eq("id", id);
  if (recipeErr) throw recipeErr;

  // 2. Reconcile recipe_ingredients. Diff strategy: pull current ids,
  //    compare against payload, then DELETE missing / UPDATE existing /
  //    INSERT new. Cleaner than a wipe-and-reinsert because it preserves
  //    row ids (so canonical-cache lookups keyed on raw_name keep
  //    working) and only touches rows that actually changed.
  const { data: existingRows, error: fetchErr } = await supabaseAdmin
    .from("recipe_ingredients")
    .select("id")
    .eq("recipe_id", id);
  if (fetchErr) throw fetchErr;

  const existingIds = new Set(
    ((existingRows ?? []) as { id: string }[]).map((r) => r.id),
  );
  const incomingIds = new Set(
    ingredients.filter((i) => i.id != null).map((i) => i.id as string),
  );

  // DELETE: rows that exist in DB but aren't in the payload anymore.
  const toDelete = [...existingIds].filter((rid) => !incomingIds.has(rid));
  if (toDelete.length > 0) {
    const { error: delErr } = await supabaseAdmin
      .from("recipe_ingredients")
      .delete()
      .in("id", toDelete);
    if (delErr) throw delErr;
  }

  // UPDATE: rows present in both. Push the latest field values.
  // INSERT: rows in payload without an id.
  const toInsert: Array<{
    recipe_id: string;
    name: string;
    name_raw: string | null;
    amount: string | null;
    unit: string | null;
    prep_note: string | null;
    category: IngredientCategory | null;
  }> = [];
  const toUpdate: IngredientEditDraft[] = [];

  for (const ing of ingredients) {
    if (ing.id != null && existingIds.has(ing.id)) {
      toUpdate.push(ing);
    } else {
      toInsert.push({
        recipe_id: id,
        name: ing.name,
        name_raw: ing.name, // raw = user-typed value; canonical resolves elsewhere
        amount: ing.amount,
        unit: ing.unit,
        prep_note: ing.prep_note,
        category: ing.category,
      });
    }
  }

  await Promise.all(
    toUpdate.map(async (ing) => {
      const { error: upErr } = await supabaseAdmin
        .from("recipe_ingredients")
        .update({
          name: ing.name,
          amount: ing.amount,
          unit: ing.unit,
          prep_note: ing.prep_note,
          category: ing.category,
        })
        .eq("id", ing.id as string);
      if (upErr) throw upErr;
    }),
  );

  if (toInsert.length > 0) {
    const { error: insErr } = await supabaseAdmin
      .from("recipe_ingredients")
      .insert(toInsert);
    if (insErr) throw insErr;
  }

  // 3. Bump updated_at via a no-op set so the column tracks edits even
  //    if Postgres doesn't auto-update on the change above. The trigger
  //    in 0001_init takes care of it, but this is a safety belt.
  await supabaseAdmin
    .from("recipes")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", id);

  // 4. Revalidate both the detail and home routes so coverage counts,
  //    facets, and the rendered detail page all reflect the edit.
  revalidatePath(`/recipe/${id}`);
  revalidatePath("/");

  return { ok: true as const };
}
