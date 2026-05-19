FROM python:3.12-slim

WORKDIR /app

# uv: fast Python deps installer
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Python deps first for layer caching
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# Chromium + system deps for Playwright (TikTok caption fetching)
RUN .venv/bin/playwright install --with-deps chromium

COPY src ./src

ENV PORT=8000
EXPOSE 8000

CMD [".venv/bin/uvicorn", "food_everything.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
