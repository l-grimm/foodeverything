"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RecipeCard } from "../_recipe-card";
import type { RecipeWithCoverage } from "@/lib/types";

const INITIAL = 9;
const PAGE = 9;

export function SectionList({
  recipes,
  showCoverage,
}: {
  recipes: RecipeWithCoverage[];
  showCoverage: boolean;
}) {
  const [visible, setVisible] = useState(INITIAL);
  const shown = recipes.slice(0, visible);
  const remaining = recipes.length - shown.length;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {shown.map((r) => (
          <RecipeCard key={r.id} recipe={r} showCoverage={showCoverage} />
        ))}
      </div>
      {(remaining > 0 || visible > INITIAL) && (
        <div className="flex justify-between pt-1 text-sm">
          {remaining > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setVisible((v) => v + PAGE)}
            >
              Show {Math.min(PAGE, remaining)} more
            </Button>
          ) : (
            <span />
          )}
          {visible > INITIAL && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setVisible(INITIAL)}
            >
              Collapse
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
