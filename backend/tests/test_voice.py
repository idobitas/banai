"""Voice endpoints with a fake OpenAI client: no network, no cost."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.api.agent import get_llm_client
from app.api.voice import MAX_AUDIO_BYTES, MAX_SPEAK_CHARS, TTS_INSTRUCTIONS, get_voice_limiter
from app.config import DEFAULT_STT_MODEL, DEFAULT_TTS_MODEL, DEFAULT_TTS_VOICE, Settings
from app.main import create_app
from app.services.ratelimit import RateLimiter

AUDIO = b"\x1aE\xdf\xa3fake-webm-bytes"


class FakeVoiceClient:
    """The SDK shape used here: client.audio.transcriptions.create / client.audio.speech.create."""

    def __init__(self, text="Add a shelf at 100 cm", mp3=b"ID3fake-mp3", error: Exception | None = None):
        self.text, self.mp3, self.error = text, mp3, error
        self.calls: list[tuple[str, dict]] = []
        self.audio = SimpleNamespace(
            transcriptions=SimpleNamespace(create=self._transcribe),
            speech=SimpleNamespace(create=self._speak),
        )

    def _transcribe(self, **kwargs):
        self.calls.append(("transcribe", kwargs))
        if self.error:
            raise self.error
        return SimpleNamespace(text=self.text)

    def _speak(self, **kwargs):
        self.calls.append(("speak", kwargs))
        if self.error:
            raise self.error
        return SimpleNamespace(content=self.mp3)


@pytest.fixture
def make_client():
    apps = []

    def build(fake=None, limiter=None):
        app = create_app()
        app.dependency_overrides[get_llm_client] = lambda: fake
        app.dependency_overrides[get_voice_limiter] = lambda: limiter or RateLimiter(limit=100, window_s=60)
        apps.append(app)
        return TestClient(app)

    yield build
    for app in apps:
        app.dependency_overrides.clear()


def post_audio(client, body=AUDIO, content_type="audio/webm;codecs=opus", language="he"):
    return client.post(f"/api/voice/transcribe?language={language}", content=body, headers={"Content-Type": content_type})


# --- transcribe -------------------------------------------------------------------------------


def test_transcribes_english_and_detects_the_language(make_client):
    fake = FakeVoiceClient(text="  Add a shelf\nat 100 cm  ")
    response = post_audio(make_client(fake))
    assert response.status_code == 200
    assert response.json() == {"success": True, "data": {"text": "Add a shelf at 100 cm", "language": "en"}}
    name, kwargs = fake.calls[0]
    assert name == "transcribe" and kwargs["model"] == DEFAULT_STT_MODEL
    assert kwargs["file"] == ("speech.webm", AUDIO, "audio/webm")
    assert "language" not in kwargs  # the customer may speak either language


def test_hebrew_speech_is_reported_as_hebrew(make_client):
    response = post_audio(make_client(FakeVoiceClient(text="תוסיף מדף")), language="en")
    assert response.json()["data"] == {"text": "תוסיף מדף", "language": "he"}


def test_text_without_letters_falls_back_to_the_chosen_language(make_client):
    assert post_audio(make_client(FakeVoiceClient(text="240")), language="en").json()["data"]["language"] == "en"


def test_rejects_unsupported_types_oversize_and_empty_audio(make_client):
    client = make_client(FakeVoiceClient())
    assert post_audio(client, content_type="text/plain").status_code == 415
    assert post_audio(client, content_type="application/json").status_code == 415
    too_big = post_audio(client, body=b"x" * (MAX_AUDIO_BYTES + 1))
    assert too_big.status_code == 413 and too_big.json()["error"]["code"] == "AUDIO_TOO_LARGE"
    assert post_audio(client, body=b"").status_code == 422


def test_silence_is_no_speech(make_client):
    response = post_audio(make_client(FakeVoiceClient(text="   ")), language="en")
    assert response.status_code == 422
    assert response.json()["error"] == {"code": "NO_SPEECH", "message": "I couldn't hear any speech. Please try again."}


def test_provider_errors_are_generic_and_never_leak(make_client):
    response = post_audio(make_client(FakeVoiceClient(error=RuntimeError("boom sk-secret"))))
    assert response.status_code == 502
    assert "sk-" not in response.text and "boom" not in response.text


def test_unavailable_without_a_key(make_client):
    assert post_audio(make_client(None)).status_code == 503
    assert make_client(None).post("/api/voice/speak", json={"text": "hi", "language": "en"}).status_code == 503


# --- speak ---------------------------------------------------------------------------------------


def test_speaks_text_as_mp3_with_the_language_instruction(make_client):
    fake = FakeVoiceClient(mp3=b"ID3fake-mp3")
    response = make_client(fake).post("/api/voice/speak", json={"text": "אוסיף מדף", "language": "he"})
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/mpeg"
    assert response.headers["cache-control"] == "no-store"
    assert response.content == b"ID3fake-mp3"
    _, kwargs = fake.calls[0]
    assert kwargs == {
        "model": DEFAULT_TTS_MODEL, "voice": DEFAULT_TTS_VOICE, "input": "אוסיף מדף",
        "instructions": TTS_INSTRUCTIONS["he"], "response_format": "mp3",
    }


def test_speak_validates_its_input(make_client):
    client = make_client(FakeVoiceClient())
    assert client.post("/api/voice/speak", json={"text": "", "language": "en"}).status_code == 422
    assert client.post("/api/voice/speak", json={"text": "x" * (MAX_SPEAK_CHARS + 1)}).status_code == 422
    assert client.post("/api/voice/speak", json={"text": "hi", "language": "fr"}).status_code == 422
    assert client.post("/api/voice/speak", json={"text": "hi‮", "language": "en"}).status_code == 422  # bidi override
    assert client.post("/api/voice/speak", json={"text": "hi", "extra": 1}).status_code == 422


def test_speak_provider_error_is_generic(make_client):
    response = make_client(FakeVoiceClient(error=RuntimeError("down"))).post("/api/voice/speak", json={"text": "hi", "language": "en"})
    assert response.status_code == 502 and response.json()["error"]["code"] == "VOICE_ERROR"


# --- limits and configuration ----------------------------------------------------------------------


def test_voice_is_rate_limited_across_both_endpoints(make_client):
    client = make_client(FakeVoiceClient(), limiter=RateLimiter(limit=2, window_s=60))
    assert post_audio(client).status_code == 200
    assert client.post("/api/voice/speak", json={"text": "hi", "language": "en"}).status_code == 200
    blocked = post_audio(client, language="en")
    assert blocked.status_code == 429 and blocked.json()["error"]["code"] == "RATE_LIMITED"


def test_rate_limiter_window_and_bounded_memory():
    now = [0.0]
    limiter = RateLimiter(limit=1, window_s=10, max_keys=4, clock=lambda: now[0])
    assert limiter.allow("a") and not limiter.allow("a")
    now[0] = 10.0
    assert limiter.allow("a")
    for key in "bcdefg":
        limiter.allow(key)
    assert len(limiter._hits) <= 4


def test_voice_settings_default_and_override():
    settings = Settings(_env_file=None)
    assert (settings.stt_model, settings.tts_model, settings.tts_voice) == (DEFAULT_STT_MODEL, DEFAULT_TTS_MODEL, DEFAULT_TTS_VOICE)
    custom = Settings(_env_file=None, openai_stt_model="gpt-transcribe", openai_tts_voice=" cedar ")
    assert custom.stt_model == "gpt-transcribe" and custom.tts_voice == "cedar"
