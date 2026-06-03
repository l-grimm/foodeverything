import { listRecipesForSection, getFilterFacets } from "@/lib/queries";
import { FilterBar } from "./_filter-bar/filter-bar";
import { ActiveFilters } from "./_filter-bar/active-filters";
import { SectionList } from "./_sections/section-list";
import { RecentStrip } from "./_sections/recent-strip";
import { RecentPantryStrip } from "./_pantry-widget/strip";

const PAGE_SIZE = 60;

function multi(sp: Record<string, string | undefined>, key: string): string[] {
  return sp[key]?.split(",").filter(Boolean) ?? [];
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const filters = {
    q: sp.q || undefined,
    family: sp.family === "1",
    favorite: sp.favorite === "1",
    course: multi(sp, "course"),
    season: multi(sp, "season"),
    holiday: multi(sp, "holiday"),
    cuisine: multi(sp, "cuisine"),
    platform: multi(sp, "platform"),
    tags: multi(sp, "tags"),
    author: multi(sp, "author"),
    needsReview: sp.needsReview === "1",
    page: 1,
    pageSize: PAGE_SIZE,
  };

  const [cookNow, recent, treats, facets] = await Promise.all([
    listRecipesForSection("cookNow", filters),
    listRecipesForSection("recent", filters),
    listRecipesForSection("treats", filters),
    getFilterFacets(),
  ]);

  const hasPantry = cookNow.hasPantry;
  const hasAnyFilter =
    !!filters.q ||
    filters.course.length +
      filters.season.length +
      filters.cuisine.length +
      filters.holiday.length +
      filters.tags.length +
      filters.author.length >
      0;

  return (
    <div className="space-y-8">
      <FilterBar
        facets={{
          cuisines: facets.cuisines,
          holidays: facets.holidays,
          tags: facets.tags,
          authors: facets.authors,
        }}
      />

      <ActiveFilters />

      <Section
        label="What to cook now"
        subtitle={
          hasPantry
            ? "Breakfast, lunch, dinner · in-season first, then by pantry coverage"
            : "Breakfast, lunch, dinner · in-season first"
        }
        recipes={cookNow.recipes}
        showCoverage={hasPantry}
      />

      {recent.recipes.length > 0 && (
        <SectionFrame
          label="Recently added"
          subtitle="Last 14 days"
        >
          <RecentStrip recipes={recent.recipes} showCoverage={hasPantry} />
        </SectionFrame>
      )}

      <Section
        label="Treats & extras"
        subtitle="Desserts, snacks, drinks, sides, appetizers"
        recipes={treats.recipes}
        showCoverage={hasPantry}
      />

      {hasAnyFilter &&
        cookNow.recipes.length === 0 &&
        recent.recipes.length === 0 &&
        treats.recipes.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No recipes match these filters. Try clearing some above.
            </p>
          </div>
        )}

      <RecentPantryStrip />
    </div>
  );
}

// Section header: horizontal rule + bold mono caps in Spinach Green.
// Section-scale (text-sm) — distinct from the smaller label-mono used
// elsewhere for metadata micro-labels.
function SectionFrame({
  label,
  subtitle,
  children,
}: {
  label: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <header className="border-t border-border pt-3 space-y-1">
        <div className="font-mono uppercase tracking-wider text-sm font-bold text-secondary">
          {label}
        </div>
        {subtitle && (
          <div className="text-sm text-muted-foreground">{subtitle}</div>
        )}
      </header>
      {children}
    </section>
  );
}

function Section({
  label,
  subtitle,
  recipes,
  showCoverage,
}: {
  label: string;
  subtitle: string;
  recipes: Awaited<ReturnType<typeof listRecipesForSection>>["recipes"];
  showCoverage: boolean;
}) {
  if (recipes.length === 0) return null;
  return (
    <SectionFrame label={label} subtitle={subtitle}>
      <SectionList recipes={recipes} showCoverage={showCoverage} />
    </SectionFrame>
  );
}
