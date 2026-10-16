import { expect, openDesigner, test } from './fixtures.js';

// The voice pipeline end to end in the browser: a fake microphone (MediaRecorder), mocked voice
// and agent endpoints, and a stubbed audio player. No OpenAI calls, no real audio.

const ok = (data) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });

async function fakeBrowserAudio(page) {
  await page.addInitScript(() => {
    const stream = { getTracks: () => [{ stop() {} }] };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream } });
    window.MediaRecorder = class {
      static isTypeSupported(type) { return type === 'audio/webm;codecs=opus'; }
      constructor(_stream, options) { this.mimeType = options?.mimeType ?? ''; this.state = 'inactive'; this.listeners = {}; }
      addEventListener(name, fn) { this.listeners[name] = fn; }
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        this.listeners.dataavailable?.({ data: new Blob(['fake-audio'], { type: 'audio/webm' }) });
        this.listeners.stop?.();
      }
    };
    window.__played = [];
    HTMLMediaElement.prototype.play = function play() { window.__played.push(this.src); return Promise.resolve(); };
  });
}

async function mockServices(page, { transcript = 'תוסיף מדף בגובה 100', transcribeError = null } = {}) {
  const calls = { transcribe: [], chat: [], speak: [] };
  await page.route('**/api/health', (route) => route.fulfill(ok({ status: 'ok', env: 'e2e', agent: true })));
  await page.route('**/api/voice/transcribe**', async (route) => {
    calls.transcribe.push({ type: route.request().headers()['content-type'], url: route.request().url() });
    if (transcribeError) {
      await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: transcribeError, message: 'x' } }) });
      return;
    }
    await route.fulfill(ok({ text: transcript, language: /[א-ת]/.test(transcript) ? 'he' : 'en' }));
  });
  await page.route('**/api/chat', async (route) => {
    const body = route.request().postDataJSON();
    calls.chat.push(body);
    await route.fulfill(ok({ reply: body.language === 'en' ? 'Sure, what height?' : 'בשמחה, באיזה תא?', proposal: null }));
  });
  await page.route('**/api/voice/speak', async (route) => {
    calls.speak.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'audio/mpeg', body: Buffer.from('ID3fake') });
  });
  return calls;
}

test.describe('voice (chained STT -> agent -> TTS)', () => {
  test('record, stop, transcribe and send through the normal chat flow', async ({ page }) => {
    await fakeBrowserAudio(page);
    const calls = await mockServices(page);
    await openDesigner(page);

    const mic = page.getByTestId('chat-mic');
    await expect(mic).toHaveAttribute('title', /OpenAI/); // the privacy note
    await mic.click();
    await expect(mic).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('chat-voice-status')).toContainText('מקליט');
    await mic.click(); // stop and send

    const messages = page.getByTestId('chat-messages');
    await expect(messages).toContainText('תוסיף מדף בגובה 100');
    await expect(messages).toContainText('בשמחה, באיזה תא?');
    expect(calls.transcribe[0].type).toBe('audio/webm');
    expect(calls.chat[0].messages.at(-1)).toEqual({ role: 'user', text: 'תוסיף מדף בגובה 100' });
    await expect(page.getByTestId('chat-voice-status')).toBeHidden();
    await expect(page.getByTestId('chat-input')).toHaveValue('');
    expect(calls.speak).toHaveLength(0); // reading aloud is off by default
  });

  test('English speech switches the chat to English, like typing would', async ({ page }) => {
    await fakeBrowserAudio(page);
    const calls = await mockServices(page, { transcript: 'add a shelf please' });
    await openDesigner(page);
    await page.getByTestId('chat-mic').click();
    await page.getByTestId('chat-mic').click();
    await expect(page.getByTestId('chat-messages')).toContainText('Sure, what height?');
    await expect(page.locator('#chat-panel')).toHaveAttribute('dir', 'ltr');
    expect(calls.chat[0].language).toBe('en');
  });

  test('cancel discards the recording and sends nothing', async ({ page }) => {
    await fakeBrowserAudio(page);
    const calls = await mockServices(page);
    await openDesigner(page);
    await page.getByTestId('chat-mic').click();
    await page.getByTestId('chat-mic-cancel').click();
    await expect(page.getByTestId('chat-mic')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('chat-voice-status')).toBeHidden();
    expect(calls.transcribe).toHaveLength(0);
    expect(calls.chat).toHaveLength(0);
  });

  test.describe('silence', () => {
    test.use({ allowedConsoleErrors: [/status of 422 \(Unprocessable Entity\)/] });

    test('shows a friendly note and sends nothing', async ({ page }) => {
      await fakeBrowserAudio(page);
      const calls = await mockServices(page, { transcribeError: 'NO_SPEECH' });
      await openDesigner(page);
      await page.getByTestId('chat-mic').click();
      await page.getByTestId('chat-mic').click();
      await expect(page.getByTestId('chat-voice-status')).toContainText('לא שמעתי דיבור');
      expect(calls.chat).toHaveLength(0);
    });
  });

  test('with read-aloud on, each new designer reply is spoken in its language', async ({ page }) => {
    await fakeBrowserAudio(page);
    const calls = await mockServices(page);
    await openDesigner(page);
    const toggle = page.getByTestId('chat-speak');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('chat-input').fill('make it shallower');
    await page.getByTestId('chat-send').click();
    await expect.poll(() => calls.speak.length).toBe(1);
    expect(calls.speak[0]).toEqual({ text: 'Sure, what height?', language: 'en' });
    await expect.poll(() => page.evaluate(() => window.__played.length)).toBe(1);

    await page.reload(); // the choice is remembered
    await page.getByTestId('entry-basic').click();
    await expect(page.getByTestId('chat-speak')).toHaveAttribute('aria-pressed', 'true');
  });

  test('without the agent there are no voice controls', async ({ page }) => {
    await fakeBrowserAudio(page);
    await page.route('**/api/health', (route) => route.fulfill(ok({ status: 'ok', env: 'e2e', agent: false })));
    await openDesigner(page);
    await expect(page.getByTestId('chat-mic')).toHaveCount(0);
    await expect(page.getByTestId('chat-speak')).toHaveCount(0);
  });
});
