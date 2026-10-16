// Left column: header (with a Hebrew/English switch), a welcome with starter prompts, the
// conversation, the proposal card and the composer. This panel never changes the design by
// itself: the agent only proposes, and the host applies a proposal when the customer confirms it.
// Switching the language rebuilds the panel's chrome; the conversation and the draft stay.
import { el } from '../editor/fields.js';
import { icon } from '../ui/icons.js';
import { MAX_MESSAGE_LENGTH } from './chatModel.js';
import { createLanguage, detectLanguage, LANGUAGES, STRINGS, stringsFor } from './i18n.js';
import { renderProposalCard } from './proposalCard.js';

const LANGUAGE_NAMES = Object.freeze({ he: 'עב', en: 'EN' });

function languageSwitch(language, t) {
  const group = el('div', { className: 'lang-switch', attrs: { role: 'group', 'aria-label': t.switchLabel } });
  group.dataset.testid = 'chat-language';
  LANGUAGES.forEach((code) => {
    const option = el('button', {
      className: 'lang-switch__option',
      text: LANGUAGE_NAMES[code],
      attrs: { type: 'button', lang: code, 'aria-pressed': String(code === language.get()), title: code === 'he' ? 'עברית' : 'English' },
    });
    option.dataset.testid = `chat-language-${code}`;
    option.addEventListener('click', () => language.set(code));
    group.append(option);
  });
  return group;
}

const formatSeconds = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * `voice` (optional) = { recorder, transcribe, speaker } enables the chained voice pipeline:
 * a recording is transcribed into the composer and sent through the normal submit (so language
 * switching and the agent flow are unchanged); new designer replies can be read aloud.
 */
