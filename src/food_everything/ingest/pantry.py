"""Grocery photo -> pantry_items rows via GPT-4o Vision.

Pipeline:
  1. Upload the source image to Supabase Storage (recipe-images bucket,
     pantry/ prefix) so we keep an audit trail.
  2. Create a pantry_sessions row pointing at the image.
  3. Send the image to GPT-4o Vision with a grocery-photo prompt.
  4. Insert one pantry_items row per identified item, linked to the
     session.
  5. Update the session with identified_ingredients[] for the audit log.

Photos can be receipts, grocery-bag dumps, fridge shelves, market hauls —
anything with visible food. Non-food items are ignored. Output items are
canonical singular lowercase so they match recipe_ingredients.name in the
recipe_coverage() RPC.

CLI usage:
    uv run python -m food_everything.ingest.pantry <path-to-image>
"""

import base64
import mimetypes
import sys
import uuid
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, Field

from food_everything.config import openai_client, supabase_client

STORAGE_BUCKET = "recipe-images"
STORAGE_PREFIX = "pantry"

PANTRY_SYSTEM_PROMPT = """You identify groceries in photographs for a personal pantry inventory.

The photo may be:
- A receipt from a grocery store
- Items laid out on a counter after shopping
- A fridge or pantry shelf
- A produce display or market haul

Identify every distinct edible item you can clearly see or read. Ignore:
- Non-food items (cleaning supplies, paper towels, etc.)
- Items you can't identify with reasonable confidence
- Decorative items, branded packaging that isn't food

For each item:
- name: canonical singular lowercase ("butter", "yellow onion", "chicken thigh",
  "all-purpose flour", "olive oil"). Use the form that would appear in a
  recipe's ingredient list. Always singular ("tomato" not "tomatoes",
  "chicken thigh" not "chicken thighs", "egg" not "eggs"). Lowercase.
- name_raw: verbatim what you saw — receipt line ("ORG ROMA TOM"), label
  text ("Heirloom Tomatoes 1lb"), or your best description if unlabeled
  ("a bunch of green cilantro"). Null if you have nothing meaningful.
- category: exactly one of:
    produce        — fresh fruits, vegetables, herbs
    dairy          — milk, butter, cheese, yogurt, cream, eggs
    protein        — meat, fish, tofu, beans, lentils
    grain          — bread, pasta, rice, oats, flour, cereals
    pantry_staple  — oils, vinegars, sugar, salt, spices, condiments, canned goods
    other          — anything edible that doesn't fit above

Be liberal with identification but conservative with the name field. If a
receipt line is too cryptic to map ("GROC 4.99"), skip it. Better to miss an
item than to write a wrong one — wrong items pollute the pantry and break
the recipe-coverage match.

Combine duplicates: if a photo shows three onions, emit one entry "yellow
onion" (presence-only; quantity will come later).
"""


class ExtractedPantryItem(BaseModel):
    name: str
    name_raw: Optional[str] = None
    category: Literal["produce", "dairy", "protein", "grain", "pantry_staple", "other"]


class ExtractedPantry(BaseModel):
    items: list[ExtractedPantryItem] = Field(default_factory=list)


def _image_data_url(image_bytes: bytes, mime: str) -> str:
    b64 = base64.b64encode(image_bytes).decode("ascii")
    return f"data:{mime};base64,{b64}"


def _upload_image(sb, image_bytes: bytes, mime: str) -> tuple[str, str]:
    """Upload image to Supabase Storage. Returns (storage_path, public_url)."""
    ext = mimetypes.guess_extension(mime) or ".jpg"
    storage_path = f"{STORAGE_PREFIX}/{uuid.uuid4()}{ext}"
    sb.storage.from_(STORAGE_BUCKET).upload(
        storage_path,
        image_bytes,
        file_options={"content-type": mime, "upsert": "false"},
    )
    return storage_path, sb.storage.from_(STORAGE_BUCKET).get_public_url(storage_path)


def extract_items(image_bytes: bytes, mime: str) -> ExtractedPantry:
    client = openai_client()
    response = client.beta.chat.completions.parse(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": PANTRY_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "What groceries are in this photo?"},
                    {
                        "type": "image_url",
                        "image_url": {"url": _image_data_url(image_bytes, mime)},
                    },
                ],
            },
        ],
        response_format=ExtractedPantry,
    )
    message = response.choices[0].message
    if message.refusal:
        raise ValueError(f"GPT refused extraction: {message.refusal}")
    if message.parsed is None:
        raise ValueError("GPT did not return a parsed pantry list")
    return message.parsed


def ingest(image_bytes: bytes, mime: str) -> dict:
    """Run the full pipeline. Returns {session_id, image_url, items: [...]}."""
    sb = supabase_client()

    print("Uploading image to Supabase Storage...", file=sys.stderr)
    _, image_url = _upload_image(sb, image_bytes, mime)

    print("Calling GPT-4o Vision...", file=sys.stderr)
    extracted = extract_items(image_bytes, mime)
    print(f"Identified {len(extracted.items)} items", file=sys.stderr)

    session_row = (
        sb.table("pantry_sessions")
        .insert(
            {
                "photo_urls": [image_url],
                "identified_ingredients": [item.name for item in extracted.items],
                "confirmed_ingredients": [item.name for item in extracted.items],
            }
        )
        .execute()
        .data[0]
    )
    session_id = session_row["id"]

    if extracted.items:
        sb.table("pantry_items").insert(
            [
                {
                    "name": item.name.strip().lower(),
                    "name_raw": item.name_raw,
                    "category": item.category,
                    "source_session_id": session_id,
                    "source_image_url": image_url,
                }
                for item in extracted.items
            ]
        ).execute()
        # Best-effort canonicalization so the new names land in the cache.
        try:
            from food_everything.canonicalize import canonicalize_many

            canonicalize_many([item.name for item in extracted.items], sb=sb)
        except Exception as e:
            print(f"canonicalize_many failed (non-fatal): {e}", file=sys.stderr)

    return {
        "session_id": session_id,
        "image_url": image_url,
        "items": [item.model_dump() for item in extracted.items],
    }


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: python -m food_everything.ingest.pantry <image-path>", file=sys.stderr)
        sys.exit(1)
    path = Path(sys.argv[1])
    mime = mimetypes.guess_type(path.name)[0] or "image/jpeg"
    result = ingest(path.read_bytes(), mime)
    print(f"Session {result['session_id']}", file=sys.stderr)
    print(f"Image: {result['image_url']}", file=sys.stderr)
    for item in result["items"]:
        print(f"  {item['category']:14s} {item['name']:25s} ({item['name_raw'] or '-'})")
