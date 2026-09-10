import { test, expect } from '@playwright/test';

// Seed state (backend/src/db/seed.js): "Math Trial" starts with 0 confirmed
// bookings and plenty of open seats, so it's the safe target for both flows
// below without colliding with the pre-seeded duplicate-booking / full-class
// fixtures on the other two classes. "Raka Kartika" and "Bagas Santoso" are
// explicitly unbooked students in that seed.

function mathTrialCard(page) {
  return page.locator('.class-card').filter({ has: page.locator('h3', { hasText: /^Math Trial$/ }) });
}

function mathTrialTab(page) {
  return page.locator('.tab').filter({ hasText: /Math Trial$/ });
}

test('book a trial class, pay successfully, and see the student on the roster', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: /Raka Kartika/ }).click();
  await mathTrialCard(page).click();
  await page.getByRole('button', { name: 'Book trial' }).click();

  await expect(page.getByText(/Booking #\d+ for Raka Kartika/)).toBeVisible();
  await page.getByRole('button', { name: 'Pay Rp 99.000', exact: true }).click();

  await expect(page.getByText(/is now confirmed/)).toBeVisible();

  await mathTrialTab(page).click();
  await expect(page.locator('.roster-row', { hasText: 'Raka Kartika' })).toBeVisible();
});

test('a declined payment leaves the booking off the roster', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: /Bagas Santoso/ }).click();
  await mathTrialCard(page).click();
  await page.getByRole('button', { name: 'Book trial' }).click();

  await expect(page.getByText(/Booking #\d+ for Bagas Santoso/)).toBeVisible();
  await page.getByRole('checkbox', { name: /Simulate a declined payment/ }).check();
  await page.getByRole('button', { name: /will decline/ }).click();

  await expect(page.getByText(/payment_failed/)).toBeVisible();

  await mathTrialTab(page).click();
  await expect(page.locator('.roster-row', { hasText: 'Bagas Santoso' })).not.toBeVisible();
});
