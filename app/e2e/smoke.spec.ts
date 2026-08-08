import { expect, test } from '@playwright/test';

/**
 * Fast browser smoke for the shared web/mac React surface.
 * Keep assertions role/text based — avoid brittle CSS selectors.
 */
test.describe('web UI smoke', () => {
  test('serves the app shell', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.ok() || response?.status() === 304).toBeTruthy();
    await expect(page.locator('body')).toBeVisible();
  });

  test('signin route exposes credentials form or redirects when already authed', async ({ page }) => {
    await page.goto('/signin');
    const password = page.getByLabel(/password/i).or(page.locator('input[type="password"]'));
    const authedShell = page.locator('.bkemo');
    await expect(password.or(authedShell).first()).toBeVisible({ timeout: 15_000 });
  });
});
