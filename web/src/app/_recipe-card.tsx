import Link from "next/link";
import type { RecipeWithCoverage } from "@/lib/types";

// Pure presentational recipe card. Roux-style: dark surface, cream
// type, blue accent pill for coverage, mono micro-labels for metadata.
export function RecipeCard({
  recipe: r,
  showCoverage,
}: {
  recipe: RecipeWithCoverage;
  showCoverage: boolean;
}) {
  return (
    <Link href={`/recipe/${r.id}`} className="block group">
      <article className="h-full rounded-md border border-border bg-card p-4 transition group-hover:border-primary/60">
        <div className="flex items-start justify-between gap-3 mb-2">
          <h3 className="text-base font-medium leading-snug text-foreground">
            {r.title}
          </h3>
          {showCoverage && r.total_count > 0 && (
            <CoveragePill matched={r.matched_count} total={r.total_count} />
          )}
        </div>

        {r.author && (
          <div className="label-mono mb-3">{r.author}</div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {r.is_family_recipe && <MetaChip variant="family">Family</MetaChip>}
          {r.holiday && <MetaChip>{r.holiday}</MetaChip>}
          {r.season && <MetaChip>{r.season}</MetaChip>}
          {r.course && <MetaChip>{r.course}</MetaChip>}
          {r.cuisine && <MetaChip>{r.cuisine}</MetaChip>}
          {r.source_platform && r.source_platform !== "manual" && (
            <MetaChip>{r.source_platform}</MetaChip>
          )}
          {r.extraction_confidence === "needs_review" && (
            <MetaChip variant="warn">review</MetaChip>
          )}
        </div>
      </article>
    </Link>
  );
}

function CoveragePill({ matched, total }: { matched: number; total: number }) {
  const missing = total - matched;
  const ready = missing === 0;
  // Roux "108 FORKS" treatment: outline pill on dark. Filled when ready.
  const cls = ready
    ? "bg-primary text-primary-foreground border-primary"
    : "border-primary text-primary";
  return (
    <span
      className={`shrink-0 rounded-full border px-2.5 py-0.5 font-mono text-[0.65rem] uppercase tracking-wider tabular-nums ${cls}`}
      title={`${missing} of ${total} ingredient${total === 1 ? "" : "s"} not in pantry`}
    >
      {ready ? "ready" : `${missing} missing`}
    </span>
  );
}

function MetaChip({
  children,
  variant = "outline",
}: {
  children: React.ReactNode;
  variant?: "outline" | "solid" | "family" | "warn";
}) {
  const cls =
    variant === "solid"
      ? "border-primary bg-primary text-primary-foreground"
      : variant === "family"
      ? "border-secondary bg-secondary text-secondary-foreground"
      : variant === "warn"
      ? "border-destructive text-destructive"
      : "border-border text-muted-foreground";
  return (
    <span
      className={`rounded-full border px-2 py-0.5 font-mono text-[0.65rem] uppercase tracking-wider ${cls}`}
    >
      {children}
    </span>
  );
}
