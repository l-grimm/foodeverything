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

export type Section = {
  key: string;
  title: string;
  options: string[];
};

// Sectioned pill sheet — same shell as PillSheet but the body is grouped
// under section headers. Powers the "More" filter so the user picks from
// HOLIDAY / DIET / TAGS without seeing prefix-encoded labels like
// "holiday:Passover". Each pill is just the value itself; the section
// header carries the category context.
export function SectionedPillSheet({
  trigger,
  title,
  sections,
  selected,
  onApply,
  emptyLabel = "Nothing to choose from yet.",
}: {
  trigger: React.ReactNode;
  title: string;
  sections: Section[];
  selected: Record<string, string[]>;
  onApply: (next: Record<string, string[]>) => void;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState<Record<string, string[]>>(selected);

  function handleOpenChange(o: boolean) {
    if (o) setLocal(selected);
    setOpen(o);
  }

  function toggle(sectionKey: string, opt: string) {
    setLocal((prev) => {
      const cur = prev[sectionKey] ?? [];
      const next = cur.includes(opt)
        ? cur.filter((x) => x !== opt)
        : [...cur, opt];
      return { ...prev, [sectionKey]: next };
    });
  }

  function apply() {
    onApply(local);
    setOpen(false);
  }

  function clear() {
    setLocal({});
  }

  const totalSelected = Object.values(local).reduce(
    (sum, arr) => sum + arr.length,
    0,
  );
  const renderableSections = sections.filter((s) => s.options.length > 0);

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger render={trigger as React.ReactElement} />
      <SheetContent side="bottom" className="max-h-[80vh] bg-background border-border">
        <SheetHeader className="border-b border-border">
          <SheetTitle className="label-mono">{title}</SheetTitle>
        </SheetHeader>
        <div className="overflow-y-auto px-4">
          {renderableSections.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">{emptyLabel}</p>
          ) : (
            <div className="space-y-5 pb-2 pt-3">
              {renderableSections.map((s) => (
                <div key={s.key}>
                  <div className="label-mono mb-2">{s.title}</div>
                  <div className="flex flex-wrap gap-2">
                    {s.options.map((opt) => {
                      const active = (local[s.key] ?? []).includes(opt);
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => toggle(s.key, opt)}
                          className={`rounded-full border px-3 py-1.5 font-mono text-[0.7rem] uppercase tracking-wider transition ${
                            active
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-transparent text-primary border-primary hover:bg-primary/10"
                          }`}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <SheetFooter className="border-t border-border">
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={clear}
              className="flex-1 font-mono uppercase tracking-wider text-[0.7rem]"
              disabled={totalSelected === 0}
            >
              Clear
            </Button>
            <Button
              onClick={apply}
              className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 font-mono uppercase tracking-wider text-[0.7rem]"
            >
              Apply
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
