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

test('engine: adding a Taster Class auto-generates ~13 weekly_tasks rows', async () => {
  const cls = await api('addClass', {
    weekKey: TEST_WEEK_KEY,
    type:    'Taster Class',
    date:    '2099-01-07',           // Wednesday in test week
    instructor: 'cielo',
  });
  expect(cls.generation).toBeTruthy();
  expect(cls.generation.totalTasks).toBeGreaterThan(10);
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

  // Pull the Jan 12 week — bisque load (offset +6) lands here.
  const bundle = await fetchWeek('2099-01-12');
  const bisqueLoad = bundle.weeklyTasks.find(t => t.title === 'Bisque load' && t.phase === 'bisque');
  expect(bisqueLoad).toBeDefined();
  expect(bisqueLoad.dueDate).toBe('2099-01-13');     // 2099-01-07 + 6
  expect(bisqueLoad.batchKey).toBe('bisque-2099-01-12');

  // Glaze fire unload (offset +15) lands in week of Jan 19.
  const week3 = await fetchWeek('2099-01-19');
  const glazeUnload = week3.weeklyTasks.find(t => t.title.startsWith('Glaze fire unload'));
  expect(glazeUnload).toBeDefined();
  expect(glazeUnload.dueDate).toBe('2099-01-22');    // 2099-01-07 + 15
});

test('engine: batching — two Tasters in same week share bisque batch_key', async () => {
  await api('addClass', { weekKey: TEST_WEEK_KEY, type: 'Taster Class', date: '2099-01-07', instructor: 'cielo' });
  await api('addClass', { weekKey: TEST_WEEK_KEY, type: 'Taster Class', date: '2099-01-09', instructor: 'angel' });

  const bundle = await fetchWeek('2099-01-12');
  const bisqueLoads = bundle.weeklyTasks.filter(t => t.phase === 'bisque' && t.title === 'Bisque load');
  expect(bisqueLoads.length).toBe(2);
  // Both should share the same batch_key (phase+week_key).
  expect(bisqueLoads[0].batchKey).toBe(bisqueLoads[1].batchKey);
  expect(bisqueLoads[0].batchKey).toBe('bisque-2099-01-12');
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
  // Generate tasks for cielo
  await api('addClass', { weekKey: TEST_WEEK_KEY, type: 'Taster Class', date: '2099-01-07', instructor: 'cielo' });

  // Refresh the page so the My Week cache is fresh
  await page.reload();
  autoAcceptPassword(page);
  await navigateToTestWeek(page);

  // Pick "Cielo" as current user — should land on My Week
  await page.locator('#current-user-select').selectOption('cielo');
  await expect(page.locator('#tab-me.active')).toBeVisible();

  // The auto-generated "Run class" task is assigned to the instructor (cielo)
  await expect(page.locator('#me-content')).toContainText('Run class');
  // And shows the class context
  await expect(page.locator('#me-content')).toContainText('Taster Class');
});

test('engine: marking a weekly task done updates server status', async ({ page }) => {
  await api('addClass', { weekKey: TEST_WEEK_KEY, type: 'Taster Class', date: '2099-01-07', instructor: 'cielo' });

  // Pick the first task assigned to cielo and mark it done via the API
  // (UI quick-done has a confirm() dialog — exercised in a separate test)
  const bundle = await fetchWeek(TEST_WEEK_KEY);
  const cieloTasks = bundle.weeklyTasks.filter(t => t.assignee === 'cielo');
  expect(cieloTasks.length).toBeGreaterThan(0);
  const target = cieloTasks[0];

  await api('markWeeklyTaskDone', { id: target.id });

  const after = await fetchWeek(TEST_WEEK_KEY);
  const updated = after.weeklyTasks.find(t => t.id === target.id);
  expect(updated.status).toBe('done');
});
