import { test, expect } from '@playwright/test';

test('demo shows ranked physical cues without requesting a camera', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your view' })).toBeVisible();
  await page.getByRole('button', { name: 'Explore a demo' }).click();
  await expect(page.getByText('Give the vowel room.')).toBeVisible();
  await expect(page.locator('.coaching-tips li')).toHaveCount(3);
  await expect(page.getByText('Demo · camera is off')).toBeVisible();
  await page.screenshot({ path: 'test-results/studio-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Exit demo' }).click();
  await expect(page.getByText('Make room for your voice.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('camera denial remains actionable and supports retry', async ({ page }) => {
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.getByRole('status')).toContainText('Camera permission was denied');
  await expect(page.getByRole('button', { name: 'Start camera' })).toBeVisible();
});

test('mobile layout fits the viewport and explains the app', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'How it works' }).click();
  await expect(page.getByText('Your practice, in three views.')).toBeVisible();
  await page.getByRole('button', { name: 'Got it' }).click();
  await page.getByRole('button', { name: 'Explore a demo' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: 'test-results/studio-mobile.png', fullPage: true });
});

test('ending a session releases a camera permission request that resolves late', async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { finishCamera: () => void; stopped: boolean };
    state.stopped = false;
    navigator.mediaDevices.getUserMedia = () => new Promise(resolve => {
      state.finishCamera = () => resolve({ getTracks: () => [{ stop: () => { state.stopped = true; } }] } as unknown as MediaStream);
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.getByRole('heading', { name: 'Getting ready' })).toBeVisible();
  await page.getByRole('button', { name: 'End session' }).click();
  await page.evaluate(() => (window as unknown as { finishCamera: () => void }).finishCamera());
  expect(await page.evaluate(() => (window as unknown as { stopped: boolean }).stopped)).toBe(true);
  await expect(page.getByRole('button', { name: 'Start camera' })).toBeVisible();
});
