import { test, expect } from '@playwright/test';
import {
  TEST_WEEK_KEY,
  api,
  fetchWeek,
  wipeTestWeek,
  autoAcceptPassword,
  navigateToTestWeek,
} from './helpers.js';

test.beforeEach(async ({ page }) => {
  await wipeTestWeek();                   // start clean on the server
  autoAcceptPassword(page);               // auto-fill the prompt() dialog
  await page.goto('/');
  await expect(page.locator('#task-table tbody tr.cat-header').first()).toBeVisible();
  await navigateToTestWeek(page);
  await expect(page.locator('#week-label')).toContainText('Jan 5');
});

test.afterEach(async () => {
  await wipeTestWeek();                   // leave no trail
});

test('auth gate rejects a wrong password', async ({ page, baseURL }) => {
  const res = await page.request.get(`${baseURL}/api/state?week=${TEST_WEEK_KEY}`, {
    headers: { Authorization: 'Bearer definitely-wrong' },
  });
  expect(res.status()).toBe(401);
});

test('weekly-task cell: assign a staff member and persist through reload', async ({ page }) => {
  // QUARTERLY/MONTHLY/BI-WEEKLY are collapsed by default; only click visible cells.
  const firstEmptyCell = page.locator('tr:not(.hidden) .cell-add').first();
  await firstEmptyCell.click();

  // Checkboxes are CSS-hidden (display:none); users click the wrapping label.
  await page.locator('label.staff-check', { hasText: 'Nick' }).click();
  await page.locator('#cell-status').selectOption('in-progress');
  await page.locator('#cell-note').fill('playwright test');

  // Wait for the POST to complete before we reload, otherwise the request aborts.
  const [response] = await Promise.all([
    page.waitForResponse(r => r.url().includes('/api/state') && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Save' }).click(),
  ]);
  expect(response.ok()).toBeTruthy();

  // Chip is visible from the optimistic update
  await expect(page.locator('.cell-chip').first()).toBeVisible();

  // Reload and confirm persistence
  await page.reload();
  autoAcceptPassword(page);
  await navigateToTestWeek(page);
  await expect(page.locator('.cell-chip').first()).toBeVisible();

  // Server state matches
  const bundle = await fetchWeek();
  const taskIds = Object.keys(bundle.assignments);
  expect(taskIds.length).toBeGreaterThan(0);
  const firstTaskAssigns = bundle.assignments[taskIds[0]];
  const firstDay = firstTaskAssigns[Object.keys(firstTaskAssigns)[0]];
  expect(firstDay.assignees).toContain('nick');
  expect(firstDay.status).toBe('in-progress');
  expect(firstDay.note).toBe('playwright test');
});

test('classes tab: add a class and add a piece to it', async ({ page }) => {
  await page.locator('button[data-tab="classes"]').click();
  await expect(page.locator('#tab-classes.active')).toBeVisible();

  await page.getByRole('button', { name: '+ Add Class' }).click();
  await page.locator('#cls-num').fill('9999');
  await page.locator('#cls-type').fill('Taster [TEST]');
  await page.locator('#cls-date').fill('2099-01-07');
  await page.locator('#cls-instr').selectOption({ label: 'Cielo' });
  await page.locator('#cls-notes').fill('e2e smoke');
  await page.getByRole('button', { name: 'Save' }).click();

  // Class card rendered
  await expect(page.getByText(/Class #9999 — Taster \[TEST\]/)).toBeVisible();

  // Add a piece to this class
  await page.getByRole('button', { name: '+ Piece' }).click();
  await page.locator('#p-student').fill('Test Student');
  await page.locator('#p-desc').fill('mini bowl');
  await page.locator('#p-stage').selectOption('Greenware');
  await page.getByRole('button', { name: 'Save' }).click();

  // Piece row is visible
  await expect(page.getByText('Test Student')).toBeVisible();
  await expect(page.getByText('mini bowl')).toBeVisible();

  // Server state confirms
  const bundle = await fetchWeek();
  expect(bundle.classes).toHaveLength(1);
  expect(bundle.classes[0].classNum).toBe('9999');
  expect(bundle.classes[0].pieces).toHaveLength(1);
  expect(bundle.classes[0].pieces[0].student).toBe('Test Student');
  expect(bundle.classes[0].pieces[0].stageHistory).toHaveLength(1);
  expect(bundle.classes[0].pieces[0].stageHistory[0].stage).toBe('Greenware');
});

test('pieces: changing stage appends a stage_history entry', async ({ page }) => {
  // Seed a class + piece via the API to keep this test focused on the mutation under test.
  const cls   = await api('addClass',  { weekKey: TEST_WEEK_KEY, classNum: '9998', type: 'Matcha [TEST]' });
  const piece = await api('addPiece',  { classId: cls.id, student: 'S', description: 'bowl', stage: 'Greenware' });
  expect(piece.stageHistory).toHaveLength(1);

  // UI cache was loaded before the API seed — force a re-fetch so the class is visible.
  await navigateToTestWeek(page);

  await page.locator('button[data-tab="classes"]').click();
  await expect(page.getByText(/Class #9998/)).toBeVisible();

  // Open the piece's edit modal via the pencil icon
  await page.locator('.pieces-table .icon-btn').first().click();
  await page.locator('#p-stage').selectOption('Bisque');
  await page.getByRole('button', { name: 'Save' }).click();

  // Scope to the rendered class card — avoid matching the hidden <option>
  await expect(page.locator('#classes-list .stage-tag')).toContainText('Bisque');

  // Stage history should now have 2 entries
  const bundle = await fetchWeek();
  const updated = bundle.classes[0].pieces[0];
  expect(updated.stage).toBe('Bisque');
  expect(updated.stageHistory).toHaveLength(2);
  expect(updated.stageHistory[1].stage).toBe('Bisque');
  expect(typeof updated.stageHistory[1].at).toBe('string');
});

test('special tasks: add a task for Nick, then append an update', async ({ page }) => {
  await page.locator('button[data-tab="special"]').click();
  await expect(page.locator('#tab-special.active')).toBeVisible();

  // Each staff card has a "+" to add a task. Find Nick's card.
  const nickCard = page.locator('.staff-card').filter({ hasText: 'Nick' });
  await nickCard.getByRole('button', { name: '+' }).click();

  await page.locator('#st-title').fill('Review April schedule [TEST]');
  await page.locator('#st-scope').fill('Check instructor constraints');
  await page.locator('#st-deadline').fill('2099-01-09');
  await page.locator('#st-status').selectOption('in-progress');
  await page.getByRole('button', { name: 'Save' }).click();

  const taskCard = page.locator('.special-task-card').filter({ hasText: 'Review April schedule' });
  await expect(taskCard).toBeVisible();

  // Append an update
  await taskCard.getByRole('button', { name: '+ Update' }).click();
  await page.locator('#upd-text').fill('Started reviewing, waiting on Cielo');
  await page.locator('#upd-status').selectOption('in-progress');
  await page.getByRole('button', { name: 'Save Update' }).click();

  await expect(taskCard.getByText('Started reviewing')).toBeVisible();

  const bundle = await fetchWeek();
  expect(bundle.specialTasks).toHaveLength(1);
  expect(bundle.specialTasks[0].title).toMatch(/^Review April schedule/);
  expect(bundle.specialTasks[0].updates).toHaveLength(1);
  expect(bundle.specialTasks[0].updates[0].text).toMatch(/Started reviewing/);
});

test('delete class also cascades pieces', async ({ page }) => {
  const cls = await api('addClass',  { weekKey: TEST_WEEK_KEY, classNum: '1', type: 'X' });
  await api('addPiece', { classId: cls.id, student: 'Alice', description: 'cup', stage: 'Greenware' });

  // Force UI to re-fetch so the seeded class appears
  await navigateToTestWeek(page);

  await page.locator('button[data-tab="classes"]').click();
  await expect(page.getByText('Alice')).toBeVisible();

  // confirm() dialog is already auto-accepted by autoAcceptPassword in beforeEach.
  await page.getByRole('button', { name: 'Remove' }).click();

  await expect(page.getByText('Alice')).not.toBeVisible();

  const bundle = await fetchWeek();
  expect(bundle.classes).toHaveLength(0);
});

// ── PHASE 2: MY WEEK VIEW ─────────────────────────────────────

test('my week: empty state when no user selected', async ({ page }) => {
  // beforeEach lands on Weekly Tasks. Click My Week with no user.
  await page.locator('button[data-tab="me"]').click();
  await expect(page.locator('#me-content')).toContainText('Pick who you are');
});

test('my week: selecting a user lands on My Week and filters to their tasks only', async ({ page }) => {
  // Seed two weekly assignments (one to Nick, one to Cielo) and two special tasks.
  await api('setAssignment',  { weekKey: TEST_WEEK_KEY, taskId: 'w1', dayIdx: 1, assignees: ['nick'],  status: 'todo' });
  await api('setAssignment',  { weekKey: TEST_WEEK_KEY, taskId: 'w2', dayIdx: 2, assignees: ['cielo'], status: 'todo' });
  await api('addSpecialTask', { weekKey: TEST_WEEK_KEY, staffId: 'nick',  title: 'Nick special [TEST]' });
  await api('addSpecialTask', { weekKey: TEST_WEEK_KEY, staffId: 'cielo', title: 'Cielo special [TEST]' });
  await navigateToTestWeek(page);

  // Select Nick — should auto-switch to My Week
  await page.locator('#current-user-select').selectOption('nick');
  await expect(page.locator('#tab-me.active')).toBeVisible();
  await expect(page.locator('.me-banner-who')).toContainText('Nick');

  // Nick's items are present
  await expect(page.locator('#me-content')).toContainText('Nick special');
  // The weekly task name for 'w1' is "Organize materials and tools"
  await expect(page.locator('#me-content')).toContainText('Organize materials');

  // Cielo's items are NOT present
  await expect(page.locator('#me-content')).not.toContainText('Cielo special');
});

test('my week: selection persists through reload', async ({ page }) => {
  await page.locator('#current-user-select').selectOption('angel');
  await expect(page.locator('#tab-me.active')).toBeVisible();

  await page.reload();
  // Password prompt re-fires on reload — autoAcceptPassword handler from beforeEach is still attached.
  await expect(page.locator('#tab-me.active')).toBeVisible();
  await expect(page.locator('#current-user-select')).toHaveValue('angel');
  await expect(page.locator('.me-banner-who')).toContainText('Angel');
});

test('my week: overdue bucket surfaces past-due special tasks', async ({ page }) => {
  await api('addSpecialTask', {
    weekKey: TEST_WEEK_KEY, staffId: 'nick',
    title: 'Past due task [TEST]',
    deadline: '2099-01-01',                 // before the test week's Monday
    status: 'todo',
  });
  await navigateToTestWeek(page);

  await page.locator('#current-user-select').selectOption('nick');
  await expect(page.locator('[data-section="overdue"]')).toBeVisible();
  await expect(page.locator('[data-section="overdue"]')).toContainText('Past due task');
});

test('my week: clicking a special-task card opens its edit modal', async ({ page }) => {
  const task = await api('addSpecialTask', {
    weekKey: TEST_WEEK_KEY, staffId: 'nick',
    title: 'Clickable task [TEST]',
  });
  await navigateToTestWeek(page);

  await page.locator('#current-user-select').selectOption('nick');
  await page.locator('.me-card').filter({ hasText: 'Clickable task' }).click();

  // Modal opens with the task's fields
  await expect(page.locator('#st-title')).toHaveValue('Clickable task [TEST]');
});
