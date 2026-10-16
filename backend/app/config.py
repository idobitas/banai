"""Application settings loaded from environment variables."""

from functools import lru_cache

from pydantic import SecretStr, ValidationInfo, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "local"
    cors_origins: str = "http://localhost:5173"

    # AI agent (Phase 5). Secrets stay SecretStr so they never appear in reprs or logs.
    openai_api_key: SecretStr | None = None
    openai_chat_model: str = "gpt-5.4-mini"
    proposal_signing_key: SecretStr | None = None

    @field_validator("openai_api_key", "openai_chat_model", "proposal_signing_key", mode="before")
    @classmethod
    def _blank_means_unset(cls, value: object, info: ValidationInfo) -> object:
        """`.env.example` ships `KEY=` lines; an empty value must not override the default."""
        if isinstance(value, str) and not value.strip():
            return cls.model_fields[info.field_name].default
        return value.strip() if isinstance(value, str) else value

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def uses_scripted_agent(self) -> bool:
        """E2E runs use a deterministic scripted agent instead of OpenAI (no cost, no randomness)."""
        return self.app_env == "e2e"


@lru_cache
def get_settings() -> Settings:
    return Settings()
