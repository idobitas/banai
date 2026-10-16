"""Manual live evaluation of the agent against the real OpenAI model (costs a few cents).

Run from backend/:  uv run python scripts/agent_eval.py
Needs OPENAI_API_KEY in backend/.env. Prints each case with simple checks; it never
prints the key. Not part of the automated test suite (non-deterministic, paid).
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agent.service import OpenAILLM, run_turn  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.domain.apply import apply_ops  # noqa: E402
from app.domain.catalog import load_catalog  # noqa: E402
from app.domain.defaults import basic_wardrobe  # noqa: E402

FILLER = [{"role": "user", "text": "hi"}, {"role": "assistant", "text": "Hi! What would you like to change?"}]

CASES = [
    ("full description", [], "240 cm wide, 260 cm tall, white, three compartments", "proposal"),
    ("vague request", [], "make it nicer", "text"),
    ("off topic", [], "What's the weather in Tel Aviv tomorrow?", "text"),
    ("hebrew", [], "תוסיף מדף אחד בתא האמצעי בגובה 150 ס\"מ", "proposal"),
    ("single change", [], "change the doors to walnut", "proposal"),
    ("manufacturing claim", [], "Is this ready to send to the factory?", "text"),
    ("joke turn (4th message)", FILLER * 3, "add a drawer at the bottom of the left compartment", "proposal"),
]

HEBREW = re.compile(r"[֐-׿]")
# English replies must not contain accented Latin letters (catches Spanish, Dutch, French...).
FOREIGN_LATIN = re.compile(r"[À-ÖØ-öø-ÿĀ-ž]")
ENGLISH_WORDS = re.compile(r"\b(the|a|to|and|you|your|it|i|can|with|is)\b", re.IGNORECASE)


def same_language(text: str, reply: str) -> bool:
    if HEBREW.search(text):
        return bool(HEBREW.search(reply))
    return not HEBREW.search(reply) and not FOREIGN_LATIN.search(reply) and bool(ENGLISH_WORDS.search(reply))


def main() -> int:
    settings = get_settings()
    if settings.openai_api_key is None or settings.proposal_signing_key is None:
        print("OPENAI_API_KEY and PROPOSAL_SIGNING_KEY must be set in backend/.env")
        return 1
    llm = OpenAILLM(settings.openai_api_key.get_secret_value(), settings.openai_chat_model)
    catalog = load_catalog()
    design = apply_ops(basic_wardrobe(), [], catalog)
    key = settings.proposal_signing_key.get_secret_value().encode()
    print(f"model: {settings.openai_chat_model}\n")
    for name, history, text, expect in CASES:
        messages = [*history, {"role": "user", "text": text}]
        result = run_turn(llm, messages=messages, design=design, revision=1, catalog=catalog, signing_key=key)
        reply, proposal = result["reply"], result["proposal"]
        checks = {
            "expected": expect == "any" or (expect == "proposal") == (proposal is not None),
            "short (<=350 chars)": len(reply) <= 350,
            "language": same_language(text, reply),
        }
        if name.startswith("joke"):  # the joke itself is judged by reading the reply
            checks["room for a joke (2+ sentences)"] = len(re.findall(r"[.!?](\s|$)", reply)) >= 2
        if proposal:
            checks["ops apply"] = bool(apply_ops(design, proposal["ops"], catalog))
        status = "PASS" if all(checks.values()) else "CHECK"
        print(f"[{status}] {name}\n  you:   {text}\n  agent: {reply}")
        if proposal:
            print(f"  ops:   {proposal['ops']}")
        print(f"  checks: {checks}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
