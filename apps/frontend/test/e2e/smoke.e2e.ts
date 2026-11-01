import { expect, test } from '@playwright/test';

// Creates a fresh account in the dev database on every run.
test('a new pilot registers, founds a station, sees the map and logs out', async ({ page }) => {
  const pilot = `e2e-${Date.now().toString(36)}`;

  await page.goto('/register');
  await page.getByLabel('Pilot name').fill(pilot);
  await page.getByLabel('Email').fill(`${pilot}@example.test`);
  await page.getByLabel('Password').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/map$/);
  await page.getByRole('textbox', { name: 'Station name' }).fill(`${pilot} Station`);
  await page.getByRole('button', { name: 'Found station' }).click();

  await expect(page.locator('canvas')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /Logbook/ })).toBeVisible();

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).not.toHaveURL(/\/map$/);
});
