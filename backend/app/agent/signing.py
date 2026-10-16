"""Stateless signed proposals (ADR-002).

The server stores nothing between /chat and /apply. A proposal carries an HMAC over
(proposalId, ops, baseRevision, baseHash), so the client can hold it but not alter it,
and /apply can tell whether the design it receives is still the one the proposal was
made for.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets


def canonical_json(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def design_hash(design: dict) -> str:
    """SHA-256 of a canonical design (call it on the engine's parsed form)."""
    return hashlib.sha256(canonical_json(design)).hexdigest()


def new_proposal_id() -> str:
    return secrets.token_urlsafe(12)


def _payload(proposal_id: str, ops: list, base_revision: int, base_hash: str) -> bytes:
    return canonical_json({"proposalId": proposal_id, "ops": ops, "baseRevision": base_revision, "baseHash": base_hash})


def sign(key: bytes, proposal_id: str, ops: list, base_revision: int, base_hash: str) -> str:
    return hmac.new(key, _payload(proposal_id, ops, base_revision, base_hash), hashlib.sha256).hexdigest()


def verify(key: bytes, signature: str, proposal_id: str, ops: list, base_revision: int, base_hash: str) -> bool:
    expected = sign(key, proposal_id, ops, base_revision, base_hash)
    return hmac.compare_digest(expected, signature)
