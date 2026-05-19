FROM python:3.12-slim

WORKDIR /app

# uv: fast Python deps installer
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Deps only first (no project) — cached unless pyproject/lock change
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Source and final project install (installs food-everything package into venv)
COPY src ./src
RUN uv sync --frozen --no-dev

ENV PORT=8000
EXPOSE 8000

CMD [".venv/bin/uvicorn", "food_everything.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
