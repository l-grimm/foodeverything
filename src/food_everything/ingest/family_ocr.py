"""Local family-recipe JPEG/PDF -> recipes + recipe_ingredients rows.

For the personal collection of handwritten recipe cards, newspaper clippings,
printed recipes with handwritten annotations, etc. Different from URL
ingesters in several ways:

1. Vision-only (GPT-4o on the image bytes).
2. Family-recipe prompt that knows how to handle multi-year margin notes —
   use the most recent annotation as the canonical recipe; preserve all
   annotations verbatim in `my_notes`.
3. Always sets is_family_recipe=true and source_platform='manual'.
4. Tags the recipe by physical format: newspaper-clipping,
   handwritten-recipe-card, printed-with-annotations, etc.
5. Uploads the original image to Supabase Storage so it lives alongside
   the OCR'd text.
6. Dedup via local_imports audit table (file path is the key).

PDF support via pypdfium2 — multi-page recipes rasterize each page to JPEG
and send all pages to Vision in a single multimodal call.

CLI usage:
    uv run python -m food_everything.ingest.family_ocr <path> [<path> ...]

Each <path> may be a file or a directory. Directories are walked for
.jpg/.jpeg/.png/.pdf.
"""

import argparse
import base64
import hashlib
import io
import sys
from pathlib import Path
from typing import Optional

import pypdfium2 as pdfium

from food_everything.config import openai_client, supabase_client
from food_everything.ingest.substack import ExtractedRecipe
from food_everything.persist import write_recipe

STORAGE_BUCKET = "recipe-images"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
PDF_EXTENSIONS = {".pdf"}
PDF_RENDER_SCALE = 2.0  # 2x zoom for better OCR quality

FAMILY_SYSTEM_PROMPT = """You extract recipes from photographs of family recipe documents.

These are personal-collection images. They may be:
- Handwritten recipe cards (cursive ink on paper, sometimes dated)
- Newspaper clippings (printed text, often yellowed or rotated)
- Printed recipes (e.g., Food Network printouts) with handwritten annotations
- Any combination — printed recipe card with multi-year handwritten margin notes

INGREDIENTS — for each, separate:
- name: canonical ingredient ("butter", "all-purpose flour")
- name_raw: verbatim text from the recipe
- amount: numeric quantity as a string ("1", "1/2", "2-3"); null if not given
- unit: e.g. "tbsp", "cup", "g"; null if no unit
- prep_note: e.g. "chopped", "fresh", "room temperature"
- category: exactly one of produce, dairy, protein, grain, pantry_staple, other

CATEGORY RULES (be strict):
- produce       = fresh vegetables, fresh fruits, fresh herbs
- dairy         = milk, cream, butter, cheese, yogurt, sour cream, buttermilk
                  (NOT eggs — eggs are protein)
- protein       = eggs, meat, poultry, fish, shellfish, tofu, tempeh
- grain         = flour, bread, rice, pasta, oats, breadcrumbs, cornmeal
- pantry_staple = sugar, brown sugar, salt, spices, baking powder/soda,
                  yeast, oils, vinegars, extracts, sauces (soy/hot/worcestershire),
                  sweeteners (maple syrup, honey, molasses), dried fruit,
                  jam/preserves, canned/jarred condiments
- other         = water, broth, stock, juice, alcohol, anything that doesn't fit

ANNOTATION HANDLING (CRITICAL):
- Family recipes often have margin annotations from multiple decades. Year
  markers like "2015 - 5 eggs" indicate the cook revised the original value
  in that year.
- When the SAME ingredient or instruction has multiple year-tagged versions,
  USE THE LATEST YEAR as the canonical value. Compare the years as numbers.
  Example: if you see "2005 - 5 eggs" AND "2015 - 6 eggs" for eggs,
  the canonical value is 6 eggs (because 2015 > 2005). Do NOT default to
  the printed/base value — the latest year always wins.
- ALWAYS preserve every annotation verbatim in `my_notes` (multi-line OK).
  Include year markers, asterisks, crossed-out values — all of it.
  The annotations are family history.

MULTIPLE RECIPES ON ONE PAGE:
- Sometimes a single image contains the main recipe PLUS a separate small
  recipe (e.g., a topping recipe on a sticky note attached to the main card,
  or a second variant labeled "1 can recipe").
- Extract the PRIMARY recipe into the structured fields (ingredients,
  instructions, etc.).
- For each ADDITIONAL recipe visible on the page, add a clearly-marked
  section to `my_notes` like:
      "ADDITIONAL RECIPE - Topping: <ingredients + instructions>"
      "ADDITIONAL RECIPE - 1-can variant: <ingredients + instructions>"
  Do NOT silently merge them into the main ingredient list.

STANDARD FIELDS — always extract when present:
- title (recipe name)
- author: a person's name if attributed ("Sylvia", "Grandma", "Mom",
  newspaper byline). Null if not attributed.
- cuisine (if clear from the recipe)
- recipe_yield (e.g. "Serves 6", "2 dozen cookies", "1 loaf")
- instructions: each step as a separate string

TAGS — at minimum, include ONE source-type tag describing the physical format:
- "newspaper-clipping" — printed newspaper/magazine clipping
- "handwritten-recipe-card" — fully handwritten on a card or notebook page
- "printed-with-annotations" — printed (e.g. Food Network) with handwritten notes
- "handwritten-with-annotations" — handwritten card with additional notes

You may add up to 3 more descriptive tags (e.g. "dessert", "passover",
"weeknight", "freezer-friendly"). Don't pad.

TIME FIELDS: only fill prep_time/cook_time/total_time when stated verbatim.
Do NOT estimate. Leave null otherwise.

COURSE: one of breakfast, lunch, dinner, appetizer, side, dessert, snack, drink.
Only set when clear. Null if ambiguous.

HOLIDAY: NULL unless the recipe is EXPLICITLY associated with a specific
holiday (Passover, Thanksgiving, Christmas Eve, Hanukkah, etc.). Filenames
or context like "Christmas Dinner Sweet Pot. Souffle" count as explicit.

SEASON: derive from fresh seasonal ingredients per Northeast US (spring:
ramps/peas/asparagus/rhubarb; summer: tomatoes/corn/zucchini/berries; fall:
winter squash/apples/cranberries; winter: hardy greens/citrus). Only set
when there's a strong fresh-ingredient signal. Canned/dried/frozen carry
no seasonal signal. Otherwise NULL.

EXTRACTION_CONFIDENCE:
- "high" — writing is clearly legible, no ambiguity, you're confident
- "needs_review" — any of: faded ink, complex multi-decade annotations,
  partial illegibility, page edges cut off, multi-recipe pages, anything
  uncertain. Err on the side of needs_review when in doubt.
"""


