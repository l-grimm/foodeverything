"""Substack/web article → recipes + recipe_ingredients rows.

Usage:
    uv run python -m food_everything.ingest.substack <url>
"""

import sys
from typing import Literal, Optional

import requests
from bs4 import BeautifulSoup
from pydantic import BaseModel, Field

from food_everything.config import openai_client, supabase_client

SYSTEM_PROMPT = """You extract structured recipes from article text.

The article may be primarily storytelling with a recipe embedded, or it may be a pure recipe.
Extract only the actual recipe content; ignore storytelling, anecdotes, and commentary.

For each ingredient, separate:
- name: the canonical ingredient (e.g., "butter", "all-purpose flour")
- name_raw: the verbatim text from the recipe (e.g., "unsalted butter, room temperature")
- amount: numeric quantity as a string (e.g., "1", "1/2", "2-3"); null if not given
- unit: e.g., "tbsp", "cup", "g"; null if no unit
- prep_note: e.g., "chopped", "room temperature"; null if none
- category: must be exactly one of: produce, dairy, protein, grain, pantry_staple, other

Set extraction_confidence to:
- "high" if the article had a clean, complete recipe you could parse confidently
- "needs_review" if you had to interpolate, fields were missing, or anything was ambiguous
"""


class ExtractedIngredient(BaseModel):
    name: str
    name_raw: Optional[str] = None
    amount: Optional[str] = None
    unit: Optional[str] = None
    prep_note: Optional[str] = None
    category: Optional[str] = None


class ExtractedRecipe(BaseModel):
    title: str
    author: Optional[str] = None
    recipe_yield: Optional[str] = None  # maps to `yield` column (reserved word in Python)
    prep_time: Optional[str] = None
    cook_time: Optional[str] = None
    total_time: Optional[str] = None
    cuisine: Optional[str] = None
    course: Optional[str] = None
    holiday: Optional[str] = None
    season: Optional[str] = None
    instructions: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    ingredients: list[ExtractedIngredient] = Field(default_factory=list)
    extraction_confidence: Literal["high", "needs_review"]


def fetch_article(url: str) -> str:
    resp = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=15)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    article = soup.find("article")
    if article:
        for tag in article.select(".subscribe, footer, nav"):
            tag.decompose()
        return article.get_text(separator="\n\n").strip()
    for tag in soup.select("script, style, nav, header, footer, noscript"):
        tag.decompose()
    main = soup.select_one("main") or soup.select_one('[role="main"]') or soup.body
    return main.get_text(separator="\n\n").strip()


def extract_recipe(article_text: str) -> ExtractedRecipe:
    client = openai_client()
    response = client.beta.chat.completions.parse(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": article_text},
        ],
        response_format=ExtractedRecipe,
    )
    return response.choices[0].message.parsed


def write_to_supabase(recipe: ExtractedRecipe, url: str, raw_text: str) -> str:
    sb = supabase_client()
    recipe_row = {
        "title": recipe.title,
        "source_url": url,
        "source_platform": "substack",
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
        # TODO: processing_status has a CHECK constraint; allowed values unknown.
        # Leaving NULL until we query the constraint definition from Supabase.
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


def ingest(url: str) -> str:
    print(f"Fetching {url}", file=sys.stderr)
    article = fetch_article(url)
    print(f"Got {len(article)} chars of article text", file=sys.stderr)
    print("Calling GPT-4o for extraction...", file=sys.stderr)
    recipe = extract_recipe(article)
    print(
        f"Extracted: {recipe.title!r} "
        f"({len(recipe.ingredients)} ingredients, "
        f"{recipe.extraction_confidence} confidence)",
        file=sys.stderr,
    )
    recipe_id = write_to_supabase(recipe, url, article)
    print(f"Wrote recipe {recipe_id}", file=sys.stderr)
    return recipe_id


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: python -m food_everything.ingest.substack <url>", file=sys.stderr)
        sys.exit(1)
    ingest(sys.argv[1])
