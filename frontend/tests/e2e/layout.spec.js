import { clickComponent, expect, openDesigner, selection, test } from './fixtures.js';

const canvasWidth = async (page) => (await page.locator('#viewer canvas').boundingBox()).width;

/** Horizontal distance (px) between the projected orbit target and the centre of the free area. */
const wardrobeCentreOffset = (page) => page.evaluate(() => {
  const { viewer } = window.__banai;
  const rect = viewer.canvas.getBoundingClientRect();
  const projected = viewer.controls.target.clone().project(viewer.camera);
  const x = rect.left + ((projected.x + 1) / 2) * rect.width;
  const style = getComputedStyle(document.querySelector('.workspace'));
  const left = parseFloat(style.getPropertyValue('--inset-left'));
  const right = parseFloat(style.getPropertyValue('--inset-right'));
  return x - (rect.left + left + (rect.width - left - right) / 2);
});

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

  test('the AI panel starts as a pill, expands to a card over the full-width canvas, and is remembered', async ({ page }) => {
    const expand = page.getByRole('button', { name: 'Expand AI designer' });
    const emptyState = page.getByText('The conversational design agent is not connected yet', { exact: false });
    await expect(expand).toBeVisible();
    await expect(emptyState).toBeHidden();
    const fullWidth = await canvasWidth(page);
    const freeCentre = await wardrobeCentreOffset(page);
    expect(Math.abs(freeCentre)).toBeLessThan(40);

    await expand.click();
    await expect(emptyState).toBeVisible();
    await expect(page.getByRole('button', { name: 'Collapse AI designer' })).toBeFocused();
    expect(await canvasWidth(page)).toBe(fullWidth); // the canvas stays full width under the cards
    await expect.poll(() => wardrobeCentreOffset(page).then(Math.abs)).toBeLessThan(40); // re-centred in the new free area

    await page.reload();
    await page.waitForFunction(() => window.__banai?.viewer.meshOf('shf_l1'));
    await expect(page.getByRole('button', { name: 'Collapse AI designer' })).toBeVisible();
    await page.getByRole('button', { name: 'Collapse AI designer' }).click();
    await expect(expand).toBeVisible();
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
