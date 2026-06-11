"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BackToRecipes } from "../../_back-link";
import { Button } from "@/components/ui/button";
import type { Recipe, RecipeIngredient } from "@/lib/types";
import { RecipeEditForm } from "./_edit-form";
import { FavoriteButton } from "./_favorite-button";

// Thin client wrapper that decides whether to show the server-rendered
// read view (passed as `children`) or the client-side edit form. Keeps
// the read view server-rendered (no client-side JS for the markup) and
// only ships the edit form when the user enters edit mode.
//
// Cancel returns to read mode without saving. Save commits via the
// server action and then router.refresh() so the children's server
// component re-fetches the fresh recipe before we flip back.
export function RecipeViewToggle({
  recipe,
  ingredients,
  children,
}: {
  recipe: Recipe;
  ingredients: RecipeIngredient[];
  children: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const router = useRouter();

  if (editing) {
    return (
      <RecipeEditForm
        recipe={recipe}
        ingredients={ingredients}
        onCancel={() => setEditing(false)}
        onSaved={() => {
          router.refresh();
          setEditing(false);
        }}
      />
    );
  }

  return (
    <>
      <div className="flex items-center justify-between -mb-4">
        <BackToRecipes />
        <div className="flex items-center gap-2">
          <FavoriteButton
            recipeId={recipe.id}
            initial={recipe.is_favorite === true}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setEditing(true)}
            className="font-mono uppercase tracking-wider text-[0.7rem]"
          >
            Edit
          </Button>
        </div>
      </div>
      {children}
    </>
  );
}
