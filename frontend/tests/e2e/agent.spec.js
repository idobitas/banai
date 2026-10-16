// Phase 5 flows with the scripted agent (APP_ENV=e2e): no OpenAI calls, deterministic replies.
import { expect, openDesigner, test } from './fixtures.js';

const state = (page) => page.evaluate(() => {
  const { design, revision } = window.__banai.store.getState();
  return { width: design.dimensions.width, revision };
});

async function ask(page, text) {
  await page.getByTestId('chat-input').fill(text);
  await page.getByTestId('chat-send').click();
}

test.describe('Phase 5: AI agent', () => {
  test.beforeEach(async ({ page }) => openDesigner(page));

  test('the agent is online; Confirm applies the server-verified proposal to the viewer and editor', async ({ page }) => {
    await expect(page.locator('.chat__status')).toHaveText('Online');
    await ask(page, '240 cm wide please');
    const card = page.getByTestId('proposal-card');
    await expect(card).toContainText('240.0 cm');
    expect(await state(page)).toEqual({ width: 2000, revision: 1 }); // nothing applied yet

    await page.getByTestId('proposal-confirm').click();
    await expect.poll(() => state(page)).toEqual({ width: 2400, revision: 2 });
    await expect(card).toHaveCount(0);
    await expect(page.getByTestId('chat-messages')).toContainText('Applied to your design.');
    await expect(page.getByText('W 240.0 cm', { exact: true })).toBeVisible();
    await expect(page.getByTestId('dim-width')).toHaveValue('240.0');
  });

  test('Cancel leaves the design untouched', async ({ page }) => {
    await ask(page, '220 cm wide');
    await page.getByTestId('proposal-cancel').click();
    await expect(page.getByTestId('proposal-card')).toHaveCount(0);
    expect(await state(page)).toEqual({ width: 2000, revision: 1 });
  });

  test('a manual edit makes a pending proposal stale; the server also refuses a stale apply', async ({ page }) => {
    await ask(page, '240 cm wide');
    await expect(page.getByTestId('proposal-confirm')).toBeEnabled();
    await page.getByTestId('dim-height').fill('230');
    await page.getByTestId('dim-height').press('Enter');
    await expect(page.getByTestId('proposal-confirm')).toBeDisabled();

    // Even if a stale proposal were sent, the server answers 409 and nothing changes.
    // (Sent from the test runner, not the page, so the expected 409 is not a console error.)
    const payload = await page.evaluate(() => {
      const { chat, store } = window.__banai;
      const { design, revision } = store.getState();
      return { design, revision, proposal: chat.getProposal().signed };
    });
    const response = await page.request.post('http://localhost:8010/api/proposals/apply', { data: payload });
    expect(response.status()).toBe(409);
    expect((await response.json()).error.code).toBe('STALE');
    expect((await state(page)).width).toBe(2000);
  });

  test('without enough detail the agent asks a question and proposes nothing', async ({ page }) => {
    await ask(page, 'make it nicer');
    await expect(page.getByTestId('chat-messages')).toContainText('How wide should the wardrobe be?');
    await expect(page.getByTestId('proposal-card')).toHaveCount(0);
  });

  test('a typing indicator shows while waiting and the send button is locked', async ({ page }) => {
    await page.route('**/api/chat', async (route) => {
      await new Promise((resolve) => { setTimeout(resolve, 400); });
      await route.continue();
    });
    await ask(page, 'make it nicer');
    await expect(page.getByTestId('chat-typing')).toBeVisible();
    await expect(page.getByTestId('chat-send')).toBeDisabled();
    await expect(page.getByTestId('chat-typing')).toBeHidden();
    await expect(page.getByTestId('chat-send')).toBeEnabled();
  });
});
