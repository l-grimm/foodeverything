"""Shared persistence layer for ingested recipes.

All ingester pipelines (text, vision, email-body) construct the same
ExtractedRecipe and write the same recipes + recipe_ingredients rows;
this module centralizes that to avoid drift across ingesters.
"""

from typing import Optional

from food_everything.config import supabase_client
from food_everything.ingest.substack import ExtractedRecipe


def write_recipe(
    recipe: ExtractedRecipe,
    *,
    source_url: Optional[str],
    source_platform: str,
    raw_text: str,
) -> str:
    """Insert a recipe + its ingredients. Returns the new recipe id."""
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
        "instructions": recipe.instructions,
        "tags": recipe.tags,
        "extraction_confidence": recipe.extraction_confidence,
        "raw_text": raw_text,
        # processing_status omitted: DB default 'approved' applies. User opted
        # out of the human-review workflow given expected ingestion volume.
    }
    result = sb.table("recipes").insert(recipe_row).execute()
    recipe_id = result.data[0]["id"]

    if recipe.ingredients:
        sb.table("recipe_ingredients").insert(
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
        ).execute()

    return recipe_id
