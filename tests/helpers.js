// Helpers shared by every spec:
//   - TEST_WEEK_KEY: a far-future Monday, far from any real data.
//   - api(): calls /api/state the same way the frontend does.
//   - wipeTestWeek(): deletes everything in the test week so runs start clean.
//   - enterPassword(): accepts the window.prompt dialog on page load.

export const TEST_WEEK_KEY   = '2099-01-05';   // Monday in the far future
export const TEST_GOAL_MARK  = '[GOALTEST]';   // unique marker for test goals
export const TEST_TARGET_ISO = '2099-05-10';   // target date used by goal tests

const BASE = process.env.BASE_URL;
const PW   = process.env.STUDIO_PASSWORD;

export async function api(op, payload = {}) {
  const res = await fetch(`${BASE}/api/state`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${PW}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ op, ...payload }),
  });
  if (!res.ok) throw new Error(`api ${op} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function fetchWeek(weekKey = TEST_WEEK_KEY) {
  const res = await fetch(`${BASE}/api/state?week=${weekKey}`, {
    headers: { 'Authorization': `Bearer ${PW}` },
  });
  if (!res.ok) throw new Error(`fetchWeek failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function wipeTestWeek() {
  const bundle = await fetchWeek();

  // Clear every cell assignment
  for (const [taskId, days] of Object.entries(bundle.assignments || {})) {
    for (const dayIdx of Object.keys(days)) {
      await api('clearAssignment', { weekKey: TEST_WEEK_KEY, taskId, dayIdx: Number(dayIdx) });
    }
  }

  // Cascade-delete classes removes their pieces automatically.
  for (const c of bundle.classes || [])       await api('deleteClass',       { id: c.id });
  for (const t of bundle.specialTasks || [])  await api('deleteSpecialTask', { id: t.id });
}

export async function goalsApiRaw(op, payload = {}) {
  const res = await fetch(`${BASE}/api/goals`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${PW}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ op, ...payload }),
  });
  if (!res.ok) throw new Error(`goals ${op} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function fetchGoals() {
  const res = await fetch(`${BASE}/api/goals`, { headers: { 'Authorization': `Bearer ${PW}` } });
  if (!res.ok) throw new Error(`fetchGoals failed: ${res.status}`);
  return res.json();
}

// Only delete goals marked with the test prefix — keeps accidentally-created
// real goals safe if a dev runs the suite against prod data.
export async function wipeTestGoals() {
  const { goals } = await fetchGoals();
  for (const g of goals) {
    if (g.title?.includes(TEST_GOAL_MARK)) {
      await goalsApiRaw('deleteGoal', { id: g.id });
    }
  }
}

// Wait until the week bundle satisfies the predicate, polling the API.
export async function waitForWeek(predicate, { timeoutMs = 5_000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const bundle = await fetchWeek();
    if (predicate(bundle)) return bundle;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  const bundle = await fetchWeek();
  throw new Error(`waitForWeek timed out. Last bundle: ${JSON.stringify(bundle).slice(0, 400)}`);
}

// Auto-accept the window.prompt password dialog. Call before page.goto().
// Also logs any browser console errors / page errors to the test output so
// UI failures aren't silent.
export function autoAcceptPassword(page) {
  page.on('dialog', async dialog => {
    if (dialog.type() === 'prompt') await dialog.accept(PW);
    else await dialog.accept();
  });
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      console.log(`[browser ${msg.type()}] ${msg.text()}`);
    }
  });
  page.on('pageerror', err => console.log(`[pageerror] ${err.message}`));
  page.on('requestfailed', req => console.log(`[reqfail] ${req.method()} ${req.url()} — ${req.failure()?.errorText}`));
}

// Jump to the test week via the __jumpToWeek test hook in index.html.
export async function navigateToTestWeek(page) {
  await page.evaluate((key) => window.__jumpToWeek(key), TEST_WEEK_KEY);
}
