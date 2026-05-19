"""Instagram URL -> recipes + recipe_ingredients rows.

Instagram serves OG (Open Graph) meta tags to crawler user-agents
(facebookexternalhit, Googlebot, Twitterbot, mobile Safari, etc.) for
public posts/reels. The `og:description` contains the full caption — for
recipe accounts, that's often the entire recipe including ingredient list
and instructions. No login or API key needed.

Important limitations:
- Browser-style user-agents get a JS shell with no usable content. We must
  identify as a crawler.
- Private posts return nothing useful.
- Comments are NOT accessible (unlike TikTok). Recipes-in-comments on
  Instagram are unreachable without auth.

CLI usage:
    uv run python -m food_everything.ingest.instagram https://www.instagram.com/reels/XXX/
"""

import sys
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

from food_everything.config import supabase_client
from food_everything.ingest.substack import extract_recipe
from food_everything.persist import write_recipe

# Crawler UA — Instagram returns the JS shell to browser UAs but a real
# server-rendered page (with OG tags) to known crawlers.
CRAWLER_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"


def canonical_url(url: str) -> str:
    """Strip query params + trailing slash so the same reel saved with
    different tracking variants dedupes."""
    p = urlparse(url)
    return f"{p.scheme}://{p.netloc}{p.path}".rstrip("/")


def fetch_caption(url: str) -> str:
    """Pull og:description (= post caption) from Instagram.

    Raises ValueError if the OG tag is missing — typically means the post
    is private, deleted, or Instagram changed their crawler-serving logic.
    """
    resp = requests.get(
        url,
        headers={"User-Agent": CRAWLER_UA, "Accept-Language": "en-US,en;q=0.9"},
        timeout=30,
    )
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    desc_tag = soup.find("meta", property="og:description")
    if not desc_tag or not desc_tag.get("content"):
        raise ValueError(
            "Instagram og:description not found "
            "(post may be private, deleted, or Instagram changed format)"
        )
    return desc_tag["content"].strip()


def ingest(url: str) -> str:
    canonical = canonical_url(url)
    sb = supabase_client()
    existing = (
        sb.table("recipes")
        .select("id")
        .eq("source_url", canonical)
        .limit(1)
        .execute()
        .data
    )
    if existing:
        recipe_id = existing[0]["id"]
        print(f"Already ingested: recipe {recipe_id}", file=sys.stderr)
        return recipe_id

    print(f"Fetching Instagram caption for {canonical}", file=sys.stderr)
    caption = fetch_caption(url)
    print(f"Got {len(caption)} chars of caption", file=sys.stderr)
    print("Calling GPT-4o for extraction...", file=sys.stderr)
    recipe = extract_recipe(caption)
    print(
        f"Extracted: {recipe.title!r} "
        f"({len(recipe.ingredients)} ingredients, "
        f"{recipe.extraction_confidence} confidence)",
        file=sys.stderr,
    )
    recipe_id = write_recipe(
        recipe, source_url=canonical, source_platform="instagram", raw_text=caption
    )
    print(f"Wrote recipe {recipe_id}", file=sys.stderr)
    return recipe_id


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: python -m food_everything.ingest.instagram <url>", file=sys.stderr)
        sys.exit(1)
    ingest(sys.argv[1])
