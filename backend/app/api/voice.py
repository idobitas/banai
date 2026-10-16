"""Voice pipeline endpoints (chained STT -> agent -> TTS). The agent itself is unchanged:
the browser sends the transcript through the normal /api/chat flow.

- POST /api/voice/transcribe: raw audio body (short recording) -> {text, language}
- POST /api/voice/speak: {text, language} -> audio/mpeg

Audio and text go to OpenAI; nothing is stored. Both endpoints are paid, so they are rate
limited per client IP and strictly size-bounded.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from app.agent.language import Language, detect
from app.api.agent import MESSAGE_TEXT_PATTERN, error, get_llm_client
from app.config import Settings, get_settings
from app.services.ratelimit import RateLimiter

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/voice")

MAX_AUDIO_BYTES = 2 * 1024 * 1024  # about a minute of opus; the browser stops at 30 s
MAX_SPEAK_CHARS = 1200
AUDIO_TYPES = {"audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "mp4", "audio/mpeg": "mp3", "audio/wav": "wav"}

# ASSUMPTION: presentation-only reading style, not part of the agent's rules.
TTS_INSTRUCTIONS: dict[str, str] = {
    "he": "Speak Hebrew naturally, calm and clear, at a relaxed pace, like a friendly interior designer.",
    "en": "Speak English naturally, calm and clear, at a relaxed pace, like a friendly interior designer.",
}

MESSAGES: dict[str, dict[str, str]] = {
    "VOICE_UNAVAILABLE": {"he": "הקול עדיין לא מוגדר בשרת הזה.", "en": "Voice is not configured on this server."},
    "RATE_LIMITED": {"he": "יותר מדי בקשות קול. נסה שוב בעוד דקה.", "en": "Too many voice requests. Please try again in a minute."},
    "UNSUPPORTED_AUDIO": {"he": "פורמט ההקלטה לא נתמך.", "en": "This recording format is not supported."},
    "AUDIO_TOO_LARGE": {"he": "ההקלטה ארוכה מדי.", "en": "The recording is too long."},
    "NO_SPEECH": {"he": "לא שמעתי דיבור. נסה שוב.", "en": "I couldn't hear any speech. Please try again."},
    "VOICE_ERROR": {"he": "שירות הקול לא זמין כרגע. נסה שוב בעוד רגע.", "en": "Voice is unavailable right now. Please try again in a moment."},
}

voice_limiter = RateLimiter(limit=30, window_s=60)


def get_voice_limiter() -> RateLimiter:
    return voice_limiter


def _fail(status: int, code: str, language: str):
    return error(status, code, MESSAGES[code][language])


def _guard(request: Request, client: Any, limiter: RateLimiter, language: str):
    if client is None:
        return _fail(503, "VOICE_UNAVAILABLE", language)
    if not limiter.allow(request.client.host if request.client else "unknown"):
        return _fail(429, "RATE_LIMITED", language)
    return None


async def _read_bounded(request: Request) -> bytes | None:
    """The body, or None as soon as it exceeds MAX_AUDIO_BYTES (never buffers more)."""
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_AUDIO_BYTES:
        return None
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_AUDIO_BYTES:
            return None
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/transcribe")
async def transcribe(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    client: Annotated[Any, Depends(get_llm_client)],
    limiter: Annotated[RateLimiter, Depends(get_voice_limiter)],
    language: Language = "he",
):
    if (blocked := _guard(request, client, limiter, language)) is not None:
        return blocked
    mime = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if mime not in AUDIO_TYPES:
        return _fail(415, "UNSUPPORTED_AUDIO", language)
    audio = await _read_bounded(request)
    if audio is None:
        return _fail(413, "AUDIO_TOO_LARGE", language)
    if not audio:
        return _fail(422, "NO_SPEECH", language)
    try:
        # No language is forced: the customer may speak Hebrew or English (detected below).
        result = client.audio.transcriptions.create(model=settings.stt_model, file=(f"speech.{AUDIO_TYPES[mime]}", audio, mime))
    except Exception as exc:  # provider/network failure; never leak details
        logger.warning("transcription failed: %s", type(exc).__name__)
        return _fail(502, "VOICE_ERROR", language)
    text = " ".join(str(getattr(result, "text", "") or "").split())[:2000]
    if not text:
        return _fail(422, "NO_SPEECH", language)
    return {"success": True, "data": {"text": text, "language": detect(text) or language}}


class SpeakRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: Annotated[str, Field(min_length=1, max_length=MAX_SPEAK_CHARS, pattern=MESSAGE_TEXT_PATTERN)]
    language: Language = "he"


@router.post("/speak")
def speak(
    body: SpeakRequest,
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    client: Annotated[Any, Depends(get_llm_client)],
    limiter: Annotated[RateLimiter, Depends(get_voice_limiter)],
):
    if (blocked := _guard(request, client, limiter, body.language)) is not None:
        return blocked
    try:
        result = client.audio.speech.create(
            model=settings.tts_model, voice=settings.tts_voice, input=body.text,
            instructions=TTS_INSTRUCTIONS[body.language], response_format="mp3",
        )
        audio = result.content if hasattr(result, "content") else result.read()
    except Exception as exc:
        logger.warning("speech failed: %s", type(exc).__name__)
        return _fail(502, "VOICE_ERROR", body.language)
    return Response(content=audio, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})
