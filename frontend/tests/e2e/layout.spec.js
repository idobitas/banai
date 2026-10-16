import { clickComponent, expect, openDesigner, selection, test } from './fixtures.js';

const canvasWidth = async (page) => (await page.locator('#viewer canvas').boundingBox()).width;

test.describe('Panel organization and layout', () => {
  test.beforeEach(async ({ page }) => openDesigner(page));

  test('materials start collapsed with a summary; the collapsed state survives edits and reload', async ({ page }) => {
    const materials = page.getByRole('button', { name: /^Materials/ });
    await expect(materials).toHaveAttribute('aria-expanded', 'false');
    await expect(materials).toContainText('Melamine board · White · Matte');
    await expect(page.getByRole('button', { name: 'Walnut' })).toHaveCount(0);

    await page.getByRole('button', { name: /^Compartments/ }).click();
    await expect(page.getByTestId('add-compartment')).toBeHidden();
    await page.getByTestId('dim-width').fill('240');
    await page.getByTestId('dim-width').press('Enter');
    await expect(page.getByRole('button', { name: /^Compartments/ })).toHaveAttribute('aria-expanded', 'false');

    await page.reload();
    await page.waitForFunction(() => window.__banai?.viewer.meshOf('shf_l1'));
    await expect(page.getByRole('button', { name: /^Compartments/ })).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('button', { name: /^Compartments/ })).toContainText('3 compartments');
  });

  test('selecting a shelf from the compartment tree selects it in 3D and reveals the interior', async ({ page }) => {
    await page.getByTestId('expand-cmp_left').click();
    await expect(page.getByTestId('expand-cmp_left')).toBeFocused();
    await page.getByTestId('tree-shf_l2').click();
    expect(await selection(page)).toEqual({ id: 'shf_l2', kind: 'shelf' });
    await expect(page.getByTestId('selected-section')).toContainText('Selected · Shelf');
    await expect(page.locator('.dim-label--selected')).toHaveText('Shelf · 80.0 cm from base · 1.8 cm thick');
    await expect(page.getByLabel('Show interior')).toBeChecked();
    await expect(page.getByTestId('tree-shf_l2')).toHaveAttribute('aria-current', 'true');
  });

  test('a 3D selection brings the selected card into view and auto-expands its compartment', async ({ page }) => {
    await page.getByRole('button', { name: 'Materials' }).click();
    await page.locator('#properties-panel').evaluate((panel) => panel.scrollTo({ top: panel.scrollHeight }));
    await page.getByLabel('Show interior').check();
    await clickComponent(page, 'shf_r1');
    await expect(page.getByTestId('selected-section')).toBeInViewport();
    await expect.poll(() => page.locator('#properties-panel').evaluate((panel) => panel.scrollTop)).toBe(0);
    await expect(page.getByTestId('tree-shf_r1')).toBeVisible();
    await page.getByRole('button', { name: 'Deselect' }).click();
    expect(await selection(page)).toBeNull();
  });

  test('the AI column starts collapsed, expanding it narrows the canvas, and the choice is remembered', async ({ page }) => {
    const expand = page.getByRole('button', { name: 'Expand AI designer' });
    await expect(expand).toBeVisible();
    await expect(page.getByText('The conversational design agent is not connected yet', { exact: false })).toBeHidden();
    const collapsedWidth = await canvasWidth(page);

    await expand.click();
    await expect(page.getByText('The conversational design agent is not connected yet', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Collapse AI designer' })).toBeFocused();
    await expect.poll(() => canvasWidth(page)).toBeLessThan(collapsedWidth - 200);

    await page.reload();
    await page.waitForFunction(() => window.__banai?.viewer.meshOf('shf_l1'));
    await expect(page.getByRole('button', { name: 'Collapse AI designer' })).toBeVisible();
    await page.getByRole('button', { name: 'Collapse AI designer' }).click();
    await expect.poll(() => canvasWidth(page)).toBeCloseTo(collapsedWidth, -1);
  });

  test('the properties panel never scrolls the page', async ({ page }) => {
    await page.getByRole('button', { name: 'Materials' }).click();
    await page.getByTestId('expand-cmp_right').click();
    const overflow = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(overflow).toBeLessThanOrEqual(0);
    const panel = page.locator('#properties-panel');
    expect(await panel.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(0);
  });
});
