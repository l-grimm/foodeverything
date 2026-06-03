import { RecipeCard } from "../_recipe-card";
import type { RecipeWithCoverage } from "@/lib/types";

// "Recently added" is horizontally scrollable on mobile, grid on desktop —
// matches the "feed of new stuff" feel without taking 3 stacked rows of
// vertical space when 8+ items are recent.
export function RecentStrip({
  recipes,
  showCoverage,
}: {
  recipes: RecipeWithCoverage[];
  showCoverage: boolean;
}) {
  if (recipes.length === 0) return null;
  return (
    <div className="flex gap-4 overflow-x-auto pb-2 sm:grid sm:grid-cols-2 lg:grid-cols-3 sm:overflow-visible">
      {recipes.map((r) => (
        <div key={r.id} className="w-[18rem] shrink-0 sm:w-auto">
          <RecipeCard recipe={r} showCoverage={showCoverage} />
        </div>
      ))}
    </div>
  );
}