export function mountChat(container, { model, onConfirm, language = createLanguage(), voice = null }) {
  container.classList.add('panel--chat');
  let draft = '';
  let hintKey = null; // a localized placeholder chosen on the start screen
  let view = null;
  // Voice state lives outside build(), so a language switch never interrupts a recording.
  let voiceState = 'idle'; // 'idle' | 'recording' | 'transcribing'
  let voiceError = null; // a key of t.voice.errors
  let recordingSince = 0;
  let tick = null;
  let lastSpokenId = model.getMessages().at(-1)?.id ?? 0; // never read out what was already there

  function renderVoice() {
    if (!view?.mic) return;
    const { t, mic, voiceStatus, voiceText, voiceCancel, speakToggle } = view;
    const recording = voiceState === 'recording';
    mic.replaceChildren(icon(recording ? 'stop' : 'mic'));
    mic.setAttribute('aria-label', recording ? t.voice.stop : t.voice.record);
    mic.setAttribute('aria-pressed', String(recording));
    mic.classList.toggle('is-recording', recording);
    mic.disabled = voiceState === 'transcribing' || (!recording && model.isBusy());
    voiceCancel.hidden = !recording;
    const text = recording ? `${t.voice.recording} ${formatSeconds(Date.now() - recordingSince)}`
      : voiceState === 'transcribing' ? t.voice.transcribing
        : voiceError ? t.voice.errors[voiceError] : '';
    voiceText.textContent = text;
    voiceStatus.hidden = !text;
    voiceStatus.classList.toggle('is-error', voiceState === 'idle' && Boolean(voiceError));
    const speaking = voice.speaker.isEnabled();
    speakToggle.replaceChildren(icon(speaking ? 'volume' : 'volumeOff', { size: 18 }));
    speakToggle.setAttribute('aria-pressed', String(speaking));
    speakToggle.setAttribute('aria-label', speaking ? t.voice.speakOn : t.voice.speakOff);
    speakToggle.title = speaking ? t.voice.speakOn : t.voice.speakOff;
  }

  function setVoice(state, error = null) {
    voiceState = state;
    voiceError = error;
    clearInterval(tick);
    tick = state === 'recording' ? setInterval(renderVoice, 250) : null;
    renderVoice();
  }

  async function record() {
    voice.speaker.stop(); // don't record the designer's own voice
    recordingSince = Date.now();
    setVoice('recording');
    let blob;
    try {
      blob = await voice.recorder.start();
    } catch (error) {
      setVoice('idle', error?.reason === 'denied' ? 'denied' : 'unsupported');
      return;
    }
    if (!blob) {
      setVoice('idle'); // cancelled
      return;
    }
    setVoice('transcribing');
    try {
      const { text } = await voice.transcribe(blob, language.get());
      setVoice('idle');
      view.input.value = text;
      draft = text;
      view.submit(); // the normal path: may switch the chat language, then sends
    } catch (error) {
      setVoice('idle', error?.code === 'NO_SPEECH' ? 'noSpeech' : error?.status === 429 ? 'rateLimited' : 'failed');
    }
  }

  function speakNewReplies(messages) {
    messages.filter((m) => m.id > lastSpokenId && m.role === 'assistant')
      .forEach((m) => voice.speaker.say(m.text, m.language));
    lastSpokenId = Math.max(lastSpokenId, messages.at(-1)?.id ?? 0);
  }

  function build() {
    const t = language.strings();
    container.setAttribute('dir', t.dir);
    container.setAttribute('lang', language.get());

    const header = el('header', { className: 'chat__header' }, [
      el('span', { className: 'chat__avatar' }, [icon('sparkle', { size: 22 })]),
      el('div', { className: 'chat__heading' }, [
        el('h2', { className: 'chat__title', text: t.title }),
        el('p', { className: 'chat__subtitle', text: t.subtitle }),
      ]),
      model.isConnected()
        ? el('span', { className: 'chat__status chat__status--online', text: t.online, attrs: { title: t.onlineTitle } })
        : el('span', { className: 'chat__status', text: t.comingSoon, attrs: { title: t.comingSoonTitle } }),
    ]);

    const input = el('textarea', { className: 'chat__input', attrs: { rows: '2', maxlength: String(MAX_MESSAGE_LENGTH), placeholder: (hintKey && t.composerHints[hintKey]) || t.placeholder, dir: 'auto', 'aria-label': t.inputLabel } });
    input.dataset.testid = 'chat-input';
    input.value = draft;
    input.addEventListener('input', () => { draft = input.value; });
    const sendButton = el('button', { className: 'icon-btn icon-btn--filled chat__send', attrs: { type: 'submit', 'aria-label': t.send } }, [icon('send')]);
    sendButton.dataset.testid = 'chat-send';
    const voiceControls = {};
    if (voice) {
      const mic = el('button', { className: 'icon-btn chat__mic', attrs: { type: 'button', title: t.voice.privacy } });
      mic.dataset.testid = 'chat-mic';
      mic.addEventListener('click', () => {
        if (voiceState === 'recording') voice.recorder.stop();
        else if (voiceState === 'idle') record();
      });
      const voiceText = el('span', { className: 'chat__voice-text', attrs: { role: 'status', 'aria-live': 'polite' } });
      const voiceCancel = el('button', { className: 'btn btn--ghost chat__voice-cancel', text: t.voice.cancel, attrs: { type: 'button' } });
      voiceCancel.dataset.testid = 'chat-mic-cancel';
      voiceCancel.addEventListener('click', () => voice.recorder.cancel());
      const voiceStatus = el('div', { className: 'chat__voice' }, [el('span', { className: 'chat__voice-dot', attrs: { 'aria-hidden': 'true' } }), voiceText, voiceCancel]);
      voiceStatus.dataset.testid = 'chat-voice-status';
      const speakToggle = el('button', { className: 'icon-btn chat__speak', attrs: { type: 'button' } });
      speakToggle.dataset.testid = 'chat-speak';
      speakToggle.addEventListener('click', () => {
        voice.speaker.setEnabled(!voice.speaker.isEnabled());
        renderVoice();
      });
      Object.assign(voiceControls, { mic, voiceStatus, voiceText, voiceCancel, speakToggle });
    }
    const composer = el('form', { className: 'chat__composer' }, [input, ...(voice ? [voiceControls.mic] : []), sendButton]);
    const hint = el('p', { className: 'chat__hint', text: t.hint });

    const chips = t.suggestions.map((text) => {
      const chip = el('button', { className: 'suggestion', attrs: { type: 'button' } }, [icon('sparkle', { size: 16 }), el('span', { text })]);
      chip.dataset.testid = 'suggestion';
      chip.addEventListener('click', () => {
        input.value = text; // only fills the composer: nothing is sent until the customer presses send
        draft = text;
        input.focus();
      });
      return chip;
    });
    const welcome = el('section', { className: 'welcome', attrs: { 'aria-label': t.welcomeLabel } }, [
      el('h3', { className: 'welcome__title', text: t.welcomeTitle }),
      el('p', { className: 'welcome__text', text: t.welcomeText }),
      el('div', { className: 'welcome__chips' }, chips),
    ]);
    welcome.dataset.testid = 'chat-welcome';

    const list = el('div', { className: 'chat__messages', attrs: { role: 'log', 'aria-live': 'polite', 'aria-label': t.conversation } });
    list.dataset.testid = 'chat-messages';
    const proposalSlot = el('div', { className: 'chat__proposal' });
    const typing = el('div', { className: 'chat__bubble chat__bubble--assistant chat__typing', attrs: { role: 'status', 'aria-label': t.thinking } }, [
      el('span', { className: 'chat__dot' }), el('span', { className: 'chat__dot' }), el('span', { className: 'chat__dot' }),
    ]);
    typing.dataset.testid = 'chat-typing';
    typing.hidden = true;

    const submit = () => {
      if (model.isBusy() || !input.value.trim()) return;
      // Writing in Hebrew or English switches the chat to that language first, so the reply (and
      // the UI) come back only in the language the customer wrote in.
      const written = detectLanguage(input.value);
      if (written && written !== language.get()) {
        draft = input.value;
        language.set(written); // rebuilds the panel; the draft is carried over
        view.submit();
        return;
      }
      if (model.send(input.value).ok) {
        input.value = '';
        draft = '';
      }
    };
    composer.addEventListener('submit', (event) => {
      event.preventDefault();
      submit();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    });

    const footerRow = el('div', { className: 'chat__footer-row' }, [hint, ...(voice ? [voiceControls.speakToggle] : []), languageSwitch(language, t)]);
    const footer = el('div', { className: 'chat__footer' }, [...(voice ? [voiceControls.voiceStatus] : []), composer, footerRow]);
    container.replaceChildren(header, el('div', { className: 'chat__body' }, [welcome, list, proposalSlot]), footer);
    view = { t, input, sendButton, composer, welcome, list, proposalSlot, typing, submit, renderedCount: 0, renderedProposalKey: null, ...voiceControls };
    renderVoice();
  }

  function render() {
    const { t, sendButton, composer, welcome, list, proposalSlot, typing } = view;
    const messages = model.getMessages();
    welcome.hidden = messages.length > 0 || model.getProposal() !== null;
    list.hidden = messages.length === 0;
    // Only newly added bubbles are created (and animate in); existing ones stay untouched.
    if (messages.length < view.renderedCount) {
      list.replaceChildren();
      view.renderedCount = 0;
    }
    messages.slice(view.renderedCount).forEach((message) => {
      // Designer and system bubbles keep the language (and direction) they were written in; the
      // customer's own text takes its direction from its content. Switching language changes neither.
      const written = message.role !== 'user' && STRINGS[message.language];
      const bubble = el('div', {
        className: `chat__bubble chat__bubble--${message.role}`,
        attrs: written ? { dir: written.dir, lang: message.language } : { dir: 'auto' },
      });
      if (message.role === 'system') bubble.append(icon('info', { size: 16 }));
      bubble.append(el('span', { text: message.text }));
      list.append(bubble);
    });
    view.renderedCount = messages.length;
    if (voice) {
      speakNewReplies(messages);
      renderVoice(); // the mic is unavailable while the designer is answering
    }
    const busy = model.isBusy();
    typing.hidden = !busy;
    if (busy) list.append(typing); // keep the indicator last, under the newest message
    sendButton.disabled = busy;
    composer.setAttribute('aria-busy', String(busy));
    list.scrollTop = list.scrollHeight;

    // Re-render the card only when the proposal or its status changed (keeps its entrance animation calm).
    const proposal = model.getProposal();
    const status = model.getProposalStatus();
    const key = proposal ? `${proposal.id}:${status}` : '';
    if (key === view.renderedProposalKey) return;
    view.renderedProposalKey = key;
    proposalSlot.replaceChildren();
    if (proposal) {
      proposalSlot.append(renderProposalCard(proposal, status, {
        onConfirm,
        onCancel: () => model.cancelProposal(),
        strings: proposal.language ? stringsFor(proposal.language) : t, // the card stays in its own language
      }));
    }
  }

  build();
  model.subscribe(render);
  render();
  language.subscribe(() => {
    const hadFocus = document.activeElement === view.input;
    build();
    render();
    if (hadFocus) view.input.focus();
  });

  return {
    /** Focus the composer. `hintKey` picks a localized placeholder ('guided' | 'freeText'). */
    focus: (key) => {
      hintKey = key ?? null;
      view.input.placeholder = (hintKey && view.t.composerHints[hintKey]) || view.t.placeholder;
      view.input.focus();
    },
    /** Re-render, e.g. after the design revision changed (a pending proposal may now be stale). */
    refresh: render,
  };
}
