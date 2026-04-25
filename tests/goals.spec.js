import { test, expect } from '@playwright/test';
import {
  TEST_WEEK_KEY,
  TEST_GOAL_MARK,
  TEST_TARGET_ISO,
  api,
  fetchWeek,
  fetchGoals,
  goalsApiRaw,
  wipeTestWeek,
  wipeTestGoals,
  autoAcceptPassword,
  navigateToTestWeek,
} from './helpers.js';

test.beforeEach(async ({ page }) => {
  await Promise.all([wipeTestWeek(), wipeTestGoals()]);
  autoAcceptPassword(page);
  await page.goto('/');
  await expect(page.locator('#task-table tbody tr.cat-header').first()).toBeVisible();
});

test.afterEach(async () => {
  await wipeTestGoals();
});

test('goals: create a freeform goal from the UI', async ({ page }) => {
  await page.locator('button[data-tab="goals"]').click();
  await expect(page.locator('#tab-goals.active')).toBeVisible();

  await page.getByRole('button', { name: '+ New Goal' }).click();
  await page.locator('#goal-title').fill(`Freeform ${TEST_GOAL_MARK}`);
  await page.locator('#goal-target').fill(TEST_TARGET_ISO);
  await page.getByRole('button', { name: 'Create' }).click();

  await expect(page.locator('.goal-card').filter({ hasText: `Freeform ${TEST_GOAL_MARK}` })).toBeVisible();

  const { goals } = await fetchGoals();
  const mine = goals.filter(g => g.title.includes(TEST_GOAL_MARK));
  expect(mine).toHaveLength(1);
  expect(mine[0].targetDate).toBe(TEST_TARGET_ISO);
  expect(mine[0].totalTasks).toBe(0);
});

test('goals: creating a goal from the Campaign Launch template sets correct deadlines', async ({ page }) => {
  await page.locator('button[data-tab="goals"]').click();
  await page.getByRole('button', { name: '+ New Goal' }).click();

  await page.locator('#goal-title').fill(`Template ${TEST_GOAL_MARK}`);
  await page.locator('#goal-target').fill(TEST_TARGET_ISO);          // Mother's Day 2099 — 2099-05-10
  await page.locator('#goal-template').selectOption({ label: 'Campaign Launch' });

  // Preview should appear once a template is chosen
  await expect(page.locator('.template-preview')).toBeVisible();
  await expect(page.locator('.template-preview')).toContainText('Planning');

  await page.getByRole('button', { name: 'Create' }).click();

  const card = page.locator('.goal-card').filter({ hasText: `Template ${TEST_GOAL_MARK}` });
  await expect(card).toBeVisible();
  await expect(card).toContainText('45 done');      // "0 / 45 done"
  await expect(card.locator('.goal-progress-label')).toContainText('0 / 45');

  // Verify Day 1 → target - 13 and Day 14 → target on the server side.
  const { goals } = await fetchGoals();
  const goal = goals.find(g => g.title.includes(TEST_GOAL_MARK));
  expect(goal).toBeDefined();
  const detailRes = await fetch(`${process.env.BASE_URL}/api/goals?id=${goal.id}`, {
    headers: { Authorization: `Bearer ${process.env.STUDIO_PASSWORD}` },
  });
  const detail = await detailRes.json();

  const day1 = detail.tasks.find(t => t.title.startsWith('Day 1 — Campaign Teaser'));
  const day14 = detail.tasks.find(t => t.title.startsWith('Day 14 — Last Chance Reminder'));
  expect(day1.deadline).toBe('2099-04-27');   // 2099-05-10 minus 13 days
  expect(day14.deadline).toBe(TEST_TARGET_ISO);
});

