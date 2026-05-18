"""Gmail label -> recipes. Iterates a Gmail folder (label), dispatches each
email's recipe URL to the appropriate ingester (text or Vision), tracks state
in email_ingestions so re-runs skip already-processed messages.

One-time setup:
    1. Enable 2-step verification on your Google account.
    2. Generate an app password at https://myaccount.google.com/apppasswords
       (select "Mail" / "Other"; copy the 16-character password).
    3. Add to .env:
           GMAIL_USER=you@gmail.com
           GMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx

Usage:
    uv run python -m food_everything.ingest.gmail                  # process all
    uv run python -m food_everything.ingest.gmail --limit 3        # first 3
    uv run python -m food_everything.ingest.gmail --label Recipes  # different label
"""

import argparse
import base64
import email
import imaplib
import json
import os
import re
import sys
from email.message import Message
from email.utils import parsedate_to_datetime
from typing import Optional
from urllib.parse import parse_qs, urlparse

from bs4 import BeautifulSoup

from food_everything.config import supabase_client
from food_everything.ingest import image as image_ingester
from food_everything.ingest import substack as text_ingester
from food_everything.persist import write_recipe

IMAP_HOST = "imap.gmail.com"
IMAP_PORT = 993
SHORT_ARTICLE_THRESHOLD = 1500  # below this, prefer Vision if images present

SKIP_URL_HINTS = (
    "unsubscribe",
    "manage",
    "preferences",
    "/click",
    "list-manage",
    "facebook.com/sharer",
    "twitter.com/share",
    "x.com/share",
    "linkedin.com/share",
    "pinterest.com/pin/create",
    "/share?",
)

ASSET_EXTENSIONS = (".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".css", ".js", ".ico")


def get_imap() -> imaplib.IMAP4_SSL:
    user = os.environ["GMAIL_USER"]
    pw = os.environ["GMAIL_APP_PASSWORD"]
    conn = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT)
    conn.login(user, pw)
    return conn


def email_body_html(msg: Message) -> str:
    """Return the HTML part of a multipart email; fall back to plain text."""
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/html":
                payload = part.get_payload(decode=True)
                charset = part.get_content_charset() or "utf-8"
                return payload.decode(charset, errors="replace")
        for part in msg.walk():
            if part.get_content_type() == "text/plain":
                payload = part.get_payload(decode=True)
                charset = part.get_content_charset() or "utf-8"
                return payload.decode(charset, errors="replace")
        return ""
    payload = msg.get_payload(decode=True)
    charset = msg.get_content_charset() or "utf-8"
    return payload.decode(charset, errors="replace") if payload else ""


def _clean_url(url: str) -> str:
    return url.rstrip('">\'').rstrip("?&")


def resolve_redirect(url: str) -> str:
    """Decode substack.com/redirect/<n>/<JWT> tracking URLs to their real
    destination.

    Substack wraps every outbound link in a signed-but-publicly-readable JWT.
    The signature expires (~30 days) which is why old emails 400 when you hit
    the redirect endpoint directly. The destination is in the JWT payload's
    'e' field; if 'e' has a 'next' query param, that's the final article URL.
    """
    if "substack.com/redirect/" not in url:
        return url
    m = re.search(r"/redirect/\d+/([^/?#\s]+)", url)
    if not m:
        return url
    token = m.group(1)
    payload_b64 = token.split(".")[0]
    try:
        padded = payload_b64 + "=" * (-len(payload_b64) % 4)
        data = json.loads(base64.urlsafe_b64decode(padded).decode("utf-8"))
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
        return url
    encoded = data.get("e", "")
    if not encoded:
        return url
    parsed = urlparse(encoded)
    next_url = parse_qs(parsed.query).get("next", [None])[0]
    if next_url:
        return next_url
    # Strip the tracking query string off `e`
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path}"


def extract_recipe_url(body: str) -> Optional[str]:
    """Find the primary article URL in an email body.

    Strategy: ONLY look at <a href=...> tags (never body-text regex — that
    catches CSS `background: url(...)` strings). Resolve any Substack
    tracking-redirect through its JWT payload. Then prefer Substack /p/
    permalinks, then any plausible article link.
    """
    soup = BeautifulSoup(body, "html.parser")
    resolved: list[str] = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if not href.startswith("http"):
            continue
        resolved.append(resolve_redirect(href))

    def is_plausible(href: str) -> bool:
        lower = href.lower()
        if any(skip in lower for skip in SKIP_URL_HINTS):
            return False
        path = lower.split("?", 1)[0]
        if path.endswith(ASSET_EXTENSIONS):
            return False
        return True

    for href in resolved:
        if "substack.com/p/" in href:
            return _clean_url(href)
    for href in resolved:
        if is_plausible(href):
            return _clean_url(href)
    return None


