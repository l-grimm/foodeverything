import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getRecipe } from "@/lib/queries";
import type { IngredientWithPantry } from "@/lib/types";
import { CopyMissingButton } from "./copy-missing-button";

export default async function RecipeDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { recipe, ingredients, hasPantry } = await getRecipe(id);
  if (!recipe) notFound();

  const grouped = ingredients.reduce<Record<string, IngredientWithPantry[]>>(
    (acc, ing) => {
      const key = ing.category ?? "other";
      (acc[key] = acc[key] ?? []).push(ing);
      return acc;
    },
    {},
  );

  const categoryOrder = [
    "produce", "protein", "dairy", "grain", "pantry_staple", "other",
  ];

  // Staples are excluded from counts and from the missing list entirely.
  const counted = ingredients.filter((i) => !i.is_assumed_staple);
  const missing = counted.filter((i) => !i.in_pantry);
  const haveCount = counted.length - missing.length;

  return (
    <article className="space-y-6">
      <Link href="/" className="text-sm text-muted-foreground hover:underline">
        ← All recipes
      </Link>

      <header className="space-y-3">
        <h1 className="text-2xl sm:text-3xl font-semibold leading-tight">
          {recipe.title}
        </h1>
        {recipe.author && (
          <div className="text-muted-foreground">by {recipe.author}</div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {recipe.is_family_recipe && <Badge variant="secondary">family</Badge>}
          {recipe.is_favorite && <Badge variant="default">★ favorite</Badge>}
          {recipe.holiday && <Badge variant="outline">{recipe.holiday}</Badge>}
          {recipe.season && <Badge variant="outline">{recipe.season}</Badge>}
          {recipe.course && <Badge variant="outline">{recipe.course}</Badge>}
          {recipe.cuisine && <Badge variant="outline">{recipe.cuisine}</Badge>}
          {(recipe.tags ?? []).map((t) => (
            <Badge key={t} variant="outline">{t}</Badge>
          ))}
          {recipe.extraction_confidence === "needs_review" && (
            <Badge variant="destructive">needs review</Badge>
          )}
        </div>

        {(recipe.yield || recipe.prep_time || recipe.cook_time || recipe.total_time) && (
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
            {recipe.yield && <span><b className="text-foreground">Yield:</b> {recipe.yield}</span>}
            {recipe.prep_time && <span><b className="text-foreground">Prep:</b> {recipe.prep_time}</span>}
            {recipe.cook_time && <span><b className="text-foreground">Cook:</b> {recipe.cook_time}</span>}
            {recipe.total_time && <span><b className="text-foreground">Total:</b> {recipe.total_time}</span>}
          </div>
        )}

        {recipe.source_url && (
          <div className="text-sm">
            <span className="text-muted-foreground">Source: </span>
            <a
              href={recipe.source_url}
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2 hover:text-primary break-all"
            >
              {recipe.source_url}
            </a>
          </div>
        )}
      </header>

      {recipe.image_urls && recipe.image_urls.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {recipe.image_urls.map((url) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={url}
              src={url}
              alt={recipe.title}
              className="w-full rounded-md border bg-muted object-contain max-h-[600px]"
            />
          ))}
        </div>
      )}

      <Separator />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold">Ingredients</h2>
          {hasPantry && counted.length > 0 && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground tabular-nums">
                You have {haveCount} of {counted.length}
              </span>
              {missing.length > 0 && (
                <CopyMissingButton missing={missing.map((m) => m.name)} />
              )}
            </div>
          )}
        </div>
        {ingredients.length === 0 ? (
          <p className="text-muted-foreground text-sm">No ingredients recorded.</p>
        ) : (
          <div className="space-y-4">
            {categoryOrder.filter((c) => grouped[c]).map((category) => (
              <div key={category}>
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                  {category.replace(/_/g, " ")}
                </div>
                <ul className="space-y-1 text-base">
                  {grouped[category].map((ing) => {
                    // Staples (salt/oil/pepper/water) always show ✓ — they're
                    // assumed present — but the count logic above still skips
                    // them via is_assumed_staple. Dim only non-staple have-its
                    // so missing items pop without making salt/water fade.
                    const dim = hasPantry && !ing.is_assumed_staple && ing.in_pantry;
                    return (
                      <li
                        key={ing.id}
                        className={`flex gap-2 ${dim ? "text-muted-foreground" : ""}`}
                      >
                        {hasPantry && (
                          <span
                            className={`w-4 shrink-0 select-none ${
                              ing.in_pantry ? "text-emerald-600" : "text-muted-foreground/40"
                            }`}
                            aria-label={ing.in_pantry ? "have it" : "missing"}
                          >
                            {ing.in_pantry ? "✓" : "○"}
                          </span>
                        )}
                        <span className="font-medium tabular-nums">
                          {[ing.amount, ing.unit].filter(Boolean).join(" ")}
                        </span>
                        <span>{ing.name}</span>
                        {ing.prep_note && (
                          <span className="text-muted-foreground">({ing.prep_note})</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {recipe.instructions && recipe.instructions.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Instructions</h2>
          <ol className="list-decimal list-outside ml-5 space-y-3 text-base leading-relaxed">
            {recipe.instructions.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </section>
      )}

      {recipe.my_notes && (
        <section className="space-y-2">
          <h2 className="text-xl font-semibold">My notes</h2>
          <div className="rounded-md border bg-muted/40 p-3 whitespace-pre-wrap text-sm">
            {recipe.my_notes}
          </div>
        </section>
      )}
    </article>
  );
}
