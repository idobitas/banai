import { clickComponent, doorsSettled, expect, openDesigner, selection, test } from './fixtures.js';

const cameraState = (page) => page.evaluate(() => {
  const { camera, controls, view } = window.__banai.viewer;
  return { position: camera.position.toArray(), target: controls.target.toArray(), view };
});
const pressed = (page, name) => page.getByRole('toolbar', { name: 'View' }).getByRole('button', { name, exact: true });

test.describe('Motion and the floating view toolbar', () => {
  test.beforeEach(async ({ page }) => openDesigner(page));

  test('view buttons glide the camera to Front and Top and mark the active view', async ({ page }) => {
    await expect(pressed(page, '3/4')).toHaveAttribute('aria-pressed', 'true');

    await pressed(page, 'Front').click();
    await expect(pressed(page, 'Front')).toHaveAttribute('aria-pressed', 'true');
    await expect(pressed(page, '3/4')).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => {
      const { position, target } = await cameraState(page);
      return Math.abs(position[0] - target[0]);
    }).toBeLessThan(1e-3); // centred on the wardrobe, looking along the z axis
    const { position, target } = await cameraState(page);
    expect(position[2]).toBeGreaterThan(target[2] + 3);
    expect(position[1] - target[1]).toBeLessThan(0.2); // near eye level

    await pressed(page, 'Top').click();
    await expect.poll(async () => {
      const { position, target } = await cameraState(page);
      return position[1] - target[1];
    }).toBeGreaterThan(3);
  });

  test('a free orbit clears the active view; Fit glides back to a framed view', async ({ page }) => {
    const box = await page.locator('#viewer canvas').boundingBox();
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.4 + 200, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    expect((await cameraState(page)).view).toBeNull();
    await expect(page.locator('#viewer-toolbar [aria-pressed="true"]')).toHaveCount(0);

    await page.getByRole('button', { name: 'Fit' }).click();
    await expect(pressed(page, '3/4')).toHaveAttribute('aria-pressed', 'true');
  });

  test('with the doors open, a shelf can be clicked, and editing keeps the doors open', async ({ page }) => {
    await page.getByLabel('Show interior').check();
    await clickComponent(page, 'shf_l2');
    expect(await selection(page)).toEqual({ id: 'shf_l2', kind: 'shelf' });

    await page.getByTestId('dim-width').fill('220');
    await page.getByTestId('dim-width').press('Enter');
    await expect.poll(() => page.evaluate(() => window.__banai.store.getState().design.dimensions.width)).toBe(2200);
    await doorsSettled(page);
    expect(await page.evaluate(() => window.__banai.viewer.doorOpenness())).toBe(1);
    expect(await page.evaluate(() => window.__banai.viewer.meshOf('dr_left').rotation.y)).toBeLessThan(-1.5);
  });

  test('sliding panels slide and fade out, and cannot be picked once open', async ({ page }) => {
    await page.getByTestId('door-type').getByRole('button', { name: 'Sliding' }).click();
    await expect.poll(() => page.evaluate(() => window.__banai.store.getState().design.doors.type)).toBe('sliding');
    await page.getByLabel('Show interior').check();
    await doorsSettled(page);
    const panels = await page.evaluate(() => window.__banai.store.getState().design.doors.items.map((d) => {
      const mesh = window.__banai.viewer.meshOf(d.id);
      return { visible: mesh.visible, opacity: mesh.material.opacity };
    }));
    expect(panels.every((p) => !p.visible && p.opacity === 0)).toBe(true);
    // The carcass shares the door appearance but must not fade with the panels.
    expect(await page.evaluate(() => window.__banai.viewer.meshOf('carcass').material.opacity)).toBe(1);
  });
});
