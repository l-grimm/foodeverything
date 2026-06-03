import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RecipeWithCoverage } from "@/lib/types";

// Pure presentational recipe card — used by every section on the home page
// so all three render consistently. No data fetching here.
export function RecipeCard({
  recipe: r,
  showCoverage,
}: {
  recipe: RecipeWithCoverage;
  showCoverage: boolean;
}) {
  return (
    <Link href={`/recipe/${r.id}`} className="block group">
      <Card className="h-full transition group-hover:shadow-md">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-base leading-snug">{r.title}</CardTitle>
            {showCoverage && r.total_count > 0 && (
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
  );
}

function CoverageBadge({ matched, total }: { matched: number; total: number }) {
  const missing = total - matched;
  const pct = total > 0 ? matched / total : 0;
  const tone =
    pct >= 0.8 ? "bg-emerald-100 text-emerald-900 border-emerald-300"
    : pct >= 0.5 ? "bg-amber-50 text-amber-900 border-amber-200"
    : "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-xs tabular-nums ${tone}`}
      title={`${missing} of ${total} ingredient${total === 1 ? "" : "s"} not in pantry`}
    >
      {missing === 0 ? "ready" : `${missing} missing`}
    </span>
  );
}
