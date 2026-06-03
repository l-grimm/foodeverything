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
      <section className="rounded-md border border-border bg-card px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <span className="label-mono">
            ▸ Pantry · {items.length} items
          </span>
          <span className="label-mono">edit</span>
        </button>
      </section>
    );
  }

  const shown = items.slice(0, visible);
  const remaining = items.length - shown.length;

  return (
    <section className="space-y-3 rounded-md border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="label-mono hover:text-foreground"
        >
          ▾ Pantry · {items.length} items · tap to fix or delete
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
              className="font-mono uppercase text-[0.7rem] tracking-wider"
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
              className="font-mono uppercase text-[0.7rem] tracking-wider"
            >
              Collapse
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