test('goals: expanding a card loads its tasks and edit round-trips', async ({ page }) => {
  // Seed a freeform goal + one task via API so the test focuses on expand/edit UX.
  const created = await goalsApiRaw('createGoal', {
    title: `Expand ${TEST_GOAL_MARK}`, targetDate: TEST_TARGET_ISO,
  });
  await goalsApiRaw('addGoalTask', {
    goalId:   created.goal.id,
    section:  'Planning',
    title:    'Initial task',
    status:   'todo',
  });

  await page.locator('button[data-tab="goals"]').click();
  const card = page.locator('.goal-card').filter({ hasText: `Expand ${TEST_GOAL_MARK}` });

  await card.locator('.goal-card-head').click();
  await expect(card).toHaveClass(/expanded/);
  await expect(card.getByText('Initial task')).toBeVisible();

  // Edit: change status to done
  await card.getByText('Initial task').click();
  await page.locator('#gt-status').selectOption('done');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(card.getByText('Initial task')).toBeVisible();
  await expect(card).toContainText('1 / 1 done');
});

test('goals: deleting a goal removes it from the list', async ({ page }) => {
  const created = await goalsApiRaw('createGoal', {
    title: `ToDelete ${TEST_GOAL_MARK}`, targetDate: TEST_TARGET_ISO,
  });

  await page.locator('button[data-tab="goals"]').click();
  const card = page.locator('.goal-card').filter({ hasText: `ToDelete ${TEST_GOAL_MARK}` });
  await card.locator('.goal-card-head').click();

  // confirm() auto-accepted by autoAcceptPassword
  await card.getByRole('button', { name: 'Delete' }).click();

  await expect(card).not.toBeVisible();
  const { goals } = await fetchGoals();
  expect(goals.find(g => g.id === created.goal.id)).toBeUndefined();
});

// ── PHASE 3.5: SUB-GOALS + TEMPLATE LIBRARY ─────────────────────────

test('templates: all 6 templates are seeded and pickable in the New Goal modal', async ({ page }) => {
  await page.locator('button[data-tab="goals"]').click();
  await page.getByRole('button', { name: '+ New Goal' }).click();
  // openNewGoalModal is async (awaits loadGoals when needed) — wait for the
  // template select to appear before reading its options.
  await expect(page.locator('#goal-template')).toBeVisible();

  const options = await page.locator('#goal-template option').allTextContents();
  // The "— Freeform —" option plus 6 templates.
  expect(options.length).toBeGreaterThanOrEqual(7);
  expect(options).toEqual(expect.arrayContaining([
    expect.stringContaining('Campaign Launch'),
    expect.stringContaining('New Class Launch'),
    expect.stringContaining('Seasonal Promotion'),
    expect.stringContaining('Lapsed Customer Re-engagement'),
    expect.stringContaining('Kiln / Studio Maintenance Cycle'),
    expect.stringContaining('New Instructor Onboarding'),
  ]));
});

test('templates: title keyword auto-suggests a matching template', async ({ page }) => {
  await page.locator('button[data-tab="goals"]').click();
  await page.getByRole('button', { name: '+ New Goal' }).click();

  // Typing "Mother's Day" should suggest Seasonal Promotion.
  await page.locator('#goal-title').fill(`Mother's Day push ${TEST_GOAL_MARK}`);
  await expect(page.locator('#template-suggestion')).toContainText('Seasonal Promotion');
  // Preview shows the seasonal sections
  await expect(page.locator('.template-preview')).toContainText('Strategy');

  // Switching to "kiln maintenance" should re-suggest the maintenance cycle.
  await page.locator('#goal-title').fill(`Q3 kiln maintenance ${TEST_GOAL_MARK}`);
  await expect(page.locator('#template-suggestion')).toContainText('Kiln');
});

