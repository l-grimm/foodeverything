"""Airtable -> Supabase recipes import.

Usage:
    uv run python -m food_everything.ingest.airtable \\
        --base appxrK2xOWKgQKW1I --table "Imported table"
    uv run python -m food_everything.ingest.airtable \\
        --base app0GloGj3Fu5To0O --table "Recipes" --limit 5

Maps Airtable record fields onto our ExtractedRecipe model via GPT (to parse
the multiline Ingredients blob into structured rows), then overrides
Airtable-authoritative metadata (Is Family Recipe?, Course, Holiday, Season,
Notes, Author, OCR Confidence) on the recipe row directly. Downloads any
`Original File` attachments and reuploads to Supabase Storage so the
originals survive Airtable deletion.

Dedup: by source_url match against existing recipes AND by airtable_record_id
in the airtable_imports audit table. Re-running is safe.
"""

import argparse
import os
import sys
from typing import Optional

import requests

from food_everything.config import supabase_client
from food_everything.ingest.substack import extract_recipe, fetch_article
from food_everything.persist import write_recipe

STORAGE_BUCKET = "recipe-images"
AIRTABLE_API = "https://api.airtable.com/v0"

VALID_COURSES = {"breakfast", "lunch", "dinner", "appetizer", "side", "dessert", "snack", "drink"}
VALID_SEASONS = {"spring", "summer", "fall", "winter"}


def _airtable_headers() -> dict:
    return {"Authorization": f"Bearer {os.environ['AIRTABLE_PAT']}"}


def fetch_records(base: str, table: str) -> list[dict]:
    """Paginate through every record in the given Airtable table."""
    records: list[dict] = []
    offset = None
    while True:
        params: dict = {"pageSize": 100}
        if offset:
            params["offset"] = offset
        r = requests.get(
            f"{AIRTABLE_API}/{base}/{table}",
            headers=_airtable_headers(),
            params=params,
            timeout=30,
        )
        r.raise_for_status()
        data = r.json()
        records.extend(data.get("records", []))
        offset = data.get("offset")
        if not offset:
            break
    return records


def resolve_input(fields: dict) -> tuple[str, str]:
    """Return (input_text, kind) for GPT extraction.

    Prefers Airtable's own Ingredients/Instructions text when populated.
    Falls back to fetching the Source URL through the JSON-LD-aware
    substack.fetch_article pipeline — this is what salvages the Pocket
    Import Failures, which are essentially URL bookmarks with empty text.

    Raises ValueError when neither path yields content.
    """
    has_ingredients = bool((fields.get("Ingredients") or "").strip())
    has_instructions = bool((fields.get("Instructions") or "").strip())
    if has_ingredients or has_instructions:
        return build_input_text(fields), "airtable_text"

    source_url = fields.get("TikTok URL") or fields.get("Source")
    if source_url:
        # fetch_article handles JSON-LD detection and raises on too-thin input
        return fetch_article(source_url), "url_fetch"

    raise ValueError("record has neither ingredient text nor source URL")


def build_input_text(fields: dict) -> str:
    """Render an Airtable record as plain text for GPT extraction."""
    title = fields.get("Recipe Name") or fields.get("Name") or "(untitled)"
    parts = [f"Title: {title}"]
    if author := fields.get("Author"):
        parts.append(f"Author: {author}")
    if y := fields.get("Yield"):
        parts.append(f"Yield: {y}")
    if t := fields.get("Time"):
        parts.append(f"Time: {t}")
    parts.append("\nIngredients:\n" + (fields.get("Ingredients") or ""))
    parts.append("\nInstructions:\n" + (fields.get("Instructions") or ""))
    if notes := (fields.get("Notes") or fields.get("User Notes")):
        parts.append("\nNotes:\n" + notes)
    return "\n".join(parts)


