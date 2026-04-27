import { test, expect } from '@playwright/test';
import {
  TEST_WEEK_KEY,
  TEST_STAFF_PREFIX,
  api,
  fetchStaff,
  adminApi,
  wipeTestWeek,
  wipeTestStaff,
  autoAcceptPassword,
  navigateToTestWeek,
} from './helpers.js';

// ── PLANNER FILTER TESTS ──────────────────────────────────────

// Seed Jan 7 classes; their bisque/glaze tasks land in the week of Jan 12.
const PLANNER_VIEW_WEEK = '2099-01-12';

test.describe('planner filters', () => {
  test.beforeEach(async ({ page }) => {
    await wipeTestWeek();
    autoAcceptPassword(page);
    await page.goto('/');
    await expect(page.locator('#task-table tbody tr.cat-header').first()).toBeVisible();

    // Seed two classes with different instructors. Their tasks span 4
    // weeks; week Jan 12 has bisque (Miso), bisque (Miso again), dip
    // glaze (shared), and Taster glaze (Cielo) — varied owners.
    await api('addClass', { weekKey: TEST_WEEK_KEY, type: 'Taster Class', date: '2099-01-07', instructor: 'cielo' });
    await api('addClass', { weekKey: TEST_WEEK_KEY, type: 'Matcha Bowl', date: '2099-01-07', instructor: 'angel' });

    // View the week where tasks are richest.
    await page.evaluate((key) => window.__jumpToWeek(key), PLANNER_VIEW_WEEK);
  });

  test.afterEach(async ({ page }) => {
    // Clear localStorage filters so tests don't bleed into each other.
    await page.evaluate(() => {
      localStorage.removeItem('mps_planner_staff');
      localStorage.removeItem('mps_planner_done');
    });
    await wipeTestWeek();
  });

  test('filter: default shows all open tasks (none filtered)', async ({ page }) => {
    await page.locator('button[data-tab="planner"]').click();
    const rows = page.locator('.planner-row');
    // Week Jan 12 carries multiple owners (miso, cielo, shared) — at
    // least 3 rows. Both classes contribute.
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThanOrEqual(3);

    // The "All staff" chip should be active by default.
    await expect(page.locator('.planner-chip').filter({ hasText: 'All staff' })).toHaveClass(/active/);
  });

  test('filter: clicking a staff chip filters to that staff only', async ({ page }) => {
    await page.locator('button[data-tab="planner"]').click();
    // Cielo's only task in Jan-12 week is the Taster Glaze (offset +10).
    await page.locator('.planner-chip').filter({ hasText: 'Cielo' }).click();
    await expect(page.locator('.planner-chip').filter({ hasText: 'Cielo' })).toHaveClass(/active/);

    // Every visible row should have Cielo selected in its owner picker.
    const rows = await page.locator('.planner-row').all();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const owner = await row.locator('.planner-owner').inputValue();
      expect(owner).toBe('cielo');
    }
  });

  test('filter: All staff resets the view', async ({ page }) => {
    await page.locator('button[data-tab="planner"]').click();
    await page.locator('.planner-chip').filter({ hasText: 'Cielo' }).click();
    const filteredCount = await page.locator('.planner-row').count();

    await page.locator('.planner-chip').filter({ hasText: 'All staff' }).click();
    const allCount = await page.locator('.planner-row').count();
    expect(allCount).toBeGreaterThan(filteredCount);
  });

  test('filter: Show done toggle reveals completed tasks', async ({ page }) => {
    // Pull a task from the viewed week, mark it done via API.
    const someTask = await page.evaluate((wk) =>
      window.__getDb().weeks[wk]?.weeklyTasks?.find(t => t.sourceKind === 'class'),
    PLANNER_VIEW_WEEK);
    expect(someTask).toBeTruthy();
    await api('markWeeklyTaskDone', { id: someTask.id, status: 'done' });

    // Reload the week so the server's done status is in our cache.
    await page.evaluate((key) => window.__jumpToWeek(key), PLANNER_VIEW_WEEK);
    await page.locator('button[data-tab="planner"]').click();

    const beforeRows = await page.locator('.planner-row').count();

    // Toggle Show done — the done row reappears.
    await page.locator('.planner-done-toggle input').check();
    await expect(page.locator('.planner-row.is-done').first()).toBeVisible();
    const afterRows = await page.locator('.planner-row').count();
    expect(afterRows).toBeGreaterThan(beforeRows);
  });

  test('filter: staff selection persists across page reload', async ({ page }) => {
    await page.locator('button[data-tab="planner"]').click();
    await page.locator('.planner-chip').filter({ hasText: 'Miso' }).click();

    await page.reload();
    autoAcceptPassword(page);
    await page.evaluate((key) => window.__jumpToWeek(key), PLANNER_VIEW_WEEK);
    await page.locator('button[data-tab="planner"]').click();

    await expect(page.locator('.planner-chip').filter({ hasText: 'Miso' })).toHaveClass(/active/);
  });
});

