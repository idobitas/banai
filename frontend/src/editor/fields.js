// Small DOM builders for the properties panel. Text is always set via textContent or
// input.value, never innerHTML, so design data (e.g. custom names) cannot inject markup.
import { friendlyError, parseCm, toCmText } from './opsFromForm.js';

let fieldCounter = 0;
const nextId = (prefix) => `${prefix}-${(fieldCounter += 1)}`;

export function el(tag, { className, text, attrs = {} } = {}, children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  Object.entries(attrs).forEach(([name, value]) => node.setAttribute(name, value));
  node.append(...children);
  return node;
}

/**
 * A panel section. With `collapsible: { key, ui, summary }` the title becomes a toggle button;
 * `ui.isCollapsed(key)` / `ui.toggle(key)` keep the state outside the DOM (it survives re-renders).
 * Children appended later (e.g. action errors) stay visible while collapsed.
 */
export function section(title, children, collapsible) {
  if (!collapsible) {
    return el('section', { className: 'prop-section' }, [el('h3', { className: 'prop-section__title', text: title }), ...children]);
  }
  return collapsibleBlock({ tag: 'section', className: 'prop-section', headingClass: 'prop-section__title', title, children, ...collapsible });
}

/** A nested collapsible group inside a section (e.g. one appearance target). */
export const subsection = (title, children, collapsible) =>
  collapsibleBlock({ tag: 'div', className: 'prop-subsection', headingClass: 'prop-subsection__title', title, children, ...collapsible });

function summaryNode({ text, hex }) {
  const dot = el('span', { className: 'summary__dot', attrs: { 'aria-hidden': 'true' } });
  if (hex) dot.style.backgroundColor = hex; // a validated #rrggbb from the catalog or the design
  return el('span', { className: 'summary' }, [...(hex ? [dot] : []), el('span', { className: 'summary__text', text })]);
}

function collapsibleBlock({ tag, className, headingClass, title, children, key, ui, summary }) {
  const collapsed = ui.isCollapsed(key);
  const bodyId = nextId('section');
  const toggle = el('button', {
    className: 'collapse-toggle',
    attrs: { type: 'button', 'aria-expanded': String(!collapsed), 'aria-controls': bodyId, 'data-collapse-key': key },
  }, [
    el('span', { className: 'collapse-toggle__chevron', attrs: { 'aria-hidden': 'true' } }),
    el('span', { className: 'collapse-toggle__title', text: title }),
    ...(collapsed && summary ? [summaryNode(summary)] : []),
  ]);
  toggle.addEventListener('click', () => ui.toggle(key));
  const body = el('div', { className: 'collapse-body', attrs: { id: bodyId } }, children);
  body.hidden = collapsed;
  const heading = el(tag === 'section' ? 'h3' : 'h4', { className: headingClass }, [toggle]);
  return el(tag, { className: `${className}${collapsed ? ' is-collapsed' : ''}` }, [heading, body]);
}

/** A labelled input + inline message. `commit(rawText)` returns { ok, error?, message? }. */
function inputField({ label, value, testId, suffix, commit, inputMode = 'decimal' }) {
  const id = nextId('field');
  const input = el('input', { className: 'field__input', attrs: { id, type: 'text', inputmode: inputMode, autocomplete: 'off' } });
  input.value = value;
  if (testId) input.dataset.testid = testId;
  const message = el('p', { className: 'field__message', attrs: { role: 'alert', 'aria-live': 'polite' } });
  const showError = (text) => {
    message.textContent = text;
    input.setAttribute('aria-invalid', 'true');
  };
  let lastSubmitted = value;
  const apply = () => {
    if (input.value === lastSubmitted) return;
    lastSubmitted = input.value;
    const result = commit(input.value);
    if (!result.ok) showError(result.message ?? friendlyError(result.error));
  };
  input.addEventListener('change', apply);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') apply();
  });
  const control = el('div', { className: 'field__control' }, [input, ...(suffix ? [el('span', { className: 'field__suffix', text: suffix })] : [])]);
  return el('div', { className: 'field' }, [el('label', { className: 'field__label', text: label, attrs: { for: id } }), control, message]);
}

/** A centimetre field backed by an integer-millimetre value. `onCommit(mm)` dispatches. */
export function cmField({ label, mm, testId, onCommit }) {
  return inputField({
    label, testId, suffix: 'cm', value: toCmText(mm),
    commit: (text) => {
      const parsed = parseCm(text);
      return parsed.ok ? onCommit(parsed.mm) : parsed;
    },
  });
}

/** A whole-number field (counts). */
export function countField({ label, value, testId, onCommit }) {
  return inputField({
    label, testId, value: String(value), inputMode: 'numeric',
    commit: (text) => (/^\d{1,2}$/.test(text.trim()) ? onCommit(Number(text.trim())) : { ok: false, message: 'Enter a whole number' }),
  });
}

export function segmented({ label, options, value, onChange, testId }) {
  const group = el('div', { className: 'segmented', attrs: { role: 'group', 'aria-label': label } });
  if (testId) group.dataset.testid = testId;
  options.forEach((option) => {
    const button = el('button', { className: 'segmented__option', text: option.label, attrs: { type: 'button', 'aria-pressed': String(option.value === value) } });
    button.addEventListener('click', () => {
      if (option.value !== value) onChange(option.value);
    });
    group.append(button);
  });
  return el('div', { className: 'field' }, [el('span', { className: 'field__label', text: label }), group]);
}

export function selectField({ label, options, value, onChange, testId }) {
  const id = nextId('select');
  const select = el('select', { className: 'field__input', attrs: { id } }, options.map((option) => {
    const node = el('option', { text: option.label, attrs: { value: option.value } });
    node.selected = option.value === value;
    return node;
  }));
  if (testId) select.dataset.testid = testId;
  select.addEventListener('change', () => onChange(select.value));
  return el('div', { className: 'field' }, [el('label', { className: 'field__label', text: label, attrs: { for: id } }), select]);
}

export function button(text, onClick, { variant = 'secondary', testId, disabled = false } = {}) {
  const node = el('button', { className: `btn btn--${variant}`, text, attrs: { type: 'button' } });
  if (testId) node.dataset.testid = testId;
  node.disabled = disabled;
  node.addEventListener('click', onClick);
  return node;
}

/** Shows a domain error from a non-input action (buttons, selects) under a section. */
export function actionResult(container, result) {
  container.querySelectorAll(':scope > .action-error').forEach((node) => node.remove());
  if (!result.ok) container.append(el('p', { className: 'field__message action-error', text: friendlyError(result.error), attrs: { role: 'alert' } }));
  return result;
}
