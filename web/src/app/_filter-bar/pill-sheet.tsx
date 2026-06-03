"use client";

import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

export type PillSheetMode = "single" | "multi";

// Generic pill-selection sheet. Powers the home-page filter bar today and
// will power "edit course/season/cuisine/tags on a recipe" later — same UI,
// different onApply wiring.
export function PillSheet({
  trigger,
  title,
  options,
  selected,
  mode = "multi",
  onApply,
  emptyLabel = "Nothing to choose from yet.",
}: {
  trigger: React.ReactNode;
  title: string;
  options: string[];
  selected: string[];
  mode?: PillSheetMode;
  onApply: (next: string[]) => void;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState<string[]>(selected);

  // Sync local to incoming selected at open-time so cancel never
  // half-commits. Doing this in onOpenChange avoids a useEffect that would
  // trigger the no-set-state-in-effect lint rule.
  function handleOpenChange(o: boolean) {
    if (o) setLocal(selected);
    setOpen(o);
  }

  function toggle(opt: string) {
    if (mode === "single") {
      setLocal(local.includes(opt) ? [] : [opt]);
    } else {
      setLocal(local.includes(opt) ? local.filter((x) => x !== opt) : [...local, opt]);
    }
  }

  function apply() {
    onApply(local);
    setOpen(false);
  }

  function clear() {
    setLocal([]);
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger render={trigger as React.ReactElement} />
      <SheetContent side="bottom" className="max-h-[80vh]">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <div className="overflow-y-auto px-4">
          {options.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">{emptyLabel}</p>
          ) : (
            <div className="flex flex-wrap gap-2 pb-2">
              {options.map((opt) => {
                const active = local.includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => toggle(opt)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition ${
                      active
                        ? "bg-foreground text-background border-foreground"
                        : "bg-background hover:bg-accent"
                    }`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <SheetFooter>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={clear}
              className="flex-1"
              disabled={local.length === 0}
            >
              Clear
            </Button>
            <Button onClick={apply} className="flex-1">
              Apply
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
