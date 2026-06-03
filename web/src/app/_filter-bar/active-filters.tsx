"use client";

import { useCallback } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

type FilterKey = "season" | "course" | "cuisine" | "holiday" | "tags" | "author";

const KEY_LABELS: Record<FilterKey, string> = {
  season: "season",
  course: "course",
  cuisine: "cuisine",
  holiday: "holiday",
  tags: "tag",
  author: "author",
};

export function ActiveFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const items: { key: FilterKey; value: string }[] = [];
  for (const key of Object.keys(KEY_LABELS) as FilterKey[]) {
    const raw = searchParams.get(key);
    if (!raw) continue;
    for (const v of raw.split(",").filter(Boolean)) {
      items.push({ key, value: v });
    }
  }

  const removeOne = useCallback(
    (key: FilterKey, value: string) => {
      const next = new URLSearchParams(searchParams.toString());
      const current = next.get(key)?.split(",").filter(Boolean) ?? [];
      const remaining = current.filter((x) => x !== value);
      if (remaining.length === 0) next.delete(key);
      else next.set(key, remaining.join(","));
      next.delete("page");
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, searchParams],
  );

  const clearAll = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    for (const key of Object.keys(KEY_LABELS) as FilterKey[]) next.delete(key);
    next.delete("page");
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }, [router, pathname, searchParams]);

  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map(({ key, value }) => (
        <button
          key={`${key}-${value}`}
          type="button"
          onClick={() => removeOne(key, value)}
          className="rounded-full border bg-foreground text-background px-2.5 py-0.5 text-xs hover:opacity-90"
          title="Remove filter"
        >
          {KEY_LABELS[key]}: {value} <span aria-hidden>×</span>
        </button>
      ))}
      {items.length > 1 && (
        <button
          type="button"
          onClick={clearAll}
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
