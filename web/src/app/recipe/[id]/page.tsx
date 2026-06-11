import { notFound } from "next/navigation";
import { getRecipe } from "@/lib/queries";
import type { IngredientWithPantry } from "@/lib/types";
import { CopyMissingButton } from "./copy-missing-button";
import { BackToRecipes } from "../../_back-link";

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

  const counted = ingredients.filter((i) => !i.is_assumed_staple);
  const missing = counted.filter((i) => !i.in_pantry);

  const meta: { label: string; value: string }[] = [];
  if (recipe.author) meta.push({ label: "Author", value: recipe.author });
  if (recipe.yield) meta.push({ label: "Yield", value: recipe.yield });
  if (recipe.prep_time) meta.push({ label: "Prep time", value: recipe.prep_time });
  if (recipe.cook_time) meta.push({ label: "Cook time", value: recipe.cook_time });
  if (recipe.total_time) meta.push({ label: "Total time", value: recipe.total_time });

  return (
    <article className="space-y-8">
      <BackToRecipes />

      <header className="space-y-4 -mt-4">
        <h1 className="font-display uppercase text-3xl sm:text-4xl leading-[0.95] text-foreground">
          {recipe.title}
        </h1>

        <div className="flex flex-wrap gap-1.5">
          {recipe.is_family_recipe && <Pill variant="family">Family</Pill>}
          {recipe.is_favorite && <Pill variant="solid">★ favorite</Pill>}
          {recipe.holiday && <Pill>{recipe.holiday}</Pill>}
          {recipe.season && <Pill>{recipe.season}</Pill>}
          {recipe.course && <Pill>{recipe.course}</Pill>}
          {recipe.cuisine && <Pill>{recipe.cuisine}</Pill>}
          {(recipe.tags ?? []).map((t) => (
            <Pill key={t}>{t}</Pill>
          ))}
          {recipe.extraction_confidence === "needs_review" && (
            <Pill variant="warn">needs review</Pill>
          )}
        </div>

        {meta.length > 0 && (
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 border-t border-border pt-4">
            {meta.map((m) => (
              <div key={m.label}>
                <dt className="label-mono mb-1">{m.label}</dt>
                <dd className="text-sm text-foreground">{m.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {recipe.source_url && (
          <div className="text-sm">
            <span className="label-mono mr-2">Source</span>
            <a
              href={recipe.source_url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary underline underline-offset-4 decoration-primary/40 hover:decoration-primary break-all"
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
              className="w-full rounded-md border border-border bg-card object-contain max-h-[600px]"
            />
          ))}
        </div>
      )}

      <section className="space-y-4">
        <header className="border-t border-border pt-3 flex flex-wrap items-end justify-between gap-3">
          <div className="font-mono uppercase tracking-wider text-sm font-bold text-secondary">
            Ingredients
          </div>
          {hasPantry && missing.length > 0 && (
            <CopyMissingButton missing={missing.map((m) => m.name)} />
          )}
        </header>

        {ingredients.length === 0 ? (
          <p className="text-muted-foreground text-sm">No ingredients recorded.</p>
        ) : (
          <div className="space-y-5">
            {categoryOrder.filter((c) => grouped[c]).map((category) => (
              <div key={category}>
                <div className="label-mono mb-2">
                  {category.replace(/_/g, " ")}
                </div>
                <ul className="space-y-1.5 text-base">
                  {grouped[category].map((ing) => {
                    const checked = hasPantry && ing.in_pantry;
                    const measure = [ing.amount, ing.unit].filter(Boolean).join(" ");
                    return (
                      <li
                        key={ing.id}
                        className={`flex gap-2 items-baseline ${checked ? "text-muted-foreground" : "text-foreground"}`}
                      >
                        {hasPantry && (
                          <span
                            className={`w-4 shrink-0 select-none ${
                              ing.in_pantry ? "text-secondary" : "text-muted-foreground/40"
                            }`}
                            aria-label={ing.in_pantry ? "have it" : "missing"}
                          >
                            {ing.in_pantry ? "✓" : "○"}
                          </span>
                        )}
                        <span
                          className={`flex-1 min-w-0 ${checked ? "font-normal" : "font-medium"}`}
                        >
                          {measure && (
                            <span className="tabular-nums">
                              {measure}{" "}
                            </span>
                          )}
                          {ing.name}
                          {ing.prep_note && (
                            <span className="text-muted-foreground">
                              {" "}
                              ({ing.prep_note})
                            </span>
                          )}
                        </span>
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
        <section className="space-y-4">
          <header className="border-t border-border pt-3">
            <div className="font-mono uppercase tracking-wider text-sm font-bold text-secondary">
              Instructions
            </div>
          </header>
          <ol className="list-decimal list-outside ml-5 space-y-3 text-base leading-relaxed marker:text-muted-foreground marker:font-mono">
            {recipe.instructions.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </section>
      )}

      {recipe.my_notes && (
        <section className="space-y-3">
          <header className="border-t border-border pt-3">
            <div className="font-mono uppercase tracking-wider text-sm font-bold text-secondary">
              My notes
            </div>
          </header>
          <div className="rounded-md border border-border bg-card p-4 whitespace-pre-wrap text-sm">
            {recipe.my_notes}
          </div>
        </section>
      )}
    </article>
  );
}

function Pill({
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
      ? "border-secondary text-secondary"
      : variant === "warn"
      ? "border-destructive text-destructive"
      : "border-border text-muted-foreground";
  return (
    <span
      className={`rounded-full border px-2.5 py-0.5 font-mono text-[0.7rem] uppercase tracking-wider ${cls}`}
    >
      {children}
    </span>
  );
}
