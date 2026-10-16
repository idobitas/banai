import { API_BASE_URL } from '../config.js';

async function getJson(path, fetchImpl) {
  if (!API_BASE_URL) throw new Error('The API base URL is not configured');
  const response = await fetchImpl(`${API_BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`Request to ${path} failed with status ${response.status}`);
  }
  const body = await response.json();
  if (!body || body.success !== true) {
    throw new Error(`Request to ${path} returned an unsuccessful response`);
  }
  return body.data;
}

/** A failed API call; `code` is the server's error code (e.g. 'STALE'), when it sent one. */
export class ApiError extends Error {
  constructor(status, code) {
    super(`API request failed (${status}${code ? ` ${code}` : ''})`);
    this.status = status;
    this.code = code ?? null;
  }
}

async function postJson(path, payload, fetchImpl) {
  if (!API_BASE_URL) throw new Error('The API base URL is not configured');
  let response;
  try {
    response = await fetchImpl(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new ApiError(0, 'NETWORK');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.success !== true) {
    throw new ApiError(response.status, typeof body?.error?.code === 'string' ? body.error.code : null);
  }
  return body.data;
}

/** One agent turn: { messages: [{ role, text }], design, revision } -> { reply, proposal | null }. */
export const postChat = (payload, fetchImpl = fetch) => postJson('/api/chat', payload, fetchImpl);

/** Server-verified apply of a signed proposal -> { design, revision }. Throws ApiError (409 STALE). */
export const applyProposal = (payload, fetchImpl = fetch) => postJson('/api/proposals/apply', payload, fetchImpl);

export const getHealth =(fetchImpl = fetch) => getJson('/api/health', fetchImpl).then((data) => ({ success: true, data }));

export const getCatalog = (fetchImpl = fetch) => getJson('/api/catalog', fetchImpl);

/** Returns { design, revision } for the predefined basic wardrobe. */
export const getDefaultDesign = (fetchImpl = fetch) => getJson('/api/designs/default', fetchImpl);
