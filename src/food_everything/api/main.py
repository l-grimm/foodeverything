"""Food Everything webhook API.

Local dev:
    uv run uvicorn food_everything.api.main:app --reload --port 8000

Production: containerized via the repo Dockerfile, deployed to Fly.io.
Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY,
WEBHOOK_TOKEN (shared secret matching the iOS Shortcut's Authorization header).
"""

import os

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, HttpUrl

from food_everything.ingest.tiktok import ingest as ingest_tiktok

app = FastAPI(title="Food Everything")


class TikTokRequest(BaseModel):
    url: HttpUrl


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
    req: TikTokRequest, authorization: str | None = Header(default=None)
) -> dict:
    _check_auth(authorization)
    try:
        recipe_id = ingest_tiktok(str(req.url))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ingestion failed: {e}")
    return {"status": "ok", "recipe_id": recipe_id}