def dispatch_ingest(url: str) -> str:
    """Choose between text/JSON-LD and Vision pipelines for a page.

    The text pipeline now uses JSON-LD when present and refuses extraction
    when neither JSON-LD nor substantial article text is available. On that
    refusal we fall back to Vision, which handles pages where the recipe
    lives in images (e.g., photographed cookbook pages).
    """
    try:
        print("  -> text/JSON-LD pipeline", file=sys.stderr)
        return text_ingester.ingest(url)
    except ValueError as e:
        print(f"  text pipeline refused ({e}); trying Vision...", file=sys.stderr)
        return image_ingester.ingest(url)


def ingest_from_email_body(html_body: str) -> str:
    """Last-resort fallback: extract a recipe directly from the email body
    when no article URL is available or the URL won't fetch. Used for
    newsletters that paste the full recipe into the message (Molly Baz,
    Bittman Project, Mushroom Digest, etc.)."""
    soup = BeautifulSoup(html_body, "html.parser")
    for tag in soup.select("style, script, head"):
        tag.decompose()
    text = soup.get_text(separator="\n").strip()
    text = re.sub(r"\n{3,}", "\n\n", text)
    if len(text) < 200:
        raise ValueError(f"email body too short to contain a recipe ({len(text)} chars)")
    print(f"  -> email body pipeline (text={len(text)} chars)", file=sys.stderr)
    recipe = text_ingester.extract_recipe(text)
    return write_recipe(
        recipe, source_url=None, source_platform="manual", raw_text=text
    )


def already_ingested(sb, message_id: str) -> bool:
    """Only successfully-ingested emails are 'done'. Failed/skipped rows are
    eligible for retry on the next run."""
    result = (
        sb.table("email_ingestions")
        .select("id")
        .eq("gmail_message_id", message_id)
        .eq("status", "ingested")
        .execute()
    )
    return len(result.data) > 0


def record_ingestion(
    sb,
    *,
    message_id: str,
    recipe_id: Optional[str],
    status: str,
    error: Optional[str],
    subject: str,
    from_addr: str,
    received_at: Optional[str],
) -> None:
    """Upsert by gmail_message_id so retries of previously-failed/skipped
    emails update the existing row rather than violating the unique index."""
    sb.table("email_ingestions").upsert(
        {
            "gmail_message_id": message_id,
            "recipe_id": recipe_id,
            "status": status,
            "error": error,
            "email_subject": subject,
            "email_from": from_addr,
            "email_received_at": received_at,
        },
        on_conflict="gmail_message_id",
    ).execute()


def parse_date(raw: str) -> Optional[str]:
    if not raw:
        return None
    try:
        return parsedate_to_datetime(raw).isoformat()
    except (TypeError, ValueError):
        return None


def _uids_for_retry_status(conn, sb, retry_status: str) -> list[bytes]:
    """Find IMAP UIDs for messages previously recorded with the given status.

    Strategy: pull the target Message-IDs from email_ingestions, then bulk-fetch
    just the Message-ID headers for every message in the mailbox in a single
    IMAP round-trip and locally filter. Cheaper and more robust than per-message
    HEADER search (which has fiddly quoting rules)."""
    result = (
        sb.table("email_ingestions")
        .select("gmail_message_id")
        .eq("status", retry_status)
        .execute()
    )
    targets = {row["gmail_message_id"].strip().strip("<>") for row in result.data}
    print(
        f"Looking up {len(targets)} {retry_status!r} messages...",
        file=sys.stderr,
    )
    if not targets:
        return []

    status, data = conn.search(None, "ALL")
    if status != "OK" or not data[0]:
        return []
    all_uids = data[0].split()

    status, fetched = conn.fetch(
        b",".join(all_uids), "(BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])"
    )
    if status != "OK":
        return []

    mid_re = re.compile(r"Message-ID:\s*<([^>]+)>", re.IGNORECASE)
    uid_re = re.compile(rb"^(\d+)\s")
    matched: list[bytes] = []
    for item in fetched:
        if not (isinstance(item, tuple) and len(item) >= 2):
            continue
        marker, header_bytes = item[0], item[1]
        m = uid_re.match(marker)
        if not m:
            continue
        header_text = header_bytes.decode("utf-8", errors="ignore")
        mid_match = mid_re.search(header_text)
        if mid_match and mid_match.group(1).strip() in targets:
            matched.append(m.group(1))
    return matched


