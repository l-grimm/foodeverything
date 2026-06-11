"use client";

import { useState, useTransition } from "react";
import { Star } from "lucide-react";
import { setFavorite } from "./actions";

// Small star toggle for the detail-page action bar. Optimistic — flips
// local state immediately, then calls the server action. If the action
// throws, we revert. The icon is foreground (Cast Iron Black) when
// favorited, muted outline when not — matches the small filled star
// rendered on home-page recipe cards so the two surfaces feel related.
export function FavoriteButton({
  recipeId,
  initial,
}: {
  recipeId: string;
  initial: boolean;
}) {
  const [isFav, setIsFav] = useState(initial);
  const [, startTransition] = useTransition();

  function toggle() {
    const next = !isFav;
    setIsFav(next); // optimistic
    startTransition(async () => {
      try {
        await setFavorite(recipeId, next);
      } catch {
        setIsFav(!next); // revert on failure
      }
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={isFav}
      aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
      className={`rounded-md border px-2 py-1 transition ${
        isFav
          ? "border-border text-foreground hover:bg-card"
          : "border-border text-muted-foreground hover:text-foreground hover:bg-card"
      }`}
    >
      <Star
        className="w-4 h-4"
        // lucide draws stroke by default; "fill" attribute fills the body
        // with the current text color when favorited.
        fill={isFav ? "currentColor" : "none"}
        strokeWidth={1.75}
      />
    </button>
  );
}
