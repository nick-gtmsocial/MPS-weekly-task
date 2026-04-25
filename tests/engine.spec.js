import { test, expect } from '@playwright/test';
import {
  TEST_WEEK_KEY,
  api,
  fetchWeek,
  wipeTestWeek,
  generateApi,
  autoAcceptPassword,
  navigateToTestWeek,
} from './helpers.js';

// Phase 4 — class-driven operations engine. These specs exercise the
// generation pipeline (class type → weekly_tasks rows) and the My Week
// surfacing.

test.beforeEach(async ({ page }) => {
  await wipeTestWeek();
  autoAcceptPassword(page);
  await page.goto('/');
  await expect(page.locator('#task-table tbody tr.cat-header').first()).toBeVisible();
  await navigateToTestWeek(page);
});

test.afterEach(async () => {
  await wipeTestWeek();
});

test('engine: adding a Taster Class generates 5 post-processing tasks', async () => {
  const cls = await api('addClass', {
    weekKey: TEST_WEEK_KEY,
    type:    'Taster Class',
    date:    '2099-01-07',           // Wednesday in test week
    instructor: 'cielo',
  });
  expect(cls.generation).toBeTruthy();
  // New minimal lifecycle: Trim → Bisque → Glaze → Glaze fire → Mark ready
  expect(cls.generation.totalTasks).toBe(5);
  expect(cls.generation.batchKeys).toEqual(expect.arrayContaining([
    expect.stringMatching(/^bisque-\d{4}-\d{2}-\d{2}$/),
    expect.stringMatching(/^glaze-fire-\d{4}-\d{2}-\d{2}$/),
  ]));
});

test('engine: deadlines compute correctly from offset_days', async () => {
  await api('addClass', {
    weekKey: TEST_WEEK_KEY,
    type:    'Taster Class',
    date:    '2099-01-07',
    instructor: 'cielo',
  });

  // Bisque fire (offset +6) — lands in week of Jan 12.
  const wk2 = await fetchWeek('2099-01-12');
  const bisque = wk2.weeklyTasks.find(t => t.title === 'Bisque fire' && t.phase === 'bisque');
  expect(bisque).toBeDefined();
  expect(bisque.dueDate).toBe('2099-01-13');         // 2099-01-07 + 6
  expect(bisque.batchKey).toBe('bisque-2099-01-12');
  expect(bisque.assignee).toBe('miso');               // Cielo's rule: Miso loads the kiln

  // Mark ready (offset +16) — lands in week of Jan 19.
  const wk3 = await fetchWeek('2099-01-19');
  const ready = wk3.weeklyTasks.find(t => t.title.startsWith('Mark ready'));
  expect(ready).toBeDefined();
  expect(ready.dueDate).toBe('2099-01-23');          // 2099-01-07 + 16
});

test('engine: batching — two Tasters in same week share bisque batch_key', async () => {
  await api('addClass', { weekKey: TEST_WEEK_KEY, type: 'Taster Class', date: '2099-01-07', instructor: 'cielo' });
  await api('addClass', { weekKey: TEST_WEEK_KEY, type: 'Taster Class', date: '2099-01-09', instructor: 'angel' });

  const bundle = await fetchWeek('2099-01-12');
  const bisques = bundle.weeklyTasks.filter(t => t.phase === 'bisque' && t.title === 'Bisque fire');
  expect(bisques.length).toBe(2);
  // Both should share the same batch_key (phase+week_key).
  expect(bisques[0].batchKey).toBe(bisques[1].batchKey);
  expect(bisques[0].batchKey).toBe('bisque-2099-01-12');
});

test('engine: regenerating is idempotent — does not duplicate rows', async () => {
  const cls = await api('addClass', { weekKey: TEST_WEEK_KEY, type: 'Taster Class', date: '2099-01-07', instructor: 'cielo' });

  const before = await fetchWeek(TEST_WEEK_KEY);
  const beforeCount = before.weeklyTasks.length;

  // Force a regen via the explicit endpoint
  await generateApi('forClass', { classId: cls.id });

  const after = await fetchWeek(TEST_WEEK_KEY);
  expect(after.weeklyTasks.length).toBe(beforeCount);
});

test('engine: free-form class type does not break addClass', async () => {
  const cls = await api('addClass', {
    weekKey: TEST_WEEK_KEY,
    type:    'Random one-off workshop [no template]',
    date:    '2099-01-07',
    instructor: 'cielo',
  });
  // Class still inserted, generation reports skipped (no matching class_type).
  expect(cls.id).toBeTruthy();
  expect(cls.generation?.skipped).toBe(1);

  const bundle = await fetchWeek(TEST_WEEK_KEY);
  // No class-driven weekly_tasks for this class
  const myClassTasks = bundle.weeklyTasks.filter(t => t.classId === cls.id);
  expect(myClassTasks.length).toBe(0);
});

test('engine: My Week surfaces auto-generated task for the assigned staff', async ({ page }) => {
  // Cielo's hand-paint Glaze task fires at offset +10, so for a class on
  // Jan 7 it lands in the week of Jan 12. Navigate there to verify.
  await api('addClass', { weekKey: TEST_WEEK_KEY, type: 'Taster Class', date: '2099-01-07', instructor: 'cielo' });

  await page.reload();
  autoAcceptPassword(page);
  await page.evaluate((key) => window.__jumpToWeek(key), '2099-01-12');

  await page.locator('#current-user-select').selectOption('cielo');
  await expect(page.locator('#tab-me.active')).toBeVisible();

  await expect(page.locator('#me-content')).toContainText('Glaze pieces');
  await expect(page.locator('#me-content')).toContainText('Taster Class');
});

test('engine: marking a weekly task done updates server status', async () => {
  await api('addClass', { weekKey: TEST_WEEK_KEY, type: 'Taster Class', date: '2099-01-07', instructor: 'cielo' });

  // Find Cielo's glaze task in week 2 and mark it done via the API
  const wk2 = await fetchWeek('2099-01-12');
  const cieloTasks = wk2.weeklyTasks.filter(t => t.assignee === 'cielo');
  expect(cieloTasks.length).toBeGreaterThan(0);
  const target = cieloTasks[0];

  await api('markWeeklyTaskDone', { id: target.id });

  const after = await fetchWeek('2099-01-12');
  const updated = after.weeklyTasks.find(t => t.id === target.id);
  expect(updated.status).toBe('done');
});
