"use client";

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PillSheet } from "./pill-sheet";
import { SectionedPillSheet } from "./sectioned-pill-sheet";
import { COURSES, SEASONS, DIET_TAGS } from "@/lib/pill-catalogs";

export type FilterFacets = {
  cuisines: string[];
  holidays: string[];
  tags: string[];
  authors: string[];
};

type FilterKey = "season" | "course" | "cuisine" | "holiday" | "tags" | "author";

// Synthetic pill rendered in the Tags section that flips ?needsReview=1
// rather than a real tags[] value — extraction_confidence lives on its own
// recipes column, not in tags[], so we keep its UI affordance grouped with
// other "filter by recipe status" things but route it to the right param.
const NEEDS_REVIEW_PILL = "needs-review";

// IMPORTANT: spread `...rest` onto Button — base-ui's Sheet/Dialog Trigger
// clones the element passed via `render` and merges in onClick, aria-*, ref,
// etc. If we don't forward them, the trigger looks right but does nothing.
//
// Roux pill aesthetic: outlined when inactive (border-primary, blue text),
// solid blue when one or more values are selected.
function FilterTrigger({
  label,
  count,
  ...rest
}: { label: string; count: number } & React.ComponentProps<typeof Button>) {
  const active = count > 0;
  return (
    <Button
      {...rest}
      type="button"
      size="sm"
      className={`rounded-full font-mono uppercase tracking-wider text-[0.7rem] border ${
        active
          ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
          : "bg-transparent text-primary border-primary hover:bg-primary/10"
      }`}
    >
      {label}
      {active && ` · ${count}`}
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

  const needsReviewActive = searchParams.get("needsReview") === "1";
  const moreCount =
    selected("holiday").length +
    selected("tags").length +
    (needsReviewActive ? 1 : 0);

  // Split the tags facet into diet (curated allowlist) and everything-else.
  // Diet tags get their own section under "More" so users see them grouped
  // separately from workflow tags (weeknight, make-ahead, etc.).
  const { dietOptions, otherTagOptions } = useMemo(() => {
    const dietSet = new Set<string>(DIET_TAGS);
    const diet: string[] = [];
    const other: string[] = [];
    for (const t of facets.tags) {
      if (dietSet.has(t)) diet.push(t);
      else other.push(t);
    }
    // Preserve DIET_TAGS' editorial order rather than alphabetizing.
    diet.sort((a, b) => DIET_TAGS.indexOf(a) - DIET_TAGS.indexOf(b));
    return { dietOptions: diet, otherTagOptions: other };
  }, [facets.tags]);

  const selectedTags = selected("tags");
  const dietSelected = selectedTags.filter((t) => DIET_TAGS.includes(t));
  const otherTagsSelected = selectedTags.filter((t) => !DIET_TAGS.includes(t));

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
        title="Author"
        options={facets.authors}
        selected={selected("author")}
        onApply={(v) => setFilter("author", v)}
        trigger={<FilterTrigger label="Author" count={selected("author").length} />}
      />
      <SectionedPillSheet
        title="More"
        sections={[
          { key: "holiday", title: "Holiday", options: facets.holidays },
          { key: "diet", title: "Diet", options: dietOptions },
          {
            key: "tags",
            title: "Tags",
            // needs-review pinned first — it's a status, not a content tag.
            options: [NEEDS_REVIEW_PILL, ...otherTagOptions],
          },
        ]}
        selected={{
          holiday: selected("holiday"),
          diet: dietSelected,
          tags: needsReviewActive
            ? [NEEDS_REVIEW_PILL, ...otherTagsSelected]
            : otherTagsSelected,
        }}
        onApply={(picked) => {
          const holidays = picked.holiday ?? [];
          const pickedTags = picked.tags ?? [];
          const wantsNeedsReview = pickedTags.includes(NEEDS_REVIEW_PILL);
          const realTags = [
            ...(picked.diet ?? []),
            ...pickedTags.filter((t) => t !== NEEDS_REVIEW_PILL),
          ];
          const next = new URLSearchParams(searchParams.toString());
          if (holidays.length) next.set("holiday", holidays.join(","));
          else next.delete("holiday");
          if (realTags.length) next.set("tags", realTags.join(","));
          else next.delete("tags");
          if (wantsNeedsReview) next.set("needsReview", "1");
          else next.delete("needsReview");
          next.delete("page");
          const qs = next.toString();
          router.push(qs ? `${pathname}?${qs}` : pathname);
        }}
        trigger={<FilterTrigger label="More" count={moreCount} />}
        emptyLabel="No holidays, diet tags, or tags on any recipes yet."
      />
    </div>
  );
}
