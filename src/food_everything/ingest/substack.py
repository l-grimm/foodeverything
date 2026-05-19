"""Substack/web article → recipes + recipe_ingredients rows.

Prefers `schema.org/Recipe` JSON-LD when the page provides it (most recipe
sites publish this for Google rich-results SEO — far more reliable than
scraping HTML article text). Falls back to article-text scraping when no
JSON-LD is present. Refuses extraction (raises) when both yield too little
content, to avoid GPT hallucinating a recipe from a near-empty input.

Usage:
    uv run python -m food_everything.ingest.substack <url>
"""

import json
import sys
from typing import Literal, Optional

import requests
from bs4 import BeautifulSoup
from pydantic import BaseModel, Field

from food_everything.config import openai_client

MIN_INPUT_LENGTH = 500  # below this with no JSON-LD, refuse (anti-hallucination)

SYSTEM_PROMPT = """You extract structured recipes from article text.

The article may be primarily storytelling with a recipe embedded, or it may be a pure recipe.
Extract only the actual recipe content; ignore storytelling, anecdotes, and commentary.

STANDARD FIELDS — always extract these when present in the article:
- title: the recipe's name
- author: who wrote or created the recipe (often the article author)
- cuisine: e.g. "Italian", "Chinese", "Mexican" when clear; NULL when ambiguous
- recipe_yield: serving size or yield as stated ("2 servings", "1 loaf", "2 dozen")
- instructions: each step as a separate string in the array

INGREDIENTS — for each, separate:
- name: canonical ingredient ("butter", "all-purpose flour")
- name_raw: verbatim text from the recipe
- amount: numeric quantity as a string ("1", "1/2", "2-3"); null if not given
- unit: e.g. "tbsp", "cup", "g"; null if no unit
- prep_note: e.g. "chopped", "fresh", "canned"; null if none
- category: exactly one of: produce, dairy, protein, grain, pantry_staple, other

TIME FIELDS (prep_time, cook_time, total_time):
Only fill these if the recipe states them VERBATIM (e.g. "Prep: 15 min").
Do NOT estimate or infer from instructions. Leave NULL otherwise.

COURSE: one of breakfast, lunch, dinner, appetizer, side, dessert, snack, drink.
Only set when clear from the recipe. NULL when ambiguous.

TAGS: 0 to 4 short free-text labels useful for filtering, e.g. "weeknight",
"one-pot", "make-ahead", "vegan", "gluten-free". Only confidently-true tags.
Do not pad.

HOLIDAY: NULL unless the article text EXPLICITLY associates the recipe with a
holiday ("for Thanksgiving", "Christmas Eve tradition", "Passover seder",
"Easter brunch", etc.). Do NOT infer from celebratory tone or seasonal vibes.

SEASON: derive from FRESH local seasonal ingredients (Northeast US growing seasons).
- spring: ramps, asparagus, fiddleheads, peas, rhubarb, strawberries, morels
- summer: tomatoes, corn, zucchini, summer squash, stone fruit, berries, basil,
  cucumbers, eggplant, peppers
- fall: winter squash (butternut, kabocha, delicata), apples, pears, brussels
  sprouts, root vegetables, cranberries
- winter: hardy greens (kale, collards), citrus, persimmons

CRITICAL: only FRESH forms count. Canned, jarred, dried, frozen, or preserved
versions carry NO seasonal signal — check name_raw and prep_note for those words.
If ingredients span multiple seasons, set season=NULL. Do NOT infer season from
article-text vibes when ingredients don't support it.

EXTRACTION_CONFIDENCE:
- "high" — clean, complete recipe parsed confidently
- "needs_review" — interpolation, missing fields, or anything ambiguous
"""


class ExtractedIngredient(BaseModel):
    name: str
    name_raw: Optional[str] = None
    amount: Optional[str] = None
    unit: Optional[str] = None
    prep_note: Optional[str] = None
    category: Optional[
        Literal["produce", "dairy", "protein", "grain", "pantry_staple", "other"]
    ] = None


class ExtractedRecipe(BaseModel):
    title: str
    author: Optional[str] = None
    recipe_yield: Optional[str] = None  # maps to `yield` column (reserved word in Python)
    prep_time: Optional[str] = None
    cook_time: Optional[str] = None
    total_time: Optional[str] = None
    cuisine: Optional[str] = None
    course: Optional[
        Literal["breakfast", "lunch", "dinner", "appetizer", "side", "dessert", "snack", "drink"]
    ] = None
    holiday: Optional[str] = None
    season: Optional[Literal["spring", "summer", "fall", "winter"]] = None
    my_notes: Optional[str] = None  # populated by family-recipe OCR for margin annotations; null otherwise
    instructions: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    ingredients: list[ExtractedIngredient] = Field(default_factory=list)
    extraction_confidence: Literal["high", "needs_review"]


def find_jsonld_recipe(soup: BeautifulSoup) -> Optional[dict]:
    """Find a schema.org/Recipe JSON-LD object in the page, if present.

    JSON-LD can appear as a single dict, a list of dicts, or wrapped inside an
    @graph array. @type may be a string or a list. Handle all three.
    """
    for script in soup.find_all("script", type="application/ld+json"):
        if not script.string:
            continue
        try:
            data = json.loads(script.string)
        except json.JSONDecodeError:
            continue
        candidates: list = []
        if isinstance(data, list):
            candidates = data
        elif isinstance(data, dict):
            candidates = [data] + (data.get("@graph") or [])
        for c in candidates:
            if not isinstance(c, dict):
                continue
            t = c.get("@type")
            if t == "Recipe" or (isinstance(t, list) and "Recipe" in t):
                return c
    return None


def _extract_article_text(soup: BeautifulSoup) -> str:
    """Pull readable article text from a page (fallback when no JSON-LD)."""
    article = soup.find("article")
    if article:
        for tag in article.select(".subscribe, footer, nav"):
            tag.decompose()
        return article.get_text(separator="\n\n").strip()
    for tag in soup.select("script, style, nav, header, footer, noscript"):
        tag.decompose()
    main = soup.select_one("main") or soup.select_one('[role="main"]') or soup.body
    if main is None:
        return soup.get_text(separator="\n\n").strip()
    return main.get_text(separator="\n\n").strip()


def fetch_article(url: str) -> str:
    """Fetch a recipe page and return the best input for GPT extraction.

    Prefers schema.org/Recipe JSON-LD (returns it as pretty-printed JSON) when
    present. Falls back to article-text scraping. Raises ValueError when
    neither yields enough content (anti-hallucination guard — GPT will
    confabulate recipes from near-empty input).
    """
    resp = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=15)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    jsonld = find_jsonld_recipe(soup)
    if jsonld:
        return json.dumps(jsonld, indent=2)

    text = _extract_article_text(soup)
    if len(text) < MIN_INPUT_LENGTH:
        raise ValueError(
            f"page has no JSON-LD recipe and only {len(text)} chars of article "
            f"text (min {MIN_INPUT_LENGTH}); refusing to extract"
        )
    return text


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
    message = response.choices[0].message
    if message.refusal:
        raise ValueError(f"GPT refused extraction: {message.refusal}")
    if message.parsed is None:
        raise ValueError("GPT did not return a parsed recipe (article may not contain one)")
    return message.parsed


def write_to_supabase(recipe: ExtractedRecipe, url: str, raw_text: str) -> str:
    from food_everything.persist import write_recipe

    return write_recipe(
        recipe, source_url=url, source_platform="substack", raw_text=raw_text
    )


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
