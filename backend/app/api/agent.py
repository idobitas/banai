"""Agent endpoints: POST /api/chat (reply + optional signed proposal) and
POST /api/proposals/apply (verify, reject stale, apply on the authoritative engine)."""

from __future__ import annotations

import logging
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from app.agent import signing
from app.agent.ratelimit import RateLimiter
from app.agent.service import LLMClient, OpenAILLM, run_turn
from app.config import Settings, get_settings
from app.domain.apply import apply_ops
from app.domain.catalog import load_catalog
from app.domain.errors import DomainError

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")

MAX_MESSAGES = 50
MAX_TEXT = 2000
MAX_REVISION = 1_000_000_000

chat_limiter = RateLimiter(limit=20, window_s=60)


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["user", "assistant"]
    text: Annotated[str, Field(min_length=1, max_length=MAX_TEXT)]


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    messages: Annotated[list[ChatMessage], Field(min_length=1, max_length=MAX_MESSAGES)]
    design: dict
    revision: Annotated[int, Field(ge=1, le=MAX_REVISION)]


class SignedProposal(BaseModel):
    # Display fields (summary, changes) may come along; only the signed fields matter here.
    model_config = ConfigDict(extra="ignore")
    proposalId: Annotated[str, Field(min_length=1, max_length=64)]
    baseRevision: Annotated[int, Field(ge=1, le=MAX_REVISION)]
    baseHash: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
    ops: Annotated[list, Field(min_length=1, max_length=100)]
    signature: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]


class ApplyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    design: dict
    revision: Annotated[int, Field(ge=1, le=MAX_REVISION)]
    proposal: SignedProposal


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"success": False, "error": {"code": code, "message": message}})


UNAVAILABLE = "The design assistant is unavailable right now. Please try again in a moment."


def get_llm(settings: Annotated[Settings, Depends(get_settings)]) -> LLMClient | None:
    if settings.uses_scripted_agent:
        from app.agent.scripted import ScriptedLLM

        return ScriptedLLM()
    if settings.openai_api_key is None:
        return None
    return OpenAILLM(settings.openai_api_key.get_secret_value(), settings.openai_chat_model)


def get_signing_key(settings: Annotated[Settings, Depends(get_settings)]) -> bytes | None:
    key = settings.proposal_signing_key
    return key.get_secret_value().encode("utf-8") if key and key.get_secret_value() else None


def get_limiter() -> RateLimiter:
    return chat_limiter


@router.post("/chat")
def chat(
    body: ChatRequest,
    request: Request,
    llm: Annotated[LLMClient | None, Depends(get_llm)],
    key: Annotated[bytes | None, Depends(get_signing_key)],
    limiter: Annotated[RateLimiter, Depends(get_limiter)],
):
    if not limiter.allow(request.client.host if request.client else "unknown"):
        return _error(429, "RATE_LIMITED", "Too many messages. Please wait a minute.")
    if llm is None or key is None:
        return _error(503, "AGENT_UNAVAILABLE", UNAVAILABLE)
    if body.messages[-1].role != "user":
        return _error(422, "INVALID_REQUEST", "The last message must come from the customer.")
    catalog = load_catalog()
    try:
        design = apply_ops(body.design, [], catalog)  # parse + full validation
    except DomainError as error:
        return _error(422, error.code, "The current design is not valid.")
    try:
        result = run_turn(
            llm,
            messages=[m.model_dump() for m in body.messages],
            design=design,
            revision=body.revision,
            catalog=catalog,
            signing_key=key,
        )
    except Exception as error:  # provider/network failures; never leak details (or the key) anywhere
        logger.warning("agent turn failed: %s", type(error).__name__)
        return _error(503, "AGENT_UNAVAILABLE", UNAVAILABLE)
    return {"success": True, "data": result}


@router.post("/proposals/apply")
def apply_proposal(body: ApplyRequest, key: Annotated[bytes | None, Depends(get_signing_key)]):
    if key is None:
        return _error(503, "AGENT_UNAVAILABLE", UNAVAILABLE)
    proposal = body.proposal
    if not signing.verify(key, proposal.signature, proposal.proposalId, proposal.ops, proposal.baseRevision, proposal.baseHash):
        return _error(400, "INVALID_PROPOSAL", "This proposal could not be verified.")
    catalog = load_catalog()
    try:
        design = apply_ops(body.design, [], catalog)
    except DomainError as error:
        return _error(422, error.code, "The current design is not valid.")
    if body.revision != proposal.baseRevision or signing.design_hash(design) != proposal.baseHash:
        return _error(409, "STALE", "The design changed after this proposal was made.")
    try:
        updated = apply_ops(design, proposal.ops, catalog)
    except DomainError as error:
        return _error(422, error.code, "The proposal no longer applies to this design.")
    return {"success": True, "data": {"design": updated, "revision": body.revision + 1}}
