"""Application settings loaded from environment variables."""

import secrets
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

# ASSUMPTION: a configurable default; override with OPENAI_CHAT_MODEL per environment.
DEFAULT_CHAT_MODEL = "gpt-5.4-mini"
# ASSUMPTION: configurable voice defaults (speech-to-text, text-to-speech and its voice).
DEFAULT_STT_MODEL = "gpt-4o-mini-transcribe"
DEFAULT_TTS_MODEL = "gpt-4o-mini-tts"
DEFAULT_TTS_VOICE = "marin"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "local"
    cors_origins: str = "http://localhost:5173"
    openai_api_key: str = ""
    openai_chat_model: str = ""
    proposal_signing_key: str = ""
    openai_stt_model: str = ""
    openai_tts_model: str = ""
    openai_tts_voice: str = ""

    @property
    def stt_model(self) -> str:
        return self.openai_stt_model.strip() or DEFAULT_STT_MODEL

    @property
    def tts_model(self) -> str:
        return self.openai_tts_model.strip() or DEFAULT_TTS_MODEL

    @property
    def tts_voice(self) -> str:
        return self.openai_tts_voice.strip() or DEFAULT_TTS_VOICE

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def chat_model(self) -> str:
        return self.openai_chat_model.strip() or DEFAULT_CHAT_MODEL

    @property
    def agent_enabled(self) -> bool:
        return bool(self.openai_api_key.strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()


@lru_cache
def get_signing_key() -> bytes:
    """The HMAC key for proposals. Required outside local development.

    Locally (APP_ENV=local) a missing key falls back to a random per-process key, so
    proposals simply expire on restart; every other environment must configure one.
    """
    settings = get_settings()
    key = settings.proposal_signing_key.strip()
    if key:
        return key.encode()
    if settings.app_env == "local":
        return secrets.token_bytes(32)
    raise RuntimeError("PROPOSAL_SIGNING_KEY is not configured")
