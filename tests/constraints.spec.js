import { test, expect } from '@playwright/test';
import {
  TEST_WEEK_KEY,
  api,
  fetchWeek,
  wipeTestWeek,
  autoAcceptPassword,
  navigateToTestWeek,
} from './helpers.js';

// Constraint detection: kiln conflicts + Miso availability rules.
// These tests assert the API surfaces warnings AND the UI shows them.

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

test('constraints: assigning Miso to a Sunday returns an "unavailable" warning', async () => {
  // Add a manual task on Sunday Jan 11 2099, assigned to Miso.
  const result = await api('addManualWeeklyTask', {
    weekKey:  '2099-01-05',
    dueDate:  '2099-01-11',          // Sunday
    title:    'Manual test task — Miso on Sunday',
    assignee: 'miso',
  });
  expect(result.warnings).toBeDefined();
  expect(result.warnings.some(w => w.kind === 'unavailable')).toBe(true);
});

test('constraints: same-phase same-day = batched fire (no conflict)', async ({ page }) => {
  // Two Tasters on the same day → both produce a bisque task on day +6.
  // Both bisques sharing a day is the studio's batching pattern, NOT a
  // conflict — the kiln gets packed once and fired once.
  await api('addClass', { weekKey: TEST_WEEK_KEY, type: 'Taster Class', date: '2099-01-07', instructor: 'cielo' });
  await api('addClass', { weekKey: TEST_WEEK_KEY, type: 'Taster Class', date: '2099-01-07', instructor: 'angel' });

  const bundle = await fetchWeek('2099-01-12');
  const bisques = bundle.weeklyTasks.filter(t => t.title === 'Bisque fire' && t.dueDate === '2099-01-13');
  expect(bisques.length).toBeGreaterThanOrEqual(2);

  // Re-assign one of them — API should NOT flag a kiln conflict.
  const res = await api('assignWeeklyTask', { id: bisques[0].id, assignee: 'miso' });
  expect(res.warnings.filter(w => w.kind === 'kiln-conflict')).toHaveLength(0);

  // UI: no red kiln-conflict pill on the planner for these batched fires.
  await page.evaluate(() => window.__jumpToWeek('2099-01-12'));
  await page.locator('button[data-tab="planner"]').click();
  await expect(page.locator('.task-flag.flag-kiln-conflict')).toHaveCount(0);
});

test('constraints: cross-phase same-day = real kiln conflict (flagsFor unit check)', async ({ page }) => {
  // Use the client-side flagsFor directly — the API layer doesn't yet have
  // a path that emits a glaze-fire and a bisque on the same day, but the
  // pure function is the source of truth shared with the server.
  await page.evaluate(() => window.__jumpToWeek('2099-01-05'));
  const flags = await page.evaluate(() => window.flagsFor(
    { id: 'a', dueDate: '2099-01-08', phase: 'bisque',     assignee: null, status: 'todo' },
    [{ id: 'b', dueDate: '2099-01-08', phase: 'glaze-fire', assignee: null, status: 'todo' }],
  ));
  expect(flags.some(f => f.kind === 'kiln-conflict')).toBe(true);
});

test('constraints: moving a task to a Miso day surfaces no warning', async () => {
  const result = await api('addManualWeeklyTask', {
    weekKey:  '2099-01-05',
    dueDate:  '2099-01-08',          // Thursday — valid
    title:    'Tuesday-Friday valid Miso task',
    assignee: 'miso',
  });
  expect(result.warnings.filter(w => w.kind === 'unavailable')).toHaveLength(0);
  expect(result.warnings.filter(w => w.kind === 'over-cap')).toHaveLength(0);
});

test('constraints: client-side flagsFor matches API warnings', async ({ page }) => {
  // Add an unambiguously-flagged row, then read the same row from the
  // page's perspective and assert the client computes the same flag.
  const created = await api('addManualWeeklyTask', {
    weekKey:  '2099-01-05',
    dueDate:  '2099-01-11',
    title:    'Cross-check Miso Sunday',
    assignee: 'miso',
  });

  await page.evaluate(() => window.__jumpToWeek('2099-01-05'));
  const clientFlags = await page.evaluate((id) => {
    const all = window.__getDb().weeks['2099-01-05']?.weeklyTasks || [];
    const me  = all.find(t => t.id === id);
    return window.flagsFor ? window.flagsFor(me, all) : [];
  }, created.id);

  // Both sides should report 'unavailable' for Miso on Sunday.
  expect(clientFlags.some(f => f.kind === 'unavailable')).toBe(true);
});
