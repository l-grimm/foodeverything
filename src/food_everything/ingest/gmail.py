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
import email
import imaplib
import os
import re
import sys
from email.message import Message
from email.utils import parsedate_to_datetime
from typing import Optional

from bs4 import BeautifulSoup

from food_everything.config import supabase_client
from food_everything.ingest import image as image_ingester
from food_everything.ingest import substack as text_ingester

IMAP_HOST = "imap.gmail.com"
IMAP_PORT = 993
SHORT_ARTICLE_THRESHOLD = 1500  # below this, prefer Vision if images present

SUBSTACK_URL_RE = re.compile(r'https?://[^\s"<>]*substack\.com/p/[^\s"<>]+')
ANY_URL_RE = re.compile(r'https?://[^\s"<>]+')

SKIP_URL_HINTS = ("unsubscribe", "manage", "preferences", "/click", "list-manage")


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


def extract_recipe_url(body: str) -> Optional[str]:
    """Find the primary article URL in an email body. Prefers Substack /p/ permalinks."""
    soup = BeautifulSoup(body, "html.parser")
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "substack.com/p/" in href:
            return _clean_url(href)
    m = SUBSTACK_URL_RE.search(body)
    if m:
        return _clean_url(m.group(0))
    for url in ANY_URL_RE.findall(body):
        if any(skip in url for skip in SKIP_URL_HINTS):
            continue
        return _clean_url(url)
    return None


def dispatch_ingest(url: str) -> str:
    """Choose text vs Vision pipeline based on the page content."""
    article_text = text_ingester.fetch_article(url)
    images = image_ingester.fetch_image_urls(url)
    if len(article_text) < SHORT_ARTICLE_THRESHOLD and images:
        print(
            f"  -> Vision pipeline (text={len(article_text)} chars, {len(images)} images)",
            file=sys.stderr,
        )
        return image_ingester.ingest(url)
    print(f"  -> text pipeline (text={len(article_text)} chars)", file=sys.stderr)
    return text_ingester.ingest(url)


def already_ingested(sb, message_id: str) -> bool:
    result = (
        sb.table("email_ingestions")
        .select("id")
        .eq("gmail_message_id", message_id)
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
    sb.table("email_ingestions").insert(
        {
            "gmail_message_id": message_id,
            "recipe_id": recipe_id,
            "status": status,
            "error": error,
            "email_subject": subject,
            "email_from": from_addr,
            "email_received_at": received_at,
        }
    ).execute()


def parse_date(raw: str) -> Optional[str]:
    if not raw:
        return None
    try:
        return parsedate_to_datetime(raw).isoformat()
    except (TypeError, ValueError):
        return None


def run(label: str = "recipes", limit: Optional[int] = None) -> None:
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
        status, data = conn.search(None, "ALL")
        if status != "OK":
            print("Failed to list messages", file=sys.stderr)
            sys.exit(1)
        uids = data[0].split()
        print(f"Found {len(uids)} messages in label {label!r}", file=sys.stderr)
        if limit:
            uids = uids[:limit]
            print(f"Processing first {limit}", file=sys.stderr)

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
            if not url:
                print("  no URL found", file=sys.stderr)
                record_ingestion(
                    sb,
                    message_id=message_id,
                    recipe_id=None,
                    status="skipped",
                    error="no URL found in email body",
                    subject=subject,
                    from_addr=from_addr,
                    received_at=received_at,
                )
                processed += 1
                continue

            print(f"  URL: {url}", file=sys.stderr)
            try:
                recipe_id = dispatch_ingest(url)
                record_ingestion(
                    sb,
                    message_id=message_id,
                    recipe_id=recipe_id,
                    status="ingested",
                    error=None,
                    subject=subject,
                    from_addr=from_addr,
                    received_at=received_at,
                )
                succeeded += 1
            except Exception as e:
                print(f"  failed: {e}", file=sys.stderr)
                record_ingestion(
                    sb,
                    message_id=message_id,
                    recipe_id=None,
                    status="failed",
                    error=str(e)[:1000],
                    subject=subject,
                    from_addr=from_addr,
                    received_at=received_at,
                )
                failed += 1
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
    args = parser.parse_args()
    run(label=args.label, limit=args.limit)