def detect_source(fields: dict) -> tuple[Optional[str], str]:
    """Pick a (source_url, source_platform) from the Airtable record."""
    if url := fields.get("TikTok URL"):
        return url, "tiktok"
    if url := fields.get("Source"):
        return url, "url"
    return None, "manual"


def airtable_overrides(fields: dict) -> dict:
    """Build a partial-update payload of fields where Airtable is more
    authoritative than the LLM's derived values."""
    update: dict = {}
    if fields.get("Is Family Recipe?"):
        update["is_family_recipe"] = bool(fields["Is Family Recipe?"])
    if (val := fields.get("Holiday")):
        update["holiday"] = val
    if (val := fields.get("Season")):
        v = val.strip().lower()
        if v in VALID_SEASONS:
            update["season"] = v
    if (val := fields.get("Course")):
        v = val.strip().lower()
        if v in VALID_COURSES:
            update["course"] = v
    if (val := fields.get("Notes") or fields.get("User Notes")):
        update["my_notes"] = val
    if (val := fields.get("Author")):
        update["author"] = val
    # OCR Confidence: Airtable stores as percentage (0-1 or 0-100).
    # Map to extraction_confidence enum.
    if (conf := fields.get("OCR Confidence")) is not None:
        pct = conf * 100 if conf <= 1 else conf
        update["extraction_confidence"] = "high" if pct >= 80 else "needs_review"
    return update


def upload_attachments(sb, recipe_id: str, attachments: list[dict]) -> list[str]:
    """Download each Airtable attachment and reupload to Supabase Storage.
    Returns the resulting public URLs in order."""
    urls: list[str] = []
    for i, att in enumerate(attachments):
        airtable_url = att.get("url")
        if not airtable_url:
            continue
        filename = att.get("filename") or f"image_{i}"
        # Sanitize filename for path safety
        safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in filename)
        storage_path = f"{recipe_id}/{safe}"
        content_type = att.get("type") or "application/octet-stream"
        resp = requests.get(airtable_url, timeout=60)
        resp.raise_for_status()
        sb.storage.from_(STORAGE_BUCKET).upload(
            storage_path,
            resp.content,
            file_options={"content-type": content_type, "upsert": "true"},
        )
        urls.append(sb.storage.from_(STORAGE_BUCKET).get_public_url(storage_path))
    return urls


def already_imported(sb, record_id: str) -> bool:
    result = (
        sb.table("airtable_imports")
        .select("id")
        .eq("airtable_record_id", record_id)
        .eq("status", "ingested")
        .execute()
    )
    return len(result.data) > 0


def source_url_exists(sb, source_url: str) -> Optional[str]:
    """Return the existing recipe_id if the source_url is already in the DB."""
    result = (
        sb.table("recipes")
        .select("id")
        .eq("source_url", source_url)
        .limit(1)
        .execute()
    )
    return result.data[0]["id"] if result.data else None


def record_import_outcome(
    sb,
    *,
    record_id: str,
    base: str,
    table: str,
    recipe_id: Optional[str],
    status: str,
    error: Optional[str],
) -> None:
    sb.table("airtable_imports").upsert(
        {
            "airtable_record_id": record_id,
            "airtable_base_id": base,
            "airtable_table": table,
            "recipe_id": recipe_id,
            "status": status,
            "error": error,
        },
        on_conflict="airtable_record_id",
    ).execute()


def _records_for_retry_status(
    sb, base: str, table: str, retry_status: str
) -> set[str]:
    """Find Airtable record ids matching `retry_status` in the audit table
    (scoped to this base+table). Used to target re-runs at previously-failed
    or previously-skipped records without re-processing the whole table."""
    result = (
        sb.table("airtable_imports")
        .select("airtable_record_id")
        .eq("airtable_base_id", base)
        .eq("airtable_table", table)
        .eq("status", retry_status)
        .execute()
    )
    return {r["airtable_record_id"] for r in result.data}


