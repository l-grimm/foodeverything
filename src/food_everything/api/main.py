"""Food Everything webhook API.

Local dev:
    uv run uvicorn food_everything.api.main:app --reload --port 8000

Production: containerized via the repo Dockerfile, deployed to Fly.io.
Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY,
WEBHOOK_TOKEN (shared secret matching the iOS Shortcut's Authorization header).
"""

import os

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from pydantic import BaseModel, HttpUrl

from food_everything.ingest.instagram import ingest as ingest_instagram
from food_everything.ingest.pantry import ingest as ingest_pantry
from food_everything.ingest.substack import ingest as ingest_url
from food_everything.ingest.tiktok import ingest as ingest_tiktok

app = FastAPI(title="Food Everything")


class WebhookRequest(BaseModel):
    url: HttpUrl


# Backward-compat alias kept while the iOS Shortcut points at the
# /webhook/tiktok URL. New work should target the per-platform endpoints.
TikTokRequest = WebhookRequest


def _check_auth(authorization: str | None) -> None:
    expected = os.environ.get("WEBHOOK_TOKEN")
    if not expected:
        raise HTTPException(
            status_code=500, detail="server misconfigured: WEBHOOK_TOKEN not set"
        )
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401, detail="missing or malformed Authorization header"
        )
    if authorization.removeprefix("Bearer ").strip() != expected:
        raise HTTPException(status_code=401, detail="invalid token")


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/webhook/tiktok")
def webhook_tiktok(
    req: WebhookRequest, authorization: str | None = Header(default=None)
) -> dict:
    _check_auth(authorization)
    try:
        recipe_id = ingest_tiktok(str(req.url))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ingestion failed: {e}")
    return {"status": "ok", "recipe_id": recipe_id}


@app.post("/webhook/instagram")
def webhook_instagram(
    req: WebhookRequest, authorization: str | None = Header(default=None)
) -> dict:
    _check_auth(authorization)
    try:
        recipe_id = ingest_instagram(str(req.url))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ingestion failed: {e}")
    return {"status": "ok", "recipe_id": recipe_id}


@app.post("/webhook/url")
def webhook_url(
    req: WebhookRequest, authorization: str | None = Header(default=None)
) -> dict:
    """Generic recipe URL: Substack posts, food blogs, NYT Cooking, etc.

    Uses the substack ingester (JSON-LD preferred, article-text fallback).
    Hostname-derived source_platform: substack vs url.
    """
    _check_auth(authorization)
    try:
        recipe_id = ingest_url(str(req.url))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ingestion failed: {e}")
    return {"status": "ok", "recipe_id": recipe_id}


@app.post("/webhook/pantry")
async def webhook_pantry(
    photo: UploadFile = File(...),
    authorization: str | None = Header(default=None),
) -> dict:
    """Grocery photo -> pantry_items rows. Multipart upload (field name: photo).

    iOS Shortcut path: take photo -> POST multipart to this endpoint with
    bearer token -> receive identified items list for confirmation toast.
    """
    _check_auth(authorization)
    image_bytes = await photo.read()
    mime = photo.content_type or "image/jpeg"
    try:
        result = ingest_pantry(image_bytes, mime)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ingestion failed: {e}")
    return {"status": "ok", **result}
