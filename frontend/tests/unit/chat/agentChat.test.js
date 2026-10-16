import { describe, expect, it, vi } from 'vitest';
import { ApiError, applyProposal, postChat } from '../../../src/api/client.js';
import {
  createChatModel, RATE_LIMITED_MESSAGE, toCardProposal, UNAVAILABLE_MESSAGE,
} from '../../../src/chat/chatModel.js';
import { createStore } from '../../../src/state/store.js';
import { loadCatalog, loadDesign } from '../domain/helpers.js';

const signed = {
  proposalId: 'p1', baseRevision: 1, baseHash: 'a'.repeat(64), signature: 'b'.repeat(64),
  summary: 'Widen it.', changes: [{ title: 'Width', detail: '240.0 cm' }], ops: [{ op: 'update_dimensions', width: 2400 }],
};

describe('chat model with an agent', () => {
  it('sends the conversation, shows thinking, then adds the reply and the proposal', async () => {
    const agent = vi.fn().mockResolvedValue({ reply: 'Here you go.', proposal: signed });
    const model = createChatModel({ getRevision: () => 1, agent });
    const sent = model.send('240 cm wide');
    expect(sent.ok).toBe(true);
    expect(model.isThinking()).toBe(true);
    expect(model.send('again')).toEqual({ ok: false, reason: 'busy' }); // one message at a time
    await sent.pending;
    expect(agent).toHaveBeenCalledWith([{ role: 'user', text: '240 cm wide' }]);
    expect(model.isThinking()).toBe(false);
    expect(model.getMessages().map((m) => [m.role, m.text])).toEqual([['user', '240 cm wide'], ['assistant', 'Here you go.']]);
    expect(model.getProposal()).toEqual(toCardProposal(signed));
    expect(model.getProposal().signed).toBe(signed); // sent back verbatim on Confirm
  });

  it('sends only customer/assistant turns as history, never system notes', async () => {
    const agent = vi.fn().mockResolvedValue({ reply: 'ok', proposal: null });
    const model = createChatModel({ getRevision: () => 1, agent });
    await model.send('one').pending;
    model.setProposal(toCardProposal(signed));
    model.cancelProposal(); // adds a system note
    await model.send('two').pending;
    expect(agent).toHaveBeenLastCalledWith([
      { role: 'user', text: 'one' }, { role: 'assistant', text: 'ok' }, { role: 'user', text: 'two' },
    ]);
  });

  it('shows a friendly note on failures and never a raw error', async () => {
    const failing = createChatModel({ getRevision: () => 1, agent: vi.fn().mockRejectedValue(new ApiError(503, 'AGENT_UNAVAILABLE')) });
    await failing.send('hi').pending;
    expect(failing.getMessages().at(-1)).toMatchObject({ role: 'system', text: UNAVAILABLE_MESSAGE });
    const limited = createChatModel({ getRevision: () => 1, agent: vi.fn().mockRejectedValue(new ApiError(429, 'RATE_LIMITED')) });
    await limited.send('hi').pending;
    expect(limited.getMessages().at(-1).text).toBe(RATE_LIMITED_MESSAGE);
    expect(limited.isThinking()).toBe(false);
  });

  it('reports whether an agent is connected', () => {
    expect(createChatModel({ getRevision: () => 1 }).isConnected()).toBe(false);
    expect(createChatModel({ getRevision: () => 1, agent: vi.fn() }).isConnected()).toBe(true);
  });
});

describe('agent api client', () => {
  const reply = (status, body) => vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });

  it('posts JSON and unwraps the envelope', async () => {
    const fetchImpl = reply(200, { success: true, data: { reply: 'hi', proposal: null } });
    await expect(postChat({ messages: [], design: {}, revision: 1 }, fetchImpl)).resolves.toEqual({ reply: 'hi', proposal: null });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:8000/api/chat');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ messages: [], design: {}, revision: 1 });
  });

  it('throws ApiError with the server code (409 STALE) or NETWORK', async () => {
    await expect(applyProposal({}, reply(409, { success: false, error: { code: 'STALE' } })))
      .rejects.toMatchObject({ status: 409, code: 'STALE' });
    await expect(applyProposal({}, vi.fn().mockRejectedValue(new TypeError('offline'))))
      .rejects.toMatchObject({ status: 0, code: 'NETWORK' });
    await expect(postChat({}, reply(500, null))).rejects.toMatchObject({ status: 500, code: null });
  });
});

describe('store.replaceDesign', () => {
  const catalog = loadCatalog();
  const makeStore = () => createStore({ design: loadDesign('basic'), revision: 1, catalog });

  it('commits a validated server design with its newer revision and keeps a valid selection', () => {
    const store = makeStore();
    store.select('shf_l1');
    const listener = vi.fn();
    store.subscribe(listener);
    const next = structuredClone(loadDesign('basic'));
    next.dimensions.width = 2400;
    next.compartments.forEach((c) => { c.width = Math.floor((2400 - 36 - 36) / 3); });
    next.compartments[2].width += (2400 - 36 - 36) - 3 * Math.floor((2400 - 36 - 36) / 3);
    store.replaceDesign(next, 2);
    expect(store.getState().revision).toBe(2);
    expect(store.getState().design.dimensions.width).toBe(2400);
    expect(store.getState().selection).toEqual({ id: 'shf_l1', kind: 'shelf' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid designs and non-increasing revisions without changing state', () => {
    const store = makeStore();
    const before = store.getState();
    const invalid = structuredClone(loadDesign('basic'));
    invalid.dimensions.width = 1;
    expect(() => store.replaceDesign(invalid, 2)).toThrow();
    expect(() => store.replaceDesign(loadDesign('basic'), 1)).toThrow();
    expect(store.getState()).toBe(before);
  });
});
