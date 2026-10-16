"""The single agent tool, `propose_changes`, and the parsing of its arguments.

The `ops` item schema is derived from the domain's op union (app/domain/ops.py), so the
model sees exactly the protocol the engine accepts. The schema only guides the model:
the arguments are always re-validated by Pydantic and dry-run by the engine.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from app.domain.ops import MAX_OPS, Op

TOOL_NAME = "propose_changes"
MAX_CHANGES = 30

# JSON-Schema keys OpenAI tools don't need (or don't understand) in Pydantic's output.
_DROP = {"discriminator", "title", "default"}
_RENAME = {"ge": "minimum", "le": "maximum", "oneOf": "anyOf"}


def _clean(node: Any, *, is_properties: bool = False) -> Any:
    if isinstance(node, dict):
        if is_properties:  # keys here are field names (which could be "title"), not schema keywords
            return {key: _clean(value) for key, value in node.items()}
        return {
            _RENAME.get(key, key): _clean(value, is_properties=key == "properties")
            for key, value in node.items()
            if key not in _DROP
        }
    if isinstance(node, list):
        return [_clean(value) for value in node]
    return node


@lru_cache
def tool_definition() -> dict:
    op_schema = _clean(TypeAdapter(Op).json_schema(by_alias=True))
    defs = op_schema.pop("$defs")
    return {
        "type": "function",
        "name": TOOL_NAME,
        "description": "Propose changes to the current wardrobe design. Nothing is applied until the customer confirms.",
        "strict": False,
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "required": ["reply", "summary", "changes", "ops"],
            "properties": {
                "reply": {"type": "string", "description": "Short chat message to the customer, customer's language."},
                "summary": {"type": "string", "description": "One sentence, customer's language."},
                "changes": {
                    "type": "array",
                    "maxItems": MAX_CHANGES,
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["title", "detail"],
                        "properties": {"title": {"type": "string"}, "detail": {"type": "string"}},
                    },
                },
                "ops": {"type": "array", "minItems": 1, "maxItems": MAX_OPS, "items": op_schema},
            },
            "$defs": defs,
        },
    }


class Change(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: Annotated[str, Field(min_length=1, max_length=80)]
    detail: Annotated[str, Field(max_length=240)]


class ProposalArgs(BaseModel):
    """Tool arguments. `ops` stays raw here: the domain engine parses and validates it."""

    model_config = ConfigDict(extra="forbid")
    reply: Annotated[str, Field(max_length=600)] = ""
    summary: Annotated[str, Field(min_length=1, max_length=400)]
    changes: Annotated[list[Change], Field(max_length=MAX_CHANGES)]
    ops: Annotated[list[Any], Field(min_length=1, max_length=MAX_OPS)]
