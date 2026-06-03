"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { EditablePantryChip } from "./chip";
import type { RecentPantryItem } from "@/lib/queries";

const PAGE = 10;

export function PantryStripClient({ items }: { items: RecentPantryItem[] }) {
  // Collapsed by default — pantry edits are a reactive task ("oh, this name
  // is wrong"), not a thing you scan on every page load.
  const [expanded, setExpanded] = useState(false);
  const [visible, setVisible] = useState(PAGE);

  if (!expanded) {
    return (
      <section className="rounded-lg border bg-muted/30 px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full items-center justify-between gap-2 text-left text-sm"
        >
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            ▸ Pantry · {items.length} items
          </span>
          <span className="text-xs text-muted-foreground">edit names</span>
        </button>
      </section>
    );
  }

  const shown = items.slice(0, visible);
  const remaining = items.length - shown.length;

  return (
    <section className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground"
        >
          ▾ Pantry · {items.length} items · tap a chip to fix or delete
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {shown.map((i) => (
          <EditablePantryChip key={i.id} id={i.id} name={i.name} />
        ))}
      </div>
      {(remaining > 0 || visible > PAGE) && (
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
          {visible > PAGE && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setVisible(PAGE)}
            >
              Collapse
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