def _file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _image_bytes_to_data_url(image_bytes: bytes, mime: str = "image/jpeg") -> str:
    b64 = base64.b64encode(image_bytes).decode("utf-8")
    return f"data:{mime};base64,{b64}"


def _load_pages(path: Path) -> list[tuple[bytes, str]]:
    """Return list of (image_bytes, mime_type) for each page of the file.
    JPEG/PNG return one entry. PDFs rasterize every page."""
    ext = path.suffix.lower()
    if ext in IMAGE_EXTENSIONS:
        return [(path.read_bytes(), f"image/{ 'jpeg' if ext in {'.jpg', '.jpeg'} else ext.lstrip('.')}")]
    if ext in PDF_EXTENSIONS:
        doc = pdfium.PdfDocument(str(path))
        pages: list[tuple[bytes, str]] = []
        for i in range(len(doc)):
            page = doc[i]
            pil = page.render(scale=PDF_RENDER_SCALE).to_pil()
            buf = io.BytesIO()
            pil.convert("RGB").save(buf, format="JPEG", quality=90)
            pages.append((buf.getvalue(), "image/jpeg"))
        return pages
    raise ValueError(f"unsupported file extension: {ext}")


def extract_recipe_from_images(image_bytes_list: list[tuple[bytes, str]]) -> ExtractedRecipe:
    """Send one or more page images to GPT-4o Vision in a single call."""
    client = openai_client()
    user_content: list[dict] = [
        {
            "type": "text",
            "text": (
                "Extract the recipe from this family-recipe image. If there are "
                "multi-year annotations, use the most recent values for the "
                "canonical recipe and preserve ALL annotations in my_notes."
            ),
        }
    ]
    for img_bytes, mime in image_bytes_list:
        user_content.append({
            "type": "image_url",
            "image_url": {"url": _image_bytes_to_data_url(img_bytes, mime)},
        })

    response = client.beta.chat.completions.parse(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": FAMILY_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        response_format=ExtractedRecipe,
    )
    message = response.choices[0].message
    if message.refusal:
        raise ValueError(f"GPT refused: {message.refusal}")
    if message.parsed is None:
        raise ValueError("GPT did not return a parsed recipe")
    return message.parsed


def _upload_image(sb, recipe_id: str, source_path: Path, image_bytes: bytes, mime: str, page_idx: int) -> str:
    """Upload one rendered page to Supabase Storage; return the public URL."""
    safe_name = "".join(c if c.isalnum() or c in "._-" else "_" for c in source_path.stem)
    ext = ".jpg" if mime == "image/jpeg" else "." + mime.split("/")[-1]
    suffix = "" if page_idx == 0 else f"_p{page_idx + 1}"
    storage_path = f"{recipe_id}/{safe_name}{suffix}{ext}"
    sb.storage.from_(STORAGE_BUCKET).upload(
        storage_path,
        image_bytes,
        file_options={"content-type": mime, "upsert": "true"},
    )
    return sb.storage.from_(STORAGE_BUCKET).get_public_url(storage_path)


