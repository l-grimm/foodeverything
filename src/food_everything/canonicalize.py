"""Ingredient name canonicalization via cache + LLM.

Behavior:
- Cache lookup by lower+trim of the raw name.
- Miss → call gpt-4o-mini with the existing canonical list as context.
- Result is written to the cache with source = 'llm'.

The user is an experienced cook who prefers aggressive (false-positive)
matching over conservative (false-negative) matching, which is the bias
baked into the system prompt below.

CLI:
    uv run python -m food_everything.canonicalize backfill
        Walk every distinct raw name in recipe_ingredients + pantry_items,
        ensure each has a cache entry (LLM-fill any misses).

    uv run python -m food_everything.canonicalize lookup "<raw name>"
        Print the canonical for one name (cache or compute).
"""

from __future__ import annotations

import sys
from typing import Iterable, Optional

from pydantic import BaseModel

from food_everything.config import openai_client, supabase_client

CACHE_TABLE = "ingredient_canonical_cache"

CANONICALIZE_SYSTEM = """You normalize ingredient names for a personal recipe app.

The user is an experienced cook who prefers AGGRESSIVE matching. They'd rather see a recipe show "ready" with a substitutable ingredient than "missing" when they could improvise. False positives (loose matches) are acceptable; false negatives (missed obvious matches) are the problem to solve.

BE LIBERAL about collapsing:
- Brand names → generic ("Heinz ketchup" → "ketchup", "Land O Lakes butter" → "butter")
- Prep forms → base ingredient ("chopped onion" → "onion", "minced garlic" → "garlic")
- Substitutable products ("champagne vinegar" / "white wine vinegar" → match; "buffalo sauce" / "hot pepper sauce" → "hot sauce"; "chicken bouillon" / "vegetable stock" → "chicken stock")
- Form variations of the same product ("unsalted butter" → "butter"; "extra-virgin olive oil" / "EVOO" → "olive oil")
- Different romanizations / spellings ("sichuan" / "szechuan"; "chile" / "chili" / "chilli")
- Compound either/or phrasing ("pecorino or parmesan" → "parmesan cheese")

BE CONSERVATIVE about:
- Genuinely different products ("brown sugar" ≠ "white sugar"; "dried oregano" ≠ "fresh oregano" when explicitly named)
- Cross-species defaults ("almond milk" is its own canonical, not just "milk")
- Specialty spices the user has explicitly tracked ("szechuan peppercorn" stays distinct from "black pepper")

GENERAL RULES:
- Singular form: "tomato" not "tomatoes", "egg" not "eggs"
- Lowercase
- If an existing canonical name in the provided list matches reasonably, USE IT EXACTLY. Consistency matters — don't invent a new canonical when an existing one will do.

Output ONLY the canonical name on one line. No quotes, no explanation, no prefix."""


class CanonicalResponse(BaseModel):
    canonical: str


def _key(raw_name: str) -> str:
    return raw_name.strip().lower()


def get_cached(sb, raw_name: str) -> Optional[str]:
    key = _key(raw_name)
    if not key:
        return None
    res = sb.table(CACHE_TABLE).select("canonical_name").eq("raw_name", key).limit(1).execute()
    if res.data:
        return res.data[0]["canonical_name"]
    return None


def set_cached(sb, raw_name: str, canonical: str, source: str = "llm") -> None:
    key = _key(raw_name)
    if not key or not canonical:
        return
    sb.table(CACHE_TABLE).upsert(
        {"raw_name": key, "canonical_name": canonical, "source": source},
        on_conflict="raw_name",
    ).execute()


def list_canonicals(sb, limit: int = 5000) -> list[str]:
    """Return distinct canonical names currently in the cache.

    Passed to the LLM as context so it prefers reusing existing canonicals
    over inventing new ones — consistency is the goal.
    """
    res = sb.table(CACHE_TABLE).select("canonical_name").limit(limit).execute()
    seen: set[str] = set()
    out: list[str] = []
    for row in res.data or []:
        c = row["canonical_name"]
        if c not in seen:
            seen.add(c)
            out.append(c)
    out.sort()
    return out


def canonicalize_with_llm(raw_name: str, existing_canonicals: list[str]) -> str:
    """Ask the LLM to canonicalize one raw name. Falls back to raw on refusal."""
    client = openai_client()
    canonicals_block = ", ".join(existing_canonicals) if existing_canonicals else "(none yet)"
    user_msg = (
        f"Existing canonicals you should prefer to reuse:\n{canonicals_block}\n\n"
        f"Raw name to canonicalize: {raw_name}"
    )
    response = client.beta.chat.completions.parse(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": CANONICALIZE_SYSTEM},
            {"role": "user", "content": user_msg},
        ],
        response_format=CanonicalResponse,
    )
    msg = response.choices[0].message
    if msg.refusal or msg.parsed is None:
        return _key(raw_name)
    canonical = msg.parsed.canonical.strip().lower()
    return canonical or _key(raw_name)


