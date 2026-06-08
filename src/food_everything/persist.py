"""Shared persistence layer for ingested recipes.

All ingester pipelines (text, vision, email-body) construct the same
ExtractedRecipe and write the same recipes + recipe_ingredients rows;
this module centralizes that to avoid drift across ingesters.
"""

import sys
from typing import Any, Optional

from food_everything.config import supabase_client
from food_everything.ingest.substack import ExtractedRecipe


def _strip_nulls(obj: Any) -> Any:
    """Remove characters Postgres text columns refuse — namely the NUL
    character (and the literal "\\u0000" text it can serialize to when JSON
    round-trips through PostgREST). NYT Cooking JSON-LD blobs occasionally
    contain these; without sanitization the insert fails with SQLSTATE 22P05.
    Recurses through dicts and lists so every nested string is cleaned.
    """
    if isinstance(obj, str):
        return obj.replace("\x00", "").replace("\\u0000", "")
    if isinstance(obj, list):
        return [_strip_nulls(x) for x in obj]
    if isinstance(obj, dict):
        return {k: _strip_nulls(v) for k, v in obj.items()}
    return obj


def write_recipe(
    recipe: ExtractedRecipe,
    *,
    source_url: Optional[str],
    source_platform: str,
    raw_text: str,
) -> str:
    """Insert a recipe + its ingredients. Returns the new recipe id.

    Raises ValueError when the extraction produced zero ingredients — a
    recipe without ingredients is almost always a degenerate parse (e.g. a
    newsletter teaser where the LLM grabbed the title but no recipe content
    was available). Better to surface this as a failure in
    email_ingestions.error than to write misleading high-confidence stubs.
    """
    if not recipe.ingredients:
        raise ValueError(
            f"refusing to write recipe with 0 ingredients "
            f"(title={recipe.title!r}); extraction is likely incomplete"
        )
    sb = supabase_client()
    recipe_row = {
        "title": recipe.title,
        "source_url": source_url,
        "source_platform": source_platform,
        "author": recipe.author,
        "yield": recipe.recipe_yield,
        "prep_time": recipe.prep_time,
        "cook_time": recipe.cook_time,
        "total_time": recipe.total_time,
        "cuisine": recipe.cuisine,
        "course": recipe.course,
        "holiday": recipe.holiday,
        "season": recipe.season,
        "my_notes": recipe.my_notes,
        "instructions": recipe.instructions,
        "tags": recipe.tags,
        "extraction_confidence": recipe.extraction_confidence,
        "raw_text": raw_text,
        # processing_status omitted: DB default 'approved' applies. User opted
        # out of the human-review workflow given expected ingestion volume.
    }
    result = sb.table("recipes").insert(_strip_nulls(recipe_row)).execute()
    recipe_id = result.data[0]["id"]

    if recipe.ingredients:
        sb.table("recipe_ingredients").insert(
            _strip_nulls(
                [
                    {
                        "recipe_id": recipe_id,
                        "name": ing.name,
                        "name_raw": ing.name_raw,
                        "amount": ing.amount,
                        "unit": ing.unit,
                        "prep_note": ing.prep_note,
                        "category": ing.category,
                    }
                    for ing in recipe.ingredients
                ]
            )
        ).execute()
        _populate_canonical_cache(sb, [ing.name for ing in recipe.ingredients])

    return recipe_id


def _populate_canonical_cache(sb, raw_names: list[str]) -> None:
    """Fire-and-forget canonicalize for the newly-inserted ingredient names.

    Best-effort: the recipe is already written; if the LLM call fails we
    just leave those names without a cache entry and recipe_coverage will
    fall back to normalize_ingredient() at query time.
    """
    try:
        from food_everything.canonicalize import canonicalize_many

        canonicalize_many(raw_names, sb=sb)
    except Exception as e:  # pragma: no cover - best-effort
        print(f"canonicalize_many failed (non-fatal): {e}", file=sys.stderr)
