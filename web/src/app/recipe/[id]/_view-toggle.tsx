"use client";

import {
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
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
// Edit mode lives in the URL (`?edit=1`) rather than local state so the
// global header (HeaderAddButton) can react to it — when the user is
// editing, the "+ Add" button in the layout hides itself. Side benefit:
// reload-stays-in-edit-mode if the user accidentally reloads.
//
// Cancel removes the `?edit` param. Save calls the server action,
// router.refresh()es so the read view picks up the new data, then
// drops the param.
export function RecipeViewToggle({
  recipe,
  ingredients,
  children,
}: {
  recipe: Recipe;
  ingredients: RecipeIngredient[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const editing = searchParams.get("edit") === "1";

  function enterEdit() {
    const next = new URLSearchParams(searchParams.toString());
    next.set("edit", "1");
    router.push(`${pathname}?${next.toString()}`);
  }

  function exitEdit() {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("edit");
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  if (editing) {
    return (
      <RecipeEditForm
        recipe={recipe}
        ingredients={ingredients}
        onCancel={exitEdit}
        onSaved={() => {
          router.refresh();
          exitEdit();
        }}
      />
    );
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-6">
        <BackToRecipes />
        <div className="flex items-center gap-2 shrink-0">
          <FavoriteButton
            recipeId={recipe.id}
            initial={recipe.is_favorite === true}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={enterEdit}
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
