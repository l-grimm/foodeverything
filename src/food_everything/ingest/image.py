"""Recipe images on a webpage → recipes + recipe_ingredients rows.

For pages where the recipe content lives in images (screenshots of cookbook
pages, photographed handwritten cards, etc.) rather than typed-out article
text. Sends all substantive images on the page to GPT-4o Vision in a single
multimodal call.

Usage:
    uv run python -m food_everything.ingest.image <url>
"""

import sys
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

from food_everything.config import openai_client, supabase_client
from food_everything.ingest.substack import SYSTEM_PROMPT, ExtractedRecipe


def detect_platform(url: str) -> str:
    host = urlparse(url).hostname or ""
    if "substack.com" in host:
        return "substack"
    if "tiktok.com" in host:
        return "tiktok"
    if "instagram.com" in host:
        return "instagram"
    return "url"


def fetch_image_urls(url: str) -> list[str]:
    """Find substantive image URLs in an article. Skips Substack avatars/icons."""
    resp = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=15)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    article = soup.find("article") or soup
    images: list[str] = []
    seen: set[str] = set()
    for img in article.find_all("img"):
        src = img.get("src") or img.get("data-src")
        if not src or src in seen:
            continue
        # Substack avatars/thumbnails embed dimension hints in the URL.
        if "w_36" in src or "w_72" in src or "w_140" in src:
            continue
        seen.add(src)
        images.append(src)
    return images


def extract_recipe_from_images(image_urls: list[str]) -> ExtractedRecipe:
    client = openai_client()
    user_content: list[dict] = [
        {
            "type": "text",
            "text": (
                "Extract the recipe shown in these images. Some images may be "
                "decorative or unrelated (author photos, ingredient close-ups, "
                "scenery); focus on whichever contain recipe content. If a "
                "recipe spans multiple image pages, combine them."
            ),
        }
    ]
    for img_url in image_urls:
        user_content.append({"type": "image_url", "image_url": {"url": img_url}})

    response = client.beta.chat.completions.parse(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        response_format=ExtractedRecipe,
    )
    return response.choices[0].message.parsed


def write_to_supabase(
    recipe: ExtractedRecipe, url: str, platform: str, image_urls: list[str]
) -> str:
    sb = supabase_client()
    recipe_row = {
        "title": recipe.title,
        "source_url": url,
        "source_platform": platform,
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
        "raw_text": "[IMAGE_BASED_EXTRACTION]\n" + "\n".join(image_urls),
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
    platform = detect_platform(url)
    print(f"Fetching {url} (platform: {platform})", file=sys.stderr)
    image_urls = fetch_image_urls(url)
    print(f"Found {len(image_urls)} substantive images", file=sys.stderr)
    if not image_urls:
        print("No images found in article — aborting", file=sys.stderr)
        sys.exit(1)
    print("Calling GPT-4o Vision for extraction...", file=sys.stderr)
    recipe = extract_recipe_from_images(image_urls)
    print(
        f"Extracted: {recipe.title!r} "
        f"({len(recipe.ingredients)} ingredients, "
        f"{recipe.extraction_confidence} confidence)",
        file=sys.stderr,
    )
    recipe_id = write_to_supabase(recipe, url, platform, image_urls)
    print(f"Wrote recipe {recipe_id}", file=sys.stderr)
    return recipe_id


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: python -m food_everything.ingest.image <url>", file=sys.stderr)
        sys.exit(1)
    ingest(sys.argv[1])
