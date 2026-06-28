import {
  listRecipesForSection,
  getFilterFacets,
  getRecipeSearchIndex,
  type SectionTab,
} from "@/lib/queries";
import type { RecipeWithCoverage } from "@/lib/types";
import { FilterBar } from "./_filter-bar/filter-bar";
import { ActiveFilters } from "./_filter-bar/active-filters";
import { SectionList } from "./_sections/section-list";
import { SectionTabs } from "./_sections/section-tabs";
import { RecentStrip } from "./_sections/recent-strip";
import { RecentPantryStrip } from "./_pantry-widget/strip";
import { HomeScrollRestorer } from "./_home-scroll-restorer";

const PAGE_SIZE = 60;

function multi(sp: Record<string, string | undefined>, key: string): string[] {
  return sp[key]?.split(",").filter(Boolean) ?? [];
}

function parseTab(raw: string | undefined): SectionTab {
  return raw === "coverage" ? "coverage" : "seasonal";
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const filters = {
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

  const cookTab = parseTab(sp.cookTab);
  const treatsTab = parseTab(sp.treatsTab);

  const [cookNow, recent, treats, facets, searchIndex] = await Promise.all([
    listRecipesForSection("cookNow", cookTab, filters),
    listRecipesForSection("recent", "seasonal", filters), // tab unused for recent
    listRecipesForSection("treats", treatsTab, filters),
    getFilterFacets(),
    getRecipeSearchIndex(),
  ]);

  // Attach the precomputed search blob ("title + ingredient names",
  // lowercased) to each recipe so the client-side SearchBar can do
  // instant substring filtering against it.
  const withSearch = (recipes: RecipeWithCoverage[]): RecipeWithCoverage[] =>
    recipes.map((r) => ({
      ...r,
      search_text: searchIndex.get(r.id) ?? r.title.toLowerCase(),
    }));
  cookNow.recipes = withSearch(cookNow.recipes);
  recent.recipes = withSearch(recent.recipes);
  treats.recipes = withSearch(treats.recipes);

  const hasPantry = cookNow.hasPantry;
  const hasAnyFilter =
    filters.course.length +
      filters.season.length +
      filters.cuisine.length +
      filters.holiday.length +
      filters.tags.length +
      filters.author.length >
      0;

  return (
    <div className="space-y-8">
      <HomeScrollRestorer />
      <FilterBar
        facets={{
          cuisines: facets.cuisines,
          holidays: facets.holidays,
          tags: facets.tags,
          authors: facets.authors,
        }}
      />

      <ActiveFilters />

      <SectionFrame
        label="What to cook now"
        subtitle="Breakfast, lunch, dinner"
      >
        <SectionTabs current={cookTab} paramKey="cookTab" sp={sp} />
        {cookNow.recipes.length > 0 ? (
          <SectionList recipes={cookNow.recipes} showCoverage={hasPantry} />
        ) : (
          <EmptyTab tab={cookTab} />
        )}
      </SectionFrame>

      <SectionFrame
        label="Treats & extras"
        subtitle="Desserts, snacks, drinks, sides, appetizers"
      >
        <SectionTabs current={treatsTab} paramKey="treatsTab" sp={sp} />
        {treats.recipes.length > 0 ? (
          <SectionList recipes={treats.recipes} showCoverage={hasPantry} />
        ) : (
          <EmptyTab tab={treatsTab} />
        )}
      </SectionFrame>

      {recent.recipes.length > 0 && (
        <SectionFrame label="Recently added" subtitle="Last 14 days">
          <RecentStrip recipes={recent.recipes} showCoverage={hasPantry} />
        </SectionFrame>
      )}

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

function EmptyTab({ tab }: { tab: SectionTab }) {
  return (
    <div className="rounded-md border border-dashed border-border p-6 text-center">
      <p className="text-sm text-muted-foreground">
        {tab === "seasonal"
          ? "Nothing in season here right now — try By coverage."
          : "Nothing to show. Adjust filters above."}
      </p>
    </div>
  );
}
