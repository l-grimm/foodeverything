"""Deterministic cooking safeguards. No network or database side effects."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import time

ALLERGY_PROFILE = (
    "Apples and pears; all stone fruits (including peaches, plums, nectarines, "
    "apricots, cherries); almonds specifically, NOT other nuts; mussels specifically, "
    "NOT other shellfish. Include derivatives such as almond flour, marzipan, "
    "apple cider vinegar, fruit juices, extracts and preserves. Do not broaden "
    "these restrictions to unrelated nuts or shellfish. Never assume cooking removes an allergy."
)

# Word boundaries keep pineapple, nutmeg, butternut, etc. from matching.
# Inspect raw names as well: the pantry canonicalizer aliases apple cider vinegar.
ALLERGENS = re.compile(
    r"\b(apples?|pears?|peach(?:es)?|plums?|nectarines?|apricots?|cherr(?:y|ies)|"
    r"almonds?|mussels?|marzipan|frangipane|amaretto|prun(?:e|es)|"
    r"damsons?|greengages?|pluots?|plumcots?|apriums?|mirabelles?|sloes?|"
    r"mango(?:es|s)?|lychees?|litchis?|dates?|jujubes?|umeboshi|"
    r"maraschino|kirsch|calvados|stone[ -]fruits?)\b",
    re.IGNORECASE,
)


def conflicts(text: str) -> list[str]:
    return sorted({m.group(0).lower() for m in ALLERGENS.finditer(text)})


def ingredient_text(ingredient: dict) -> str:
    return " ".join(str(ingredient.get(k) or "") for k in ("name", "name_raw", "prep_note"))


def unresolved(ingredients: list[dict], approved: list[dict]) -> list[dict]:
    replaced = {m["ingredient_id"] for m in approved}
    return [i for i in ingredients if i["id"] not in replaced and conflicts(ingredient_text(i))]


def validate_change(change: dict, ingredients: list[dict]) -> dict:
    ingredient = next((i for i in ingredients if i["id"] == change["ingredient_id"]), None)
    if ingredient is None:
        raise ValueError("Choose an ingredient in this recipe.")
    replacement = str(change["replacement"]).strip()
    note = str(change.get("note") or "").strip()
    if not replacement or len(replacement) > 300 or len(note) > 700:
        raise ValueError("The substitution needs a short, specific replacement.")
    if conflicts(replacement + " " + note):
        raise ValueError("That substitution contains a permanent allergy conflict.")
    return {
        "ingredient_id": ingredient["id"],
        "original": ingredient["name"],
        "replacement": replacement,
        "note": note,
    }


def fingerprint(recipe: dict, ingredients: list[dict]) -> str:
    data = {
        "instructions": recipe.get("instructions"),
        "ingredients": sorted(ingredients, key=lambda item: item["id"]),
    }
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


def sign(state: dict, secret: str) -> str:
    payload = base64.urlsafe_b64encode(json.dumps(state, separators=(",", ":")).encode()).decode()
    signature = hmac.new(
        secret.encode(), ("cooking-v1:" + payload).encode(), hashlib.sha256
    ).hexdigest()
    return payload + "." + signature


def verify(token: str, secret: str, *, allow_expired: bool = False) -> dict:
    try:
        if len(token) > 180_000:
            raise ValueError()
        payload, signature = token.rsplit(".", 1)
        expected = hmac.new(
            secret.encode(), ("cooking-v1:" + payload).encode(), hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError()
        state = json.loads(base64.urlsafe_b64decode(payload))
        if not allow_expired and state["expires"] < time.time():
            raise ValueError()
        return state
    except (ValueError, KeyError, TypeError) as exc:
        raise ValueError("This cooking session has expired. Start a new session.") from exc


def approve(state: dict) -> None:
    """Only called by an explicit approval action, never by model output."""
    pending = state.get("pending")
    if not pending:
        raise ValueError("There is no substitution awaiting approval.")
    state["approved"] = [
        m for m in state["approved"] if m["ingredient_id"] != pending["ingredient_id"]
    ]
    state["approved"].append(pending)
    state["pending"] = None


def advance(step: int, count: int, action: str) -> int:
    if action == "next":
        return min(step + 1, count)
    if action == "back":
        return max(0, step - 1)
    return step
