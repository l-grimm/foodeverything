"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { EditablePantryChip } from "./chip";
import type { RecentPantryItem } from "@/lib/queries";

const PERISHABLE_CATEGORIES = new Set(["produce", "dairy", "protein"]);
const STAPLES_PAGE = 10;

function isPerishable(item: RecentPantryItem): boolean {
  return item.category != null && PERISHABLE_CATEGORIES.has(item.category);
}

export function PantryStripClient({ items }: { items: RecentPantryItem[] }) {
  const [expanded, setExpanded] = useState(false);
  const [staplesVisible, setStaplesVisible] = useState(STAPLES_PAGE);

  // Perishables: already sorted most-recent-first from the query.
  // Staples: alphabetical.
  const perishables = items.filter(isPerishable);
  const staples = items
    .filter((i) => !isPerishable(i))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!expanded) {
    return (
      <section className="rounded-md border border-border bg-card px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <span className="label-mono">
            ▸ Pantry · {perishables.length} fresh · {staples.length} staples
          </span>
          <span className="label-mono">edit</span>
        </button>
      </section>
    );
  }

  const shownStaples = staples.slice(0, staplesVisible);
  const remainingStaples = staples.length - shownStaples.length;

  return (
    <section className="space-y-4 rounded-md border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="label-mono hover:text-foreground"
        >
          ▾ Pantry · hold to remove
        </button>
      </div>

      {perishables.length > 0 && (
        <div className="space-y-2">
          <div className="label-mono text-muted-foreground">Fresh · {perishables.length}</div>
          <div className="flex flex-wrap gap-2">
            {perishables.map((i) => (
              <EditablePantryChip key={i.id} id={i.id} name={i.name} />
            ))}
          </div>
        </div>
      )}

      {staples.length > 0 && (
        <div className="space-y-2">
          <div className="label-mono text-muted-foreground">Staples · {staples.length}</div>
          <div className="flex flex-wrap gap-2">
            {shownStaples.map((i) => (
              <EditablePantryChip key={i.id} id={i.id} name={i.name} />
            ))}
          </div>
          {(remainingStaples > 0 || staplesVisible > STAPLES_PAGE) && (
            <div className="flex justify-between pt-1">
              {remainingStaples > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setStaplesVisible((v) => v + STAPLES_PAGE)}
                  className="font-mono uppercase text-[0.7rem] tracking-wider"
                >
                  Show {Math.min(STAPLES_PAGE, remainingStaples)} more
                </Button>
              ) : (
                <span />
              )}
              {staplesVisible > STAPLES_PAGE && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setStaplesVisible(STAPLES_PAGE)}
                  className="font-mono uppercase text-[0.7rem] tracking-wider"
                >
                  Collapse
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
