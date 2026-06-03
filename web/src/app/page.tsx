import { Input } from "@/components/ui/input";
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
    <div className="space-y-6">
      {/* Search — sticky so it survives scrolling */}
      <div className="sticky top-[3.5rem] z-30 -mx-4 bg-background/95 backdrop-blur px-4 py-2 border-b">
        <form action="/" className="flex gap-2">
          <Input
            name="q"
            defaultValue={filters.q ?? ""}
            placeholder="Search recipes by title…"
            className="text-base"
          />
          {/* Preserve current multi-value filters across a search submit */}
          {filters.course.length > 0 && (
            <input type="hidden" name="course" value={filters.course.join(",")} />
          )}
          {filters.season.length > 0 && (
            <input type="hidden" name="season" value={filters.season.join(",")} />
          )}
          {filters.cuisine.length > 0 && (
            <input type="hidden" name="cuisine" value={filters.cuisine.join(",")} />
          )}
          {filters.holiday.length > 0 && (
            <input type="hidden" name="holiday" value={filters.holiday.join(",")} />
          )}
          {filters.tags.length > 0 && (
            <input type="hidden" name="tags" value={filters.tags.join(",")} />
          )}
          {filters.author.length > 0 && (
            <input type="hidden" name="author" value={filters.author.join(",")} />
          )}
        </form>
      </div>

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
        title="What to cook now"
        subtitle={
          hasPantry
            ? "Breakfast, lunch, dinner · in-season recipes ranked by pantry coverage"
            : "Breakfast, lunch, dinner · in-season recipes first"
        }
        recipes={cookNow.recipes}
        showCoverage={hasPantry}
      />

      {recent.recipes.length > 0 && (
        <section className="space-y-3">
          <header>
            <h2 className="text-lg font-semibold">Recently added</h2>
            <p className="text-xs text-muted-foreground">
              Recipes you added in the last 14 days
            </p>
          </header>
          <RecentStrip recipes={recent.recipes} showCoverage={hasPantry} />
        </section>
      )}

      <Section
        title="Treats & extras"
        subtitle="Desserts, snacks, drinks, sides, and appetizers"
        recipes={treats.recipes}
        showCoverage={hasPantry}
      />

      {hasAnyFilter &&
        cookNow.recipes.length === 0 &&
        recent.recipes.length === 0 &&
        treats.recipes.length === 0 && (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No recipes match these filters. Try clearing some above.
            </p>
          </div>
        )}

      <RecentPantryStrip />
    </div>
  );
}

function Section({
  title,
  subtitle,
  recipes,
  showCoverage,
}: {
  title: string;
  subtitle: string;
  recipes: Awaited<ReturnType<typeof listRecipesForSection>>["recipes"];
  showCoverage: boolean;
}) {
  if (recipes.length === 0) return null;
  return (
    <section className="space-y-3">
      <header>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </header>
      <SectionList recipes={recipes} showCoverage={showCoverage} />
    </section>
  );
}
