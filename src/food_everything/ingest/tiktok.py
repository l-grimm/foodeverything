"""TikTok URL -> recipes + recipe_ingredients rows.

Fetches the video caption (which TikTok renders client-side, so a real
headless browser is required) and runs the existing extract_recipe pipeline.

CLI usage:
    uv run python -m food_everything.ingest.tiktok https://www.tiktok.com/@user/video/123

In production the FastAPI webhook (food_everything.api.main) calls ingest()
directly when iOS Shortcut POSTs a URL.
"""

import asyncio
import sys

from playwright.async_api import async_playwright

from food_everything.ingest.substack import extract_recipe
from food_everything.persist import write_recipe

CAPTION_SELECTOR = '[data-e2e="browse-video-desc"]'


async def _fetch_caption_async(url: str) -> str:
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        try:
            page = await browser.new_page()
            await page.goto(url, timeout=60_000)
            await page.wait_for_selector(CAPTION_SELECTOR, timeout=10_000)
            return await page.locator(CAPTION_SELECTOR).inner_text()
        finally:
            await browser.close()


def fetch_caption(url: str) -> str:
    """Run the async Playwright fetch synchronously."""
    return asyncio.run(_fetch_caption_async(url))


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