def run(
    base: str,
    table: str,
    limit: Optional[int] = None,
    retry_status: Optional[str] = None,
) -> None:
    sb = supabase_client()
    records = fetch_records(base, table)
    print(f"Fetched {len(records)} records from {base}/{table}", file=sys.stderr)

    if retry_status:
        targets = _records_for_retry_status(sb, base, table, retry_status)
        records = [r for r in records if r["id"] in targets]
        print(
            f"Retry mode: {len(records)} record(s) with prior status={retry_status!r}",
            file=sys.stderr,
        )
        if records:
            # Delete old audit rows so the upsert lands a fresh outcome
            sb.table("airtable_imports").delete().eq(
                "airtable_base_id", base
            ).eq("airtable_table", table).eq("status", retry_status).execute()

    if limit:
        records = records[:limit]
        print(f"Processing first {limit}", file=sys.stderr)

    succeeded = failed = skipped = 0
    for rec in records:
        rec_id = rec["id"]
        fields = rec.get("fields", {})
        title = fields.get("Recipe Name") or fields.get("Name") or "(untitled)"

        if already_imported(sb, rec_id):
            skipped += 1
            continue

        print(f"\n  {rec_id}: {title!r}", file=sys.stderr)
        try:
            source_url, source_platform = detect_source(fields)
            if source_url and (existing := source_url_exists(sb, source_url)):
                print(f"    skipped: source_url already in DB as {existing}", file=sys.stderr)
                record_import_outcome(
                    sb,
                    record_id=rec_id,
                    base=base,
                    table=table,
                    recipe_id=existing,
                    status="skipped",
                    error=f"source_url already exists as recipe {existing}",
                )
                skipped += 1
                continue

            input_text, input_kind = resolve_input(fields)
            print(f"    input: {input_kind} ({len(input_text)} chars)", file=sys.stderr)
            recipe = extract_recipe(input_text)
            recipe_id = write_recipe(
                recipe,
                source_url=source_url,
                source_platform=source_platform,
                raw_text=input_text,
            )

            # Override LLM-derived fields with Airtable-authoritative metadata
            update = airtable_overrides(fields)

            # Attachments
            attachments = fields.get("Original File") or []
            if attachments:
                try:
                    image_urls = upload_attachments(sb, recipe_id, attachments)
                    if image_urls:
                        update["image_urls"] = image_urls
                    print(f"    uploaded {len(image_urls)} attachment(s)", file=sys.stderr)
                except Exception as att_err:
                    print(f"    attachment upload failed: {att_err}", file=sys.stderr)

            if update:
                sb.table("recipes").update(update).eq("id", recipe_id).execute()

            record_import_outcome(
                sb,
                record_id=rec_id,
                base=base,
                table=table,
                recipe_id=recipe_id,
                status="ingested",
                error=None,
            )
            succeeded += 1
            print(f"    -> recipe {recipe_id}", file=sys.stderr)
        except Exception as e:
            failed += 1
            err = str(e)[:1000]
            print(f"    failed: {err}", file=sys.stderr)
            record_import_outcome(
                sb,
                record_id=rec_id,
                base=base,
                table=table,
                recipe_id=None,
                status="failed",
                error=err,
            )

    print(
        f"\nDone. ingested={succeeded} failed={failed} skipped={skipped}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Import recipes from an Airtable table")
    parser.add_argument("--base", required=True, help="Airtable base id (e.g. appxrK2xOWKgQKW1I)")
    parser.add_argument("--table", required=True, help="Airtable table name")
    parser.add_argument("--limit", type=int, default=None, help="Process at most N records")
    parser.add_argument(
        "--retry-status",
        choices=["failed", "skipped"],
        default=None,
        help=(
            "Re-process only records with this prior status in airtable_imports. "
            "Useful after fixing a bug or adding a new extraction path."
        ),
    )
    args = parser.parse_args()
    run(args.base, args.table, args.limit, retry_status=args.retry_status)