// ── STAFF PROPAGATION TESTS ───────────────────────────────────

test.describe('new staff propagation', () => {
  test.beforeEach(async () => {
    await wipeTestStaff();
  });

  test.afterEach(async () => {
    await wipeTestStaff();
  });

  test('adding staff: appears in legend, You: selector, Planner filter chips, and owner select', async ({ page }) => {
    const id = `${TEST_STAFF_PREFIX}phlox`;
    await adminApi('upsertStaff', {
      id, name: 'Phlox Test', color: '#FF6F61', initial: 'P', sortIdx: 50,
    });

    autoAcceptPassword(page);
    await page.goto('/');
    await expect(page.locator('#task-table tbody tr.cat-header').first()).toBeVisible();

    // Wait for the background loadStaff() to complete and re-render the
    // legend. It's fired without await, so we poll the legend.
    await expect(page.locator('.legend-item').filter({ hasText: 'Phlox Test' })).toBeVisible({ timeout: 5000 });

    // You: selector
    const opts = await page.locator('#current-user-select option').allTextContents();
    expect(opts).toContain('Phlox Test');

    // Planner filter chips
    await page.locator('button[data-tab="planner"]').click();
    await expect(page.locator('.planner-chip').filter({ hasText: 'Phlox Test' })).toBeVisible();

    // Planner row owner <select>: seed a class so a row exists, then check
    await api('addClass', { weekKey: TEST_WEEK_KEY, type: 'Taster Class', date: '2099-01-07', instructor: 'cielo' });
    await navigateToTestWeek(page);
    await page.locator('button[data-tab="planner"]').click();
    const ownerOptions = await page.locator('.planner-row .planner-owner').first().locator('option').allTextContents();
    expect(ownerOptions).toContain('Phlox Test');
    await wipeTestWeek();                 // clean up the seeded class
  });

  test('deactivating staff: hides them from selectors but DB row stays', async ({ page }) => {
    const id = `${TEST_STAFF_PREFIX}temporary`;
    await adminApi('upsertStaff', {
      id, name: 'Temporary Helper', color: '#9333EA', initial: 'TH', sortIdx: 51, active: true,
    });

    // Deactivate
    await adminApi('upsertStaff', {
      id, name: 'Temporary Helper', active: false,
    });

    autoAcceptPassword(page);
    await page.goto('/');
    await expect(page.locator('#task-table tbody tr.cat-header').first()).toBeVisible();
    // Allow background loadStaff to settle.
    await page.waitForTimeout(800);

    await expect(page.locator('.legend-item').filter({ hasText: 'Temporary Helper' })).toHaveCount(0);
    const opts = await page.locator('#current-user-select option').allTextContents();
    expect(opts).not.toContain('Temporary Helper');

    // The row still exists in the DB — important for FK preservation.
    const { staff } = await fetchStaff();
    const found = staff.find(s => s.id === id);
    expect(found).toBeDefined();
    expect(found.active).toBe(false);
  });

  test('admin API auto-derives id from name when not provided', async () => {
    const result = await adminApi('upsertStaff', {
      name: `${TEST_STAFF_PREFIX}AutoId Person`,
      color: '#10B981',
    });
    // First word of name, lowercased.
    expect(result.id).toBe(`${TEST_STAFF_PREFIX}autoid`);
    expect(result.initial).toBe('T');     // 't' from 'test-AutoId Person' uppercased
  });
});