def canonicalize(raw_name: str, sb=None) -> str:
    """Cache-first canonicalization. Returns the canonical for one raw name."""
    if sb is None:
        sb = supabase_client()
    cached = get_cached(sb, raw_name)
    if cached is not None:
        return cached
    existing = list_canonicals(sb)
    canonical = canonicalize_with_llm(raw_name, existing)
    set_cached(sb, raw_name, canonical, source="llm")
    return canonical


def canonicalize_many(raw_names: Iterable[str], sb=None) -> dict[str, str]:
    """Look up or compute canonical for many names. Used by ingesters
    after writing so new ingredient names land in the cache automatically.
    """
    if sb is None:
        sb = supabase_client()
    out: dict[str, str] = {}
    deduped = list({_key(r) for r in raw_names if r})
    if not deduped:
        return out

    # Bulk cache hit lookup
    res = (
        sb.table(CACHE_TABLE)
        .select("raw_name, canonical_name")
        .in_("raw_name", deduped)
        .execute()
    )
    hits = {row["raw_name"]: row["canonical_name"] for row in (res.data or [])}
    out.update(hits)

    misses = [r for r in deduped if r not in hits]
    if not misses:
        return out

    existing = list_canonicals(sb)
    for raw in misses:
        canonical = canonicalize_with_llm(raw, existing)
        set_cached(sb, raw, canonical, source="llm")
        out[raw] = canonical
        if canonical not in existing:
            existing.append(canonical)
    return out


# CLI ---------------------------------------------------------------------

def _cli_lookup(raw: str) -> None:
    sb = supabase_client()
    result = canonicalize(raw, sb)
    print(result)


def _cli_backfill() -> None:
    """Walk all distinct raw names in the corpus, fill any cache misses."""
    sb = supabase_client()

    print("Collecting distinct raw names from recipe_ingredients...", file=sys.stderr)
    ri = sb.table("recipe_ingredients").select("name").limit(20000).execute()
    print(f"  fetched {len(ri.data or [])} rows", file=sys.stderr)

    print("Collecting distinct raw names from pantry_items...", file=sys.stderr)
    pi = sb.table("pantry_items").select("name").limit(10000).execute()
    print(f"  fetched {len(pi.data or [])} rows", file=sys.stderr)

    raws: set[str] = set()
    for r in (ri.data or []):
        if r.get("name"):
            raws.add(_key(r["name"]))
    for r in (pi.data or []):
        if r.get("name"):
            raws.add(_key(r["name"]))
    print(f"Distinct raw names: {len(raws)}", file=sys.stderr)

    # Find which already have cache entries
    existing_keys: set[str] = set()
    batch = list(raws)
    chunk_size = 500
    for i in range(0, len(batch), chunk_size):
        chunk = batch[i : i + chunk_size]
        res = sb.table(CACHE_TABLE).select("raw_name").in_("raw_name", chunk).execute()
        for row in res.data or []:
            existing_keys.add(row["raw_name"])
    misses = sorted(raws - existing_keys)
    print(f"Cache hits: {len(existing_keys)} / misses: {len(misses)}", file=sys.stderr)

    if not misses:
        print("Nothing to backfill — cache is complete.", file=sys.stderr)
        return

    existing_canonicals = list_canonicals(sb)
    for n, raw in enumerate(misses, 1):
        canonical = canonicalize_with_llm(raw, existing_canonicals)
        set_cached(sb, raw, canonical, source="llm")
        if canonical not in existing_canonicals:
            existing_canonicals.append(canonical)
        if n % 25 == 0 or n == len(misses):
            print(f"  [{n}/{len(misses)}] {raw[:40]:40s} -> {canonical}", file=sys.stderr)

    print(f"Done. Filled {len(misses)} cache entries.", file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: python -m food_everything.canonicalize {backfill|lookup <raw>}", file=sys.stderr)
        sys.exit(1)
    cmd = sys.argv[1]
    if cmd == "backfill":
        _cli_backfill()
    elif cmd == "lookup" and len(sys.argv) >= 3:
        _cli_lookup(" ".join(sys.argv[2:]))
    else:
        print("usage: python -m food_everything.canonicalize {backfill|lookup <raw>}", file=sys.stderr)
        sys.exit(1)
