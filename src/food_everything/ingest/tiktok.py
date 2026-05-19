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
from urllib.parse import urlparse

import requests

from food_everything.config import supabase_client
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
COMMENT_API = "https://www.tiktok.com/api/comment/list/"


def fetch_creator_comments(aweme_id: str, creator_unique_id: str) -> list[str]:
    """Pull the first page of comments and return ones authored by the
    creator. Many TikTok recipe accounts post the actual recipe as a
    pinned/creator comment with a 'Recipe in comments!' caption."""
    if not aweme_id or not creator_unique_id:
        return []
    try:
        r = requests.get(
            COMMENT_API,
            params={
                "aweme_id": aweme_id,
                "count": 20,
                "cursor": 0,
                "aid": 1988,  # TikTok web app id; without this the endpoint returns empty
            },
            headers={"User-Agent": USER_AGENT, "Referer": "https://www.tiktok.com/"},
            timeout=15,
        )
        r.raise_for_status()
        data = r.json()
    except Exception:
        return []
    out: list[str] = []
    for c in data.get("comments") or []:
        if (c.get("user") or {}).get("unique_id") == creator_unique_id:
            text = (c.get("text") or "").strip()
            if text:
                out.append(text)
    return out


def canonical_url(url: str) -> str:
    """Strip query parameters and trailing slashes so the same TikTok video
    saved twice with different tracking params (e.g. _r, _t, lang) dedupes."""
    p = urlparse(url)
    return f"{p.scheme}://{p.netloc}{p.path}".rstrip("/")


def fetch_caption(url: str) -> str:
    """Pull video description + any creator-authored comments from TikTok.

    Many creators put the actual recipe in a pinned/creator comment rather
    than the caption ("Recipe in comments!" pattern). We pull both and let
    GPT extract from the combined text.

    Raises ValueError if the JSON blob is missing or the video has no
    description and no creator comments.
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
    author = item.get("author") or {}
    author_id = author.get("uniqueId", "")
    aweme_id = item.get("id", "")
    creator_comments = fetch_creator_comments(aweme_id, author_id)

    if not desc and not creator_comments:
        raise ValueError("TikTok video has no description and no creator comments")

    parts: list[str] = []
    if author_id:
        parts.append(f"@{author_id}")
    if desc:
        parts.append(desc)
    for c in creator_comments:
        parts.append(f"[Creator comment]\n{c}")
    return "\n\n".join(parts)


def ingest(url: str) -> str:
    canonical = canonical_url(url)
    # Dedup: if this TikTok is already ingested, return its existing recipe id
    # without re-extracting (saves GPT cost on accidental re-shares).
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

    print(f"Fetching TikTok caption for {canonical}", file=sys.stderr)
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
        recipe, source_url=canonical, source_platform="tiktok", raw_text=caption
    )
    print(f"Wrote recipe {recipe_id}", file=sys.stderr)
    return recipe_id


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: python -m food_everything.ingest.tiktok <tiktok_url>", file=sys.stderr)
        sys.exit(1)
    ingest(sys.argv[1])
