"use client";

import { useCallback } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PillSheet } from "./pill-sheet";
import { COURSES, SEASONS } from "@/lib/pill-catalogs";

export type FilterFacets = {
  cuisines: string[];
  holidays: string[];
  tags: string[];
};

type FilterKey = "season" | "course" | "cuisine" | "holiday" | "tags";

function FilterTrigger({ label, count }: { label: string; count: number }) {
  return (
    <Button
      type="button"
      variant={count > 0 ? "default" : "outline"}
      size="sm"
      className="rounded-full"
    >
      {label}
      {count > 0 && ` (${count})`}
    </Button>
  );
}

export function FilterBar({ facets }: { facets: FilterFacets }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const selected = useCallback(
    (key: FilterKey): string[] =>
      searchParams.get(key)?.split(",").filter(Boolean) ?? [],
    [searchParams],
  );

  const setFilter = useCallback(
    (key: FilterKey, values: string[]) => {
      const next = new URLSearchParams(searchParams.toString());
      if (values.length === 0) next.delete(key);
      else next.set(key, values.join(","));
      next.delete("page");
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, searchParams],
  );

  const moreCount = selected("holiday").length + selected("tags").length;

  return (
    <div className="flex flex-wrap gap-2">
      <PillSheet
        title="Season"
        options={SEASONS as unknown as string[]}
        selected={selected("season")}
        onApply={(v) => setFilter("season", v)}
        trigger={<FilterTrigger label="Season" count={selected("season").length} />}
      />
      <PillSheet
        title="Course"
        options={COURSES as unknown as string[]}
        selected={selected("course")}
        onApply={(v) => setFilter("course", v)}
        trigger={<FilterTrigger label="Course" count={selected("course").length} />}
      />
      <PillSheet
        title="Cuisine"
        options={facets.cuisines}
        selected={selected("cuisine")}
        onApply={(v) => setFilter("cuisine", v)}
        trigger={<FilterTrigger label="Cuisine" count={selected("cuisine").length} />}
      />
      <PillSheet
        title="More — holidays, tags, diet"
        options={[
          ...facets.holidays.map((h) => `holiday:${h}`),
          ...facets.tags.map((t) => `tag:${t}`),
        ]}
        selected={[
          ...selected("holiday").map((h) => `holiday:${h}`),
          ...selected("tags").map((t) => `tag:${t}`),
        ]}
        onApply={(v) => {
          const holidays = v
            .filter((x) => x.startsWith("holiday:"))
            .map((x) => x.slice("holiday:".length));
          const tags = v
            .filter((x) => x.startsWith("tag:"))
            .map((x) => x.slice("tag:".length));
          const next = new URLSearchParams(searchParams.toString());
          if (holidays.length) next.set("holiday", holidays.join(","));
          else next.delete("holiday");
          if (tags.length) next.set("tags", tags.join(","));
          else next.delete("tags");
          next.delete("page");
          const qs = next.toString();
          router.push(qs ? `${pathname}?${qs}` : pathname);
        }}
        trigger={<FilterTrigger label="More" count={moreCount} />}
        emptyLabel="No holidays or tags on any recipes yet."
      />
    </div>
  );
}
