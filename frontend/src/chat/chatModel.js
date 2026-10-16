// Pure chat view-model (no DOM). With an `agent` (Phase 5), a customer message is sent with the
// conversation so far and the agent's reply (and optional proposal) is added. Without one, a sent
// message gets an honest "not connected" reply. Nothing here ever applies a change to the design.
//
// A proposal is { id, baseRevision, summary, changes: [{ title, detail }], signed }. `signed` is the
// server's signed proposal, sent back verbatim on Confirm. It is kept apart from the committed
// design and is only ever "pending" or "stale" (the design changed after it was made).

export const NOT_CONNECTED_MESSAGE =
  "The AI agent isn't connected yet (planned for Phase 5). You can design manually in the Properties panel.";
export const STALE_MESSAGE = 'Design changed. Ask the agent to re-propose.';
export const UNAVAILABLE_MESSAGE = 'The design assistant is unavailable right now. Please try again in a moment.';
export const RATE_LIMITED_MESSAGE = 'Too many messages. Please wait a minute.';
export const MAX_MESSAGE_LENGTH = 2000;

// Starter prompts shown before the first message. Picking one only fills the composer.
export const SUGGESTIONS = Object.freeze([
  '240 cm wide, 260 cm tall, white, three compartments',
  'Tall wardrobe with sliding doors and a hanging rail',
  'Four shelves on the left, hanging in the middle, three drawers on the right',
]);

export function proposalStatus(proposal, currentRevision) {
  if (!proposal) return null;
  return proposal.baseRevision === currentRevision ? 'pending' : 'stale';
}

/** Map a server proposal to the card's shape; the signed original travels along untouched. */
export function toCardProposal(signed) {
  return Object.freeze({
    id: signed.proposalId,
    baseRevision: signed.baseRevision,
    summary: signed.summary,
    changes: signed.changes,
    signed,
  });
}

const errorMessage = (error) => (error?.status === 429 ? RATE_LIMITED_MESSAGE : UNAVAILABLE_MESSAGE);

/**
 * `agent(history)` (optional) resolves to { reply, proposal | null }; `history` is the
 * customer/assistant conversation as [{ role, text }], ending with the new message.
 */
export function createChatModel({ getRevision, agent = null }) {
  let nextId = 1;
  let proposal = null;
  let thinking = false;
  const messages = [];
  const listeners = new Set();
  const notify = () => listeners.forEach((listener) => listener());
  const push = (role, text) => {
    messages.push(Object.freeze({ id: nextId, role, text }));
    nextId += 1;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getMessages: () => [...messages],
    getProposal: () => proposal,
    getProposalStatus: () => proposalStatus(proposal, getRevision()),
    isThinking: () => thinking,
    isConnected: () => agent !== null,

    /**
     * A customer message. Returns { ok } (plus `pending`, a promise settled when the agent has
     * answered) and never touches the design. One message at a time: 'busy' while waiting.
     */
    send(rawText) {
      const text = String(rawText ?? '').trim();
      if (!text) return { ok: false, reason: 'empty' };
      if (text.length > MAX_MESSAGE_LENGTH) return { ok: false, reason: 'too-long' };
      if (thinking) return { ok: false, reason: 'busy' };
      push('user', text);
      if (!agent) {
        push('system', NOT_CONNECTED_MESSAGE);
        notify();
        return { ok: true };
      }
      thinking = true;
      notify();
      const history = messages
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .map(({ role, text: messageText }) => ({ role, text: messageText }));
      const pending = Promise.resolve()
        .then(() => agent(history))
        .then((result) => {
          push('assistant', String(result.reply));
          if (result.proposal) proposal = toCardProposal(result.proposal);
        })
        .catch((error) => push('system', errorMessage(error)))
        .finally(() => {
          thinking = false;
          notify();
        });
      return { ok: true, pending };
    },

    /** Set by the agent integration (Phase 5) or the dev-only demo. */
    setProposal(next) {
      proposal = next;
      notify();
    },

    /** Cancel never changes the design; it only drops the pending proposal. */
    cancelProposal() {
      if (!proposal) return false;
      proposal = null;
      push('system', 'Proposal cancelled. No changes were made.');
      notify();
      return true;
    },

    /** Called after the host applied (or refused) the proposal. */
    resolveProposal(message) {
      proposal = null;
      if (message) push('system', message);
      notify();
    },
  };
}
