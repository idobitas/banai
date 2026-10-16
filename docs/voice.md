# Voice (chained pipeline)

> **Scope note:** voice and STT are listed as *excluded* in the product brief (§22) and in `CLAUDE.md`. This feature was built at the team's request on branch `ido-voice`, and needs the project owner's approval before it merges.

## Why a chained pipeline
OpenAI's voice-agents guide describes three architectures: speech-to-speech (Realtime API), full-duplex GPT-Live, and a chained pipeline (STT → agent → TTS). BanAI uses the **chained pipeline**:
- The existing text agent stays the single source of behaviour: the signed proposals, the Confirm gate, the language rules and the persona are untouched.
- The transcript is visible in the chat before the agent answers, and the customer's words go through exactly the same path as typed text.
- Each stage can be replaced on its own.

## Flow
1. **🎤 in the composer:** the browser records with `MediaRecorder` (`src/voice/recorder.js`; opus/webm when available). Recording stops automatically after 30 s, and it can be cancelled.
2. `POST /api/voice/transcribe` receives the raw audio body (≤ 2 MB; webm/ogg/mp4/mpeg/wav only) and calls `gpt-4o-mini-transcribe` without forcing a language. It returns `{text, language}`, where the language comes from the same `detect()` the agent uses.
3. The text is placed in the composer and sent with the normal `submit()`. Writing in the other language therefore switches the chat language, exactly as typing does.
4. **🔊 toggle in the footer** (off by default, remembered per browser): each *new* designer reply is sent to `POST /api/voice/speak {text, language}`, which calls `gpt-4o-mini-tts` with a calm-reading instruction and returns MP3. One reply plays at a time, and recording stops playback. System notes are never read aloud.

Voice controls appear only when the agent is configured, since they use the same OpenAI key.

## Configuration (`backend/.env`, all optional)
| Variable | Default |
|---|---|
| `OPENAI_STT_MODEL` | `gpt-4o-mini-transcribe` |
| `OPENAI_TTS_MODEL` | `gpt-4o-mini-tts` |
| `OPENAI_TTS_VOICE` | `marin` |

These are configurable defaults, not business rules.

## Privacy and limits
- Audio and text go to OpenAI and are not stored by BanAI. The microphone button's tooltip says so, and the microphone track is released as soon as recording stops.
- **Rate limit:** 30 voice requests per minute per client IP, shared by both endpoints (`app/services/ratelimit.py`, in memory). Behind Railway's proxy, run uvicorn with `--proxy-headers`, or every customer shares one limit.
- The body is read in a streaming way and rejected as soon as it exceeds 2 MB. Speech text is capped at 1,200 characters and must be safe text.
- Provider errors return a generic, localized message. Only the exception type is logged.

## Verified live (2026-10-16)
A Hebrew sentence was spoken by `gpt-4o-mini-tts` and transcribed back word for word by `gpt-4o-mini-transcribe` (≈ 4.6 s TTS, 1.7 s STT). English made the same round trip (≈ 1.3 s, 1.1 s).

## Tests
- `backend/tests/test_voice.py`: fake client. Covers language detection, types and sizes, silence, provider errors, the speak payload, the rate limit, and settings.
- `frontend/tests/unit/voice/voice.test.js`: the recorder state machine, the speaker, and the API client.
- `frontend/tests/e2e/voice.spec.js`: a fake microphone with mocked endpoints. Covers record → transcribe → send, an English switch, cancel, silence, read-aloud, and no agent.