def run(
    label: str = "recipes",
    limit: Optional[int] = None,
    retry_status: Optional[str] = None,
) -> None:
    sb = supabase_client()
    conn = get_imap()
    try:
        status, _ = conn.select(f'"{label}"', readonly=True)
        if status != "OK":
            print(
                f"Failed to select label {label!r}. Check the exact label "
                f"name (case-sensitive).",
                file=sys.stderr,
            )
            sys.exit(1)

        if retry_status:
            uids = _uids_for_retry_status(conn, sb, retry_status)
            # Re-processing previously-failed/skipped emails: delete the old
            # rows so the new run's upsert lands a fresh status.
            if uids:
                sb.table("email_ingestions").delete().eq(
                    "status", retry_status
                ).execute()
            print(f"Retry mode: {len(uids)} message(s)", file=sys.stderr)
        else:
            status, data = conn.search(None, "ALL")
            if status != "OK":
                print("Failed to list messages", file=sys.stderr)
                sys.exit(1)
            # Process newest first (highest IMAP UIDs). For backfill this
            # surfaces the most-likely-still-resolvable URLs first; for
            # incremental polling it means a low --limit catches new arrivals.
            uids = sorted(data[0].split(), key=int, reverse=True)
            print(f"Found {len(uids)} messages in label {label!r}", file=sys.stderr)

        if limit:
            uids = uids[:limit]
            print(f"Processing newest {limit}", file=sys.stderr)

        processed = skipped = succeeded = failed = 0
        for uid in uids:
            status, fetched = conn.fetch(uid, "(RFC822)")
            if status != "OK" or not fetched or not fetched[0]:
                print(f"  fetch failed for UID {uid.decode()}", file=sys.stderr)
                continue
            raw = fetched[0][1]
            msg = email.message_from_bytes(raw)
            message_id = (msg.get("Message-ID") or "").strip()
            subject = (msg.get("Subject") or "").strip()
            from_addr = (msg.get("From") or "").strip()
            received_at = parse_date(msg.get("Date") or "")

            if not message_id:
                print(f"  skipping: no Message-ID (subject={subject!r})", file=sys.stderr)
                continue

            if already_ingested(sb, message_id):
                skipped += 1
                continue

            print(f"\nProcessing: {subject!r}", file=sys.stderr)
            body = email_body_html(msg)
            url = extract_recipe_url(body)
            recipe_id: Optional[str] = None
            error: Optional[str] = None
            outcome: str  # 'ingested' | 'failed' | 'skipped'

            try:
                if url:
                    print(f"  URL: {url}", file=sys.stderr)
                    try:
                        recipe_id = dispatch_ingest(url)
                    except Exception as url_err:
                        print(
                            f"  URL failed ({url_err}); trying email body...",
                            file=sys.stderr,
                        )
                        recipe_id = ingest_from_email_body(body)
                else:
                    print("  no URL found; trying email body...", file=sys.stderr)
                    recipe_id = ingest_from_email_body(body)
                outcome = "ingested"
            except Exception as e:
                error = str(e)[:1000]
                outcome = "failed" if url else "skipped"
                print(f"  {outcome}: {e}", file=sys.stderr)

            record_ingestion(
                sb,
                message_id=message_id,
                recipe_id=recipe_id,
                status=outcome,
                error=error,
                subject=subject,
                from_addr=from_addr,
                received_at=received_at,
            )
            if outcome == "ingested":
                succeeded += 1
            elif outcome == "failed":
                failed += 1
            else:
                skipped += 1
            processed += 1

        print(
            f"\nDone. processed={processed} succeeded={succeeded} "
            f"failed={failed} skipped(already)={skipped}",
            file=sys.stderr,
        )
    finally:
        try:
            conn.close()
        except imaplib.IMAP4.error:
            pass
        conn.logout()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Ingest recipes from emails in a Gmail label"
    )
    parser.add_argument(
        "--label",
        default="recipes",
        help="Gmail label/folder to read (default: recipes; case-sensitive)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Process at most N messages (useful for testing)",
    )
    parser.add_argument(
        "--retry-status",
        choices=["failed", "skipped"],
        default=None,
        help=(
            "Re-process only emails with this prior status. Useful after fixing "
            "a bug or adding a new extraction path."
        ),
    )
    args = parser.parse_args()
    run(label=args.label, limit=args.limit, retry_status=args.retry_status)
