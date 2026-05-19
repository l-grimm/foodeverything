"""TikTok URL -> recipes + recipe_ingredients rows.

Reads TikTok's server-rendered `__UNIVERSAL_DATA_FOR_REHYDRATION__` JSON
blob from the page HTML (one plain HTTP GET; no headless browser required).
That blob contains the video description and author. The description is fed
through the standard extract_recipe pipeline.

CLI usage:
    uv run python -m food_everything.ingest.tiktok https://www.tiktok.com/@user/video/123

In production the FastAPI webhook (food_everything.api.main) calls ingest()
directly when iOS Shortcut POSTs a URL.
"""

import json
import re
import sys

import requests

from food_everything.ingest.substack import extract_recipe
from food_everything.persist import write_recipe

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
REHYDRATION_RE = re.compile(
    r'<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.+?)</script>',
    re.DOTALL,
)


def fetch_caption(url: str) -> str:
    """Pull the video description out of TikTok's embedded rehydration JSON.

    Raises ValueError if the JSON blob is missing or the path inside it is
    unexpected (private video, deleted video, TikTok changed their format).
    """
    resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=30)
    resp.raise_for_status()
    m = REHYDRATION_RE.search(resp.text)
    if not m:
        raise ValueError(
            "TikTok rehydration JSON not found in page "
            "(video may be private, deleted, or TikTok's HTML format changed)"
        )
    try:
        data = json.loads(m.group(1))
        item = data["__DEFAULT_SCOPE__"]["webapp.video-detail"]["itemInfo"]["itemStruct"]
    except (json.JSONDecodeError, KeyError, TypeError) as e:
        raise ValueError(f"TikTok JSON structure unexpected: {e}")
    desc = (item.get("desc") or "").strip()
    if not desc:
        raise ValueError("TikTok video has no description")
    author = (item.get("author") or {}).get("uniqueId", "")
    # Prefix author so GPT can attribute the recipe
    return f"@{author}\n\n{desc}" if author else desc


def ingest(url: str) -> str:
    print(f"Fetching TikTok caption for {url}", file=sys.stderr)
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
        recipe, source_url=url, source_platform="tiktok", raw_text=caption
    )
    print(f"Wrote recipe {recipe_id}", file=sys.stderr)
    return recipe_id


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: python -m food_everything.ingest.tiktok <tiktok_url>", file=sys.stderr)
        sys.exit(1)
    ingest(sys.argv[1])