def _record_outcome(sb, file_path: str, file_hash: str, recipe_id: Optional[str],
                    status: str, error: Optional[str]) -> None:
    sb.table("local_imports").upsert(
        {
            "file_path": file_path,
            "file_hash": file_hash,
            "recipe_id": recipe_id,
            "status": status,
            "error": error,
        },
        on_conflict="file_path",
    ).execute()


def _already_ingested(sb, file_path: str) -> bool:
    result = (
        sb.table("local_imports")
        .select("id")
        .eq("file_path", file_path)
        .eq("status", "ingested")
        .execute()
    )
    return len(result.data) > 0


def ingest_file(path: Path) -> Optional[str]:
    """Process one file: OCR -> insert recipe -> upload image(s). Returns recipe_id
    on success, None if skipped. Raises on failure (caller records audit)."""
    file_path = str(path.resolve())
    sb = supabase_client()
    if _already_ingested(sb, file_path):
        print(f"  already ingested, skipping", file=sys.stderr)
        return None

    file_hash = _file_hash(path)
    try:
        pages = _load_pages(path)
    except Exception as e:
        _record_outcome(sb, file_path, file_hash, None, "failed", f"could not load: {e}")
        raise

    print(f"  {len(pages)} page(s) loaded, sending to GPT-4o Vision...", file=sys.stderr)
    try:
        recipe = extract_recipe_from_images(pages)
    except Exception as e:
        _record_outcome(sb, file_path, file_hash, None, "failed", f"extraction: {e}")
        raise

    print(
        f"  Extracted: {recipe.title!r} ({len(recipe.ingredients)} ingredients, "
        f"{recipe.extraction_confidence})",
        file=sys.stderr,
    )

    raw_text = f"[FAMILY_OCR]\nsource_path: {file_path}\npages: {len(pages)}"
    try:
        recipe_id = write_recipe(
            recipe,
            source_url=None,
            source_platform="manual",
            raw_text=raw_text,
        )
    except Exception as e:
        _record_outcome(sb, file_path, file_hash, None, "failed", f"write: {e}")
        raise

    # Force is_family_recipe=true; upload pages
    update: dict = {"is_family_recipe": True}
    try:
        image_urls: list[str] = []
        for i, (img_bytes, mime) in enumerate(pages):
            image_urls.append(_upload_image(sb, recipe_id, path, img_bytes, mime, i))
        update["image_urls"] = image_urls
    except Exception as e:
        print(f"  upload failed (recipe still saved): {e}", file=sys.stderr)

    sb.table("recipes").update(update).eq("id", recipe_id).execute()
    _record_outcome(sb, file_path, file_hash, recipe_id, "ingested", None)
    print(f"  -> recipe {recipe_id} ({len(update.get('image_urls', []))} image(s) uploaded)", file=sys.stderr)
    return recipe_id


def _collect_files(roots: list[Path]) -> list[Path]:
    """Expand any directories in `roots` into a sorted list of supported files."""
    out: list[Path] = []
    seen: set[Path] = set()
    for root in roots:
        if root.is_file():
            if root.suffix.lower() in IMAGE_EXTENSIONS | PDF_EXTENSIONS:
                rp = root.resolve()
                if rp not in seen:
                    seen.add(rp)
                    out.append(root)
        elif root.is_dir():
            for child in sorted(root.iterdir()):
                if child.is_file() and child.suffix.lower() in IMAGE_EXTENSIONS | PDF_EXTENSIONS:
                    rp = child.resolve()
                    if rp not in seen:
                        seen.add(rp)
                        out.append(child)
    return out


def run(paths: list[Path], limit: Optional[int] = None) -> None:
    files = _collect_files(paths)
    print(f"Found {len(files)} file(s)", file=sys.stderr)
    if limit:
        files = files[:limit]
        print(f"Processing first {limit}", file=sys.stderr)

    succeeded = failed = skipped = 0
    for f in files:
        print(f"\n[{f.name}]", file=sys.stderr)
        try:
            result = ingest_file(f)
            if result is None:
                skipped += 1
            else:
                succeeded += 1
        except Exception as e:
            failed += 1
            print(f"  FAILED: {e}", file=sys.stderr)
    print(
        f"\nDone. ingested={succeeded} failed={failed} skipped={skipped}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="OCR local family recipe images/PDFs")
    parser.add_argument("paths", nargs="+", type=Path, help="files or directories to process")
    parser.add_argument("--limit", type=int, default=None, help="process at most N files")
    args = parser.parse_args()
    run(args.paths, args.limit)
