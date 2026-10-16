"""One agent turn: customer messages + current design -> short reply and an optional
signed proposal. The agent never applies anything.

Flow: the LLM either answers in text (e.g. a clarification) or calls propose_changes.
Tool arguments are validated (Pydantic) and dry-run on the authoritative engine. A
rejected call is fed back to the model with the engine's error code/path for up to
MAX_REPAIRS retries; after that the customer gets a short clarification request.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Protocol

from pydantic import ValidationError

from app.agent import signing
from app.agent.prompt import build_instructions, is_joke_turn, reply_language
from app.agent.tools import TOOL_NAME, ProposalArgs, tool_definition
from app.domain.apply import apply_ops
from app.domain.errors import DomainError
from app.domain.ops import parse_ops

MAX_REPAIRS = 2
MAX_HISTORY = 12
MAX_REPLY_CHARS = 1500
FALLBACK_REPLY = "Could you tell me a bit more about the change you want?"


@dataclass(frozen=True)
class ToolCall:
    name: str
    arguments: str


@dataclass(frozen=True)
class LLMTurn:
    text: str = ""
    calls: list[ToolCall] = field(default_factory=list)


class LLMClient(Protocol):
    def respond(self, *, instructions: str, messages: list[dict], tools: list[dict]) -> LLMTurn: ...


class OpenAILLM:
    """Responses API adapter. `store=False`: nothing is kept on OpenAI's side for reuse."""

    def __init__(self, api_key: str, model: str, *, timeout: float = 30.0) -> None:
        from openai import OpenAI  # imported lazily so tests never need network setup

        self._client = OpenAI(api_key=api_key, timeout=timeout, max_retries=1)
        self._model = model

    def respond(self, *, instructions: str, messages: list[dict], tools: list[dict]) -> LLMTurn:
        response = self._client.responses.create(
            model=self._model,
            instructions=instructions,
            input=messages,
            tools=tools,
            tool_choice="auto",
            parallel_tool_calls=False,
            reasoning={"effort": "low"},
            max_output_tokens=4000,
            store=False,
        )
        calls = [ToolCall(item.name, item.arguments) for item in response.output if item.type == "function_call"]
        return LLMTurn(text=response.output_text or "", calls=calls)


def _history(messages: list[dict]) -> list[dict]:
    return [{"role": m["role"], "content": m["text"]} for m in messages[-MAX_HISTORY:]]


def _rejection(error: Exception, raw_arguments: str) -> str:
    if isinstance(error, DomainError):
        reason = f"{error.code} at {error.path}: {error.message}"
    elif isinstance(error, ValidationError):
        first = error.errors()[0]
        reason = f"invalid arguments at {'.'.join(str(p) for p in first['loc']) or 'root'}: {first['type']}"
    else:
        reason = "arguments were not valid JSON"
    return (
        f"Your {TOOL_NAME} call was rejected ({reason}). Your call was: {raw_arguments[:4000]}\n"
        f"Fix it and call {TOOL_NAME} again, or ask the customer one short question."
    )


def run_turn(
    llm: LLMClient, *, messages: list[dict], design: dict, revision: int, catalog: dict, signing_key: bytes
) -> dict:
    """`design` must already be canonical (apply_ops(design, [], catalog))."""
    user_turns = sum(1 for m in messages if m["role"] == "user")
    language = reply_language(messages[-1]["text"])
    instructions = build_instructions(design, catalog, joke=is_joke_turn(user_turns), language=language)
    conversation = _history(messages)

    for _ in range(MAX_REPAIRS + 1):
        turn = llm.respond(instructions=instructions, messages=conversation, tools=[tool_definition()])
        call = next((c for c in turn.calls if c.name == TOOL_NAME), None)
        if call is None:
            return {"reply": turn.text.strip()[:MAX_REPLY_CHARS] or FALLBACK_REPLY, "proposal": None}
        try:
            args = ProposalArgs.model_validate_json(call.arguments)
            ops = [op.model_dump(by_alias=True, exclude_none=True) for op in parse_ops(args.ops)]
            apply_ops(design, ops, catalog)  # dry run on the engine's own copy; raises on any problem
        except (ValidationError, DomainError, json.JSONDecodeError) as error:
            conversation = [*conversation, {"role": "developer", "content": _rejection(error, call.arguments)}]
            continue
        reply = (turn.text.strip() or args.reply.strip() or args.summary)[:MAX_REPLY_CHARS]
        return {"reply": reply, "proposal": _proposal(args, ops, design, revision, signing_key)}

    return {"reply": FALLBACK_REPLY, "proposal": None}


def _proposal(args: ProposalArgs, ops: list, design: dict, revision: int, key: bytes) -> dict:
    proposal_id = signing.new_proposal_id()
    base_hash = signing.design_hash(design)
    return {
        "proposalId": proposal_id,
        "baseRevision": revision,
        "baseHash": base_hash,
        "summary": args.summary,
        "changes": [change.model_dump() for change in args.changes],
        "ops": ops,
        "signature": signing.sign(key, proposal_id, ops, revision, base_hash),
    }
