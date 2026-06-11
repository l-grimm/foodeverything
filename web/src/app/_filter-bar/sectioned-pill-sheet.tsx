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

// A section option is usually just its value (rendered as-is, default
// styling). Pass an object when you need a different display label or a
// non-default variant — used by the "review" pill (red) and "family"
// pill (green) so they visually match the same chips on recipe cards.
export type PillVariant = "default" | "warn" | "family";

export type PillOption =
  | string
  | { value: string; label?: string; variant?: PillVariant };

export type Section = {
  key: string;
  title: string;
  options: PillOption[];
};

function normalize(opt: PillOption): {
  value: string;
  label: string;
  variant: PillVariant;
} {
  if (typeof opt === "string")
    return { value: opt, label: opt, variant: "default" };
  return {
    value: opt.value,
    label: opt.label ?? opt.value,
    variant: opt.variant ?? "default",
  };
}

function pillClasses(variant: PillVariant, active: boolean): string {
  if (variant === "warn") {
    return active
      ? "bg-destructive text-destructive-foreground border-destructive"
      : "bg-transparent text-destructive border-destructive hover:bg-destructive/10";
  }
  if (variant === "family") {
    return active
      ? "bg-secondary text-secondary-foreground border-secondary"
      : "bg-transparent text-secondary border-secondary hover:bg-secondary/10";
  }
  return active
    ? "bg-primary text-primary-foreground border-primary"
    : "bg-transparent text-primary border-primary hover:bg-primary/10";
}

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
                    {s.options.map((rawOpt) => {
                      const { value, label, variant } = normalize(rawOpt);
                      const active = (local[s.key] ?? []).includes(value);
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => toggle(s.key, value)}
                          className={`rounded-full border px-3 py-1.5 font-mono text-[0.7rem] uppercase tracking-wider transition ${pillClasses(variant, active)}`}
                        >
                          {label}
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