test('sub-goals: create a parent + child, rollup progress includes child tasks', async ({ page }) => {
  // Seed parent + child via API to keep the test focused on the tree behavior.
  const parent = await goalsApiRaw('createGoal', {
    title:      `Parent ${TEST_GOAL_MARK}`,
    targetDate: TEST_TARGET_ISO,
  });
  const child = await goalsApiRaw('createGoal', {
    title:      `Child ${TEST_GOAL_MARK}`,
    targetDate: TEST_TARGET_ISO,
    parentId:   parent.goal.id,
  });
  // 2 tasks on the child, one done.
  await goalsApiRaw('addGoalTask', { goalId: child.goal.id, title: 'A', status: 'todo' });
  await goalsApiRaw('addGoalTask', { goalId: child.goal.id, title: 'B', status: 'done' });

  await page.locator('button[data-tab="goals"]').click();

  const parentCard = page.locator('.goal-card').filter({ hasText: `Parent ${TEST_GOAL_MARK}` }).first();
  const childCard  = page.locator('.goal-card').filter({ hasText: `Child ${TEST_GOAL_MARK}` }).first();

  await expect(parentCard).toBeVisible();
  await expect(childCard).toBeVisible();

  // Parent shows the sub-goal count badge
  await expect(parentCard).toContainText('1 sub-goal');

  // Parent rolls up child's task counts: 1 / 2 done (rolled up)
  await expect(parentCard).toContainText('1 / 2');
  await expect(parentCard).toContainText('rolled up');

  // Child card is rendered nested under the parent (inside .goal-tree-children)
  const nested = parentCard.locator('xpath=ancestor::div[@class="goal-tree-node"][1]')
    .locator('.goal-tree-children .goal-card').filter({ hasText: `Child ${TEST_GOAL_MARK}` });
  await expect(nested).toBeVisible();
});

test('sub-goals: + Sub-goal button creates a child under the parent', async ({ page }) => {
  const parent = await goalsApiRaw('createGoal', {
    title:      `Parent2 ${TEST_GOAL_MARK}`,
    targetDate: TEST_TARGET_ISO,
  });

  await page.locator('button[data-tab="goals"]').click();
  const card = page.locator('.goal-card').filter({ hasText: `Parent2 ${TEST_GOAL_MARK}` }).first();
  await card.locator('.goal-card-head').click();

  await card.getByRole('button', { name: '+ Sub-goal' }).click();
  // Modal title should reference the parent
  await expect(page.locator('.modal-header h3')).toContainText(`Parent2 ${TEST_GOAL_MARK}`);
  // The parent select should be pre-selected to the parent
  await expect(page.locator('#goal-parent')).toHaveValue(parent.goal.id);

  await page.locator('#goal-title').fill(`Spawned child ${TEST_GOAL_MARK}`);
  await page.getByRole('button', { name: 'Create' }).click();

  // Child appears under the parent
  const tree = page.locator('.goal-tree-node').filter({ hasText: `Parent2 ${TEST_GOAL_MARK}` }).first();
  await expect(tree.locator('.goal-tree-children').getByText(`Spawned child ${TEST_GOAL_MARK}`)).toBeVisible();

  const { goals } = await fetchGoals();
  const spawned = goals.find(g => g.title.includes('Spawned child'));
  expect(spawned?.parentId).toBe(parent.goal.id);
});

test('my week: goal tasks due this week appear for the assigned user', async ({ page }) => {
  // Create a goal with target in the TEST_WEEK_KEY week, assign a task to Nick
  // with a deadline inside that week.
  const created = await goalsApiRaw('createGoal', {
    title:      `MyWeekGoal ${TEST_GOAL_MARK}`,
    targetDate: TEST_WEEK_KEY,                 // 2099-01-05
  });
  await goalsApiRaw('addGoalTask', {
    goalId:   created.goal.id,
    section:  'Planning',
    title:    `Nick's goal task ${TEST_GOAL_MARK}`,
    owner:    'nick',
    deadline: '2099-01-06',                    // Tuesday in the test week
    status:   'todo',
  });

  await navigateToTestWeek(page);

  await page.locator('#current-user-select').selectOption('nick');
  await expect(page.locator('#tab-me.active')).toBeVisible();

  const card = page.locator('.me-card').filter({ hasText: `Nick's goal task ${TEST_GOAL_MARK}` });
  await expect(card).toBeVisible();
  await expect(card.locator('.me-card-source')).toHaveText('Goal');

  // Clicking it opens the goal-task edit modal pre-populated with the task
  await card.click();
  await expect(page.locator('#gt-title')).toHaveValue(`Nick's goal task ${TEST_GOAL_MARK}`);
});
