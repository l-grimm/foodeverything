"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { IngredientCategory, Recipe, RecipeIngredient } from "@/lib/types";
import { deleteRecipe, updateRecipe, type IngredientEditDraft } from "./actions";

const CATEGORIES: IngredientCategory[] = [
  "produce",
  "protein",
  "dairy",
  "grain",
  "pantry_staple",
  "other",
];

type IngredientRow = IngredientEditDraft & { _key: string };

let clientKeySeq = 0;
const nextKey = () => `new-${++clientKeySeq}`;

function toRow(ing: RecipeIngredient): IngredientRow {
  return {
    id: ing.id,
    name: ing.name,
    amount: ing.amount,
    unit: ing.unit,
    prep_note: ing.prep_note,
    category: ing.category,
    _key: ing.id,
  };
}

function emptyRow(category: IngredientCategory | null = null): IngredientRow {
  return {
    id: null,
    name: "",
    amount: null,
    unit: null,
    prep_note: null,
    category,
    _key: nextKey(),
  };
}

const labelMono = "font-mono uppercase tracking-wider text-xs text-muted-foreground";
const inputCls =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary";

export function RecipeEditForm({
  recipe,
  ingredients,
  onCancel,
  onSaved,
}: {
  recipe: Recipe;
  ingredients: RecipeIngredient[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(recipe.title);
  const [tags, setTags] = useState<string[]>(recipe.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");
  const [instructions, setInstructions] = useState<string[]>(
    recipe.instructions && recipe.instructions.length > 0
      ? recipe.instructions
      : [""],
  );
  const [rows, setRows] = useState<IngredientRow[]>(ingredients.map(toRow));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [deleting, startDeleteTransition] = useTransition();
  const router = useRouter();

  function updateRow(key: string, patch: Partial<IngredientRow>) {
    setRows((prev) =>
      prev.map((r) => (r._key === key ? { ...r, ...patch } : r)),
    );
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r._key !== key));
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()]);
  }

  function updateStep(idx: number, value: string) {
    setInstructions((prev) => prev.map((s, i) => (i === idx ? value : s)));
  }

  function removeStep(idx: number) {
    setInstructions((prev) => prev.filter((_, i) => i !== idx));
  }

  function addStep() {
    setInstructions((prev) => [...prev, ""]);
  }

  function addTagFromDraft() {
    const t = tagDraft.trim();
    if (!t) return;
    if (!tags.includes(t)) setTags([...tags, t]);
    setTagDraft("");
  }

  function removeTag(t: string) {
    setTags(tags.filter((x) => x !== t));
  }

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await updateRecipe(recipe.id, {
          title,
          tags,
          instructions,
          ingredients: rows.map((r) => ({
            id: r.id,
            name: r.name,
            amount: r.amount,
            unit: r.unit,
            prep_note: r.prep_note,
            category: r.category,
          })),
        });
        onSaved();
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "Save failed. Try again.";
        setError(msg);
      }
    });
  }

  function confirmDelete() {
    if (typeof window === "undefined") return;
    const ok = window.confirm(
      `Delete "${recipe.title}"? This can't be undone.`,
    );
    if (!ok) return;
    setError(null);
    startDeleteTransition(async () => {
      try {
        await deleteRecipe(recipe.id);
        // Replace so the recipe URL doesn't sit in history; back-button
        // shouldn't return to a 404'd page.
        router.replace("/");
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "Delete failed. Try again.";
        setError(msg);
      }
    });
  }

  return (
    <article className="space-y-8">
      <ActionBar
        onCancel={onCancel}
        onSave={save}
        pending={pending}
        error={error}
      />

      <section className="space-y-2">
        <label className={labelMono}>Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={inputCls}
        />
      </section>

      <section className="space-y-3">
        <header className="border-t border-border pt-3 flex items-end justify-between">
          <div className="font-mono uppercase tracking-wider text-sm font-bold text-secondary">
            Ingredients
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={addRow}
            className="font-mono uppercase tracking-wider text-[0.7rem]"
          >
            + Add ingredient
          </Button>
        </header>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No ingredients. Tap “Add ingredient” to add one.
          </p>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li
                key={r._key}
                className="rounded-md border border-border bg-card p-3 space-y-2"
              >
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="ingredient name"
                    value={r.name}
                    onChange={(e) =>
                      updateRow(r._key, { name: e.target.value })
                    }
                    className={`${inputCls} flex-1`}
                  />
                  <button
                    type="button"
                    onClick={() => removeRow(r._key)}
                    aria-label="Remove ingredient"
                    className="rounded-md border border-border px-2 text-muted-foreground hover:text-destructive hover:border-destructive"
                  >
                    ×
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <input
                    type="text"
                    placeholder="amount"
                    value={r.amount ?? ""}
                    onChange={(e) =>
                      updateRow(r._key, { amount: e.target.value })
                    }
                    className={inputCls}
                  />
                  <input
                    type="text"
                    placeholder="unit"
                    value={r.unit ?? ""}
                    onChange={(e) =>
                      updateRow(r._key, { unit: e.target.value })
                    }
                    className={inputCls}
                  />
                  <input
                    type="text"
                    placeholder="prep (chopped, etc)"
                    value={r.prep_note ?? ""}
                    onChange={(e) =>
                      updateRow(r._key, { prep_note: e.target.value })
                    }
                    className={`${inputCls} col-span-2 sm:col-span-1`}
                  />
                  <select
                    value={r.category ?? ""}
                    onChange={(e) =>
                      updateRow(r._key, {
                        category: (e.target.value || null) as IngredientCategory | null,
                      })
                    }
                    className={inputCls}
                  >
                    <option value="">category…</option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <header className="border-t border-border pt-3 flex items-end justify-between">
          <div className="font-mono uppercase tracking-wider text-sm font-bold text-secondary">
            Instructions
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={addStep}
            className="font-mono uppercase tracking-wider text-[0.7rem]"
          >
            + Add step
          </Button>
        </header>

        <ol className="space-y-3">
          {instructions.map((step, idx) => (
            <li key={idx} className="flex gap-3 items-start">
              <div className="font-mono text-sm text-muted-foreground pt-2 w-6 shrink-0 text-right">
                {idx + 1}.
              </div>
              <textarea
                value={step}
                rows={2}
                onChange={(e) => updateStep(idx, e.target.value)}
                className={`${inputCls} flex-1 resize-y`}
              />
              <button
                type="button"
                onClick={() => removeStep(idx)}
                aria-label="Remove step"
                className="rounded-md border border-border px-2 py-1 text-muted-foreground hover:text-destructive hover:border-destructive"
              >
                ×
              </button>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-3">
        <header className="border-t border-border pt-3">
          <div className="font-mono uppercase tracking-wider text-sm font-bold text-secondary">
            Tags
          </div>
        </header>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => removeTag(t)}
                className="rounded-full border border-primary text-primary px-2.5 py-0.5 font-mono text-[0.7rem] uppercase tracking-wider hover:bg-destructive/10 hover:text-destructive hover:border-destructive transition"
              >
                {t} ×
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <input
            type="text"
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTagFromDraft();
              }
            }}
            placeholder="add a tag, hit Enter"
            className={`${inputCls} flex-1`}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={addTagFromDraft}
            className="font-mono uppercase tracking-wider text-[0.7rem]"
            disabled={tagDraft.trim().length === 0}
          >
            Add
          </Button>
        </div>
      </section>

      <ActionBar
        onCancel={onCancel}
        onSave={save}
        pending={pending}
        error={error}
      />

      <section className="border-t border-border pt-6 flex justify-start">
        <Button
          type="button"
          variant="outline"
          onClick={confirmDelete}
          disabled={deleting || pending}
          className="font-mono uppercase tracking-wider text-[0.7rem] border-destructive text-destructive hover:bg-destructive/10"
        >
          {deleting ? "Deleting…" : "Delete recipe"}
        </Button>
      </section>
    </article>
  );
}

function ActionBar({
  onCancel,
  onSave,
  pending,
  error,
}: {
  onCancel: () => void;
  onSave: () => void;
  pending: boolean;
  error: string | null;
}) {
  return (
    <div className="space-y-2">
      <div className="flex gap-2 justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={pending}
          className="font-mono uppercase tracking-wider text-[0.7rem]"
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={onSave}
          disabled={pending}
          className="bg-primary text-primary-foreground hover:bg-primary/90 font-mono uppercase tracking-wider text-[0.7rem]"
        >
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      {error && (
        <p className="text-sm text-destructive text-right">{error}</p>
      )}
    </div>
  );
}
