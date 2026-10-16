// Voice endpoints (chained pipeline): speech -> text, and text -> speech. The agent itself is
// reached through the normal chat flow with the transcript.
import { ApiError } from '../api/client.js';
import { API_BASE_URL } from '../config.js';

async function failure(response) {
  let error = null;
  try {
    error = (await response.json())?.error ?? null;
  } catch {
    // non-JSON error body
  }
  return new ApiError(error?.message ?? `Voice request failed with status ${response.status}`, {
    status: response.status, code: error?.code ?? 'HTTP_ERROR',
  });
}

async function call(path, init, fetchImpl) {
  if (!API_BASE_URL) throw new Error('The API base URL is not configured');
  let response;
  try {
    response = await fetchImpl(`${API_BASE_URL}${path}`, init);
  } catch {
    throw new ApiError('Could not reach the design service.');
  }
  if (!response.ok) throw await failure(response);
  return response;
}

/** Recording (Blob) -> { text, language }. `language` is only a fallback for text without letters. */
export async function transcribe(blob, language, fetchImpl = fetch) {
  const response = await call(`/api/voice/transcribe?language=${encodeURIComponent(language)}`, {
    method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob,
  }, fetchImpl);
  const body = await response.json();
  if (!body?.success || typeof body.data?.text !== 'string') throw new ApiError('Unexpected transcription response', { status: 200, code: 'HTTP_ERROR' });
  return body.data;
}

/** Text -> MP3 Blob. */
export async function speak(text, language, fetchImpl = fetch) {
  const response = await call('/api/voice/speak', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, language }),
  }, fetchImpl);
  return response.blob();
}
