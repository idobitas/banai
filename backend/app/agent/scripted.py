"""Deterministic stand-in for the LLM, used only when APP_ENV=e2e (Playwright).

It understands two phrases, enough to drive the browser flows without cost or
randomness: "<n> cm wide" / "<n> m wide" proposes a width change; anything else gets a
short clarification question.
"""

from __future__ import annotations

import json
import re

from app.agent.service import LLMTurn, ToolCall
from app.agent.tools import TOOL_NAME

_WIDTH = re.compile(r"(\d+(?:\.\d+)?)\s*(cm|m)\s+wide", re.IGNORECASE)


class ScriptedLLM:
    def respond(self, *, instructions: str, messages: list[dict], tools: list[dict]) -> LLMTurn:
        last = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
        match = _WIDTH.search(last)
        if not match:
            return LLMTurn(text="How wide should the wardrobe be?")
        value, unit = float(match.group(1)), match.group(2).lower()
        width_mm = round(value * (1000 if unit == "m" else 10))
        arguments = {
            "summary": f"Set the width to {width_mm / 10:.1f} cm.",
            "changes": [{"title": "Width", "detail": f"{width_mm / 10:.1f} cm"}],
            "ops": [{"op": "update_dimensions", "width": width_mm}],
        }
        return LLMTurn(text="Here is a proposal.", calls=[ToolCall(TOOL_NAME, json.dumps(arguments))])
