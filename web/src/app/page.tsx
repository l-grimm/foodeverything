import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { listRecipes, getFilterFacets } from "@/lib/queries";

const PAGE_SIZE = 24;

function chipParams(current: Record<string, string | undefined>, key: string, value: string | undefined): string {
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(current)) {
    if (v && k !== key && k !== "page") next[k] = v;
  }
  if (value) next[key] = value;
  const qs = new URLSearchParams(next).toString();
  return qs ? `/?${qs}` : "/";
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const filters = {
    q: sp.q || undefined,
    family: sp.family === "1",
    favorite: sp.favorite === "1",
    course: sp.course,
    season: sp.season,
    holiday: sp.holiday,
    cuisine: sp.cuisine,
    platform: sp.platform,
    needsReview: sp.needsReview === "1",
    page,
    pageSize: PAGE_SIZE,
  };

  const [{ recipes, total, hasPantry }, facets] = await Promise.all([
    listRecipes(filters),
    getFilterFacets(),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <form action="/" className="flex gap-2">
        <Input
          name="q"
          defaultValue={filters.q ?? ""}
          placeholder="Search recipes by title…"
          className="text-base"
        />
        {filters.family && <input type="hidden" name="family" value="1" />}
        {filters.favorite && <input type="hidden" name="favorite" value="1" />}
        {filters.course && <input type="hidden" name="course" value={filters.course} />}
        {filters.season && <input type="hidden" name="season" value={filters.season} />}
        {filters.holiday && <input type="hidden" name="holiday" value={filters.holiday} />}
        {filters.cuisine && <input type="hidden" name="cuisine" value={filters.cuisine} />}
        {filters.platform && <input type="hidden" name="platform" value={filters.platform} />}
        {filters.needsReview && <input type="hidden" name="needsReview" value="1" />}
      </form>

      <div className="flex flex-wrap gap-2 text-sm">
        <FilterChip current={sp} k="family" v="1" label="Family" />
        <FilterChip current={sp} k="favorite" v="1" label="Favorites" />
        <FilterChip current={sp} k="needsReview" v="1" label="Needs review" />
        {facets.seasons.map((s) => (
          <FilterChip key={`s-${s}`} current={sp} k="season" v={s} label={cap(s)} />
        ))}
        {facets.courses.map((c) => (
          <FilterChip key={`c-${c}`} current={sp} k="course" v={c} label={cap(c)} />
        ))}
        {facets.holidays.map((h) => (
          <FilterChip key={`h-${h}`} current={sp} k="holiday" v={h} label={h} />
        ))}
        {facets.cuisines.map((c) => (
          <FilterChip key={`cu-${c}`} current={sp} k="cuisine" v={c} label={c} />
        ))}
        {facets.platforms.map((p) => (
          <FilterChip key={`p-${p}`} current={sp} k="platform" v={p} label={cap(p)} />
        ))}
      </div>

      <div className="text-sm text-muted-foreground">
        {total} recipe{total === 1 ? "" : "s"}
        {filters.q ? ` matching "${filters.q}"` : ""}
        {hasPantry && (
          <span className="ml-2">• sorted by pantry coverage</span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {recipes.map((r) => (
          <Link key={r.id} href={`/recipe/${r.id}`} className="block group">
            <Card className="h-full transition group-hover:shadow-md">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base leading-snug">{r.title}</CardTitle>
                  {hasPantry && r.total_count > 0 && (
                    <CoverageBadge matched={r.matched_count} total={r.total_count} />
                  )}
                </div>
                {r.author && (
                  <div className="text-sm text-muted-foreground">{r.author}</div>
                )}
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex flex-wrap gap-1">
                  {r.is_family_recipe && (
                    <Badge variant="secondary" className="text-xs">family</Badge>
                  )}
                  {r.holiday && <Badge variant="outline" className="text-xs">{r.holiday}</Badge>}
                  {r.season && <Badge variant="outline" className="text-xs">{r.season}</Badge>}
                  {r.course && <Badge variant="outline" className="text-xs">{r.course}</Badge>}
                  {r.cuisine && <Badge variant="outline" className="text-xs">{r.cuisine}</Badge>}
                  {r.source_platform && r.source_platform !== "manual" && (
                    <Badge variant="outline" className="text-xs">{r.source_platform}</Badge>
                  )}
                  {r.extraction_confidence === "needs_review" && (
                    <Badge variant="destructive" className="text-xs">review</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {totalPages > 1 && <Pagination current={page} total={totalPages} sp={sp} />}
    </div>
  );
}

function FilterChip({
  current,
  k,
  v,
  label,
}: {
  current: Record<string, string | undefined>;
  k: string;
  v: string;
  label: string;
}) {
  const active = current[k] === v;
  return (
    <Link
      href={chipParams(current, k, active ? undefined : v)}
      className={`rounded-full border px-3 py-1 text-xs ${
        active
          ? "bg-foreground text-background border-foreground"
          : "bg-background hover:bg-accent"
      }`}
    >
      {label}
    </Link>
  );
}

function Pagination({
  current,
  total,
  sp,
}: {
  current: number;
  total: number;
  sp: Record<string, string | undefined>;
}) {
  function pageHref(p: number): string {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(sp)) {
      if (v && k !== "page") next[k] = v;
    }
    if (p > 1) next.page = String(p);
    const qs = new URLSearchParams(next).toString();
    return qs ? `/?${qs}` : "/";
  }
  return (
    <div className="flex justify-between items-center pt-2 text-sm">
      <Link
        href={pageHref(Math.max(1, current - 1))}
        aria-disabled={current === 1}
        className={`rounded-md border px-3 py-1 ${current === 1 ? "pointer-events-none opacity-40" : "hover:bg-accent"}`}
      >
        ← Previous
      </Link>
      <div className="text-muted-foreground">
        Page {current} of {total}
      </div>
      <Link
        href={pageHref(Math.min(total, current + 1))}
        aria-disabled={current === total}
        className={`rounded-md border px-3 py-1 ${current === total ? "pointer-events-none opacity-40" : "hover:bg-accent"}`}
      >
        Next →
      </Link>
    </div>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
}

function CoverageBadge({ matched, total }: { matched: number; total: number }) {
  const pct = total > 0 ? matched / total : 0;
  // Green when you have most of the recipe; muted when you barely have any.
  const tone =
    pct >= 0.8 ? "bg-emerald-100 text-emerald-900 border-emerald-300"
    : pct >= 0.5 ? "bg-amber-50 text-amber-900 border-amber-200"
    : "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-xs tabular-nums ${tone}`}
      title={`${matched} of ${total} ingredients in pantry`}
    >
      {matched}/{total}
    </span>
  );
}
