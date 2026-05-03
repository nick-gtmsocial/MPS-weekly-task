// Generation engine: turns class types, recurring task definitions, and
// goal/special tasks into concrete weekly_tasks rows.
//
// All generators are idempotent — the unique constraints in 0004 enforce
// "no duplicate row per (source, identity, week)" at the DB level, and we
// upsert via on_conflict so re-running just updates timestamps.
//
// Design notes:
//   - week_key for a row = Monday of the row's due_date.
//   - Batchable phases get batch_key = `${phase}-${week_key}` so cross-class
//     bisque/glaze rows merge under one card in the UI.
//   - default_owner='shared' / null fallback to class.instructor for
//     class-derived tasks; otherwise stays null and the manager assigns.

import { sbGet, sbPost, sbPatch, sbDelete } from './supabase.js';
import { KILN_FIRE_PHASES, findNextValidDay } from './constraints.js';

// ─── Date utilities ───────────────────────────────────────────

export function addDaysIso(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function mondayIso(iso) {
  const d   = new Date(`${iso}T12:00:00Z`);
  const dow = d.getUTCDay();                // 0 = Sunday, 1 = Mon, ... 6 = Sat
  const offset = dow === 0 ? -6 : 1 - dow;  // back to Monday
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

// ISO week-of-year for biweekly cadence parity. Cf. ISO-8601 spec.
function isoWeek(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86_400_000) + 1) / 7);
}

// ─── Kiln-aware due-date placement ───────────────────────────

// Look up the next team-scheduled fire of `phase` whose date is on/after
// `notBefore`. Returns ISO date or null. Swallows errors (e.g., the
// fire_schedule migration hasn't been applied yet) so a partial deploy
// doesn't break class generation — we just fall through to walk-forward.
async function nextScheduledFireDate(phase, notBefore) {
  if (!phase || !KILN_FIRE_PHASES.includes(phase)) return null;
  try {
    const rows = await sbGet(
      `fire_schedule?deleted_at=is.null&phase=eq.${phase}&fire_date=gte.${notBefore}&select=fire_date&order=fire_date.asc&limit=1`
    );
    return rows[0]?.fire_date || null;
  } catch (e) {
    console.warn('fire_schedule lookup failed (table missing? migration pending?)', e.message);
    return null;
  }
}

// Decide where a kiln-phase task should land. Order of preference:
//  1) Earliest team-scheduled fire of the matching phase on/after the
//     task's "earliest acceptable" date (class_date + offset_days). This
//     makes Cielo's Kiln tab the authoritative source of fire timing.
//  2) Walk-forward via findNextValidDay, which respects existing kiln load.
//     Used when the team hasn't planned a fire that far out yet.
//  3) Last resort: the originally-computed offset day, even if conflicting
//     — better to surface a flagged task than silently drop work.
async function placeKilnTask(phase, earliestIso, otherTasks) {
  const scheduled = await nextScheduledFireDate(phase, earliestIso);
  if (scheduled) return { date: scheduled, source: 'fire_schedule' };

  const walked = findNextValidDay(
    { fromIso: earliestIso, phase, assignee: null },
    otherTasks,
  );
  if (walked) return { date: walked, source: 'walk_forward' };

  return { date: earliestIso, source: 'fallback' };
}

// ─── generateForClass ────────────────────────────────────────

// Given a class_id, walk its class_type's tasks and emit one weekly_tasks
// row per per-class task, plus N rows per per-piece task × pieces.
//
// Kiln-phase tasks (bisque, glaze-fire) snap to the next team-scheduled
// fire day on/after class_date+offset_days; non-kiln tasks land on the
// offset day directly.
//
// Returns { inserted, updated, skipped, totalTasks, batchKeys }.
export async function generateForClass(classId) {
  if (!classId) throw new Error('classId required');

  const [cls] = await sbGet(`classes?id=eq.${classId}&deleted_at=is.null&select=id,type,class_date,instructor,pieces(id,deleted_at)`);
  if (!cls) throw new Error(`class not found (or soft-deleted): ${classId}`);
  // Strip soft-deleted pieces — they shouldn't spawn per-piece tasks.
  if (cls.pieces) cls.pieces = cls.pieces.filter(p => !p.deleted_at);
  if (!cls.class_date) throw new Error(`class ${classId} has no class_date — cannot compute offsets`);

  // Resolve the class type. classes.type is the human-readable name (e.g.,
  // "Taster Class") — we look it up by name. Manual classes might have a
  // free-form type that doesn't match anything; in that case we no-op.
  const types = await sbGet(`class_types?name=eq.${encodeURIComponent(cls.type || '')}&select=id,name,pieces_per_student,class_type_tasks(*)`);
  const ct = types[0];
  if (!ct) {
    return { inserted: 0, updated: 0, skipped: 1, totalTasks: 0, batchKeys: [], reason: `no class_type matches "${cls.type}"` };
  }
  const tasks = (ct.class_type_tasks || []).sort((a, b) => a.sort_idx - b.sort_idx);

  // Prefetch valid staff ids so we can defensively null out assignees
  // referencing instructors who aren't in our staff table (e.g. Kilnfire
  // returns "Zoe Tong" but Zoe was missing from the original seed).
  // weekly_tasks.assignee has a FK on staff(id) — invalid ids would 409.
  const staffRows = await sbGet('staff?select=id');
  const validStaff = new Set(staffRows.map(s => s.id));
  const safeAssignee = (id) => (id && validStaff.has(id)) ? id : null;

  const pieces = cls.pieces || [];
  const batchKeys = new Set();
  const rows = [];

  // Pull live weekly_tasks once so placeKilnTask's walk-forward fallback can
  // see existing kiln load. Excludes the rows we're about to delete-then-
  // reinsert for THIS class so they don't fight themselves.
  const otherKilnTasksRows = await sbGet(
    `weekly_tasks?deleted_at=is.null&phase=in.(${KILN_FIRE_PHASES.join(',')})&class_id=not.eq.${classId}&select=id,due_date,phase,assignee,status`
  );
  const otherKilnTasks = otherKilnTasksRows.map(r => ({
    id: r.id, dueDate: r.due_date, phase: r.phase, assignee: r.assignee, status: r.status,
  }));

  for (const t of tasks) {
    const earliestIso = addDaysIso(cls.class_date, t.offset_days || 0);

    // Kiln phases snap to scheduled fire days; everything else uses offset.
    let dueIso = earliestIso;
    if (t.phase && KILN_FIRE_PHASES.includes(t.phase)) {
      const placed = await placeKilnTask(t.phase, earliestIso, otherKilnTasks);
      dueIso = placed.date;
    }

    const weekKey = mondayIso(dueIso);
    const batchKey = t.batchable ? `${t.phase}-${weekKey}` : null;
    if (batchKey) batchKeys.add(batchKey);

    const baseRow = {
      week_key:           weekKey,
      due_date:           dueIso,
      class_type_task_id: t.id,
      title:              t.title,
      phase:              t.phase,
      batch_key:          batchKey,
      assignee:           safeAssignee(t.default_owner || cls.instructor),
      duration_minutes:   t.duration_minutes,
      notes:              t.notes || null,
      status:             'todo',
      updated_at:         new Date().toISOString(),
    };

    if (t.scope === 'per-piece') {
      // One row per piece. piece_id participates in the unique index along
      // with class_type_task_id, so reseeding doesn't duplicate.
      for (const p of pieces) {
        rows.push({
          ...baseRow,
          source_kind: 'piece',
          class_id:    classId,
          piece_id:    p.id,
        });
      }
    } else {
      rows.push({
        ...baseRow,
        source_kind: 'class',
        class_id:    classId,
      });
    }
  }

  if (!rows.length) return { inserted: 0, updated: 0, skipped: 0, totalTasks: 0, batchKeys: [] };

  // Idempotency strategy: delete-then-insert scoped to this class. Any
  // existing rows for (class_id=X, source_kind in 'class'|'piece') get
  // wiped before we insert the freshly-computed set. Keeps the generator
  // simple at the cost of losing per-row staff edits on regen — those can
  // be preserved in a future merge implementation.
  await sbDelete(`weekly_tasks?class_id=eq.${classId}&source_kind=in.(class,piece)`);
  await sbPost('weekly_tasks', rows, { returning: 'minimal' });

  return {
    inserted:   rows.length,
    updated:    0,
    skipped:    0,
    totalTasks: rows.length,
    batchKeys:  [...batchKeys],
  };
}

// ─── generateRecurringForWeek ────────────────────────────────

// Walk recurring_tasks; emit one weekly_tasks row per active task that
// should fire in the requested week according to its cadence.
//
// Cadence rules (simple, deterministic):
//   weekly    — fires every week
//   biweekly  — fires on even ISO weeks (so a manager can "shift" by waiting one week)
//   monthly   — fires the week containing the first Monday of the month
//   quarterly — fires the week containing the first Monday of Mar/Jun/Sep/Dec
export async function generateRecurringForWeek(weekKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekKey)) throw new Error(`weekKey must be YYYY-MM-DD (got ${weekKey})`);

  const tasks = await sbGet('recurring_tasks?active=eq.true&select=*');
  const wk    = isoWeek(weekKey);
  const date  = new Date(`${weekKey}T12:00:00Z`);
  const month = date.getUTCMonth();          // 0-11
  const isFirstWeekOfMonth = date.getUTCDate() <= 7;
  const isQuarterMonth     = [2, 5, 8, 11].includes(month);   // Mar, Jun, Sep, Dec

  const rows = tasks.filter(t => {
    if (t.cadence === 'weekly')    return true;
    if (t.cadence === 'biweekly')  return wk % 2 === 0;
    if (t.cadence === 'monthly')   return isFirstWeekOfMonth;
    if (t.cadence === 'quarterly') return isFirstWeekOfMonth && isQuarterMonth;
    return false;
  });
  // Same defensive assignee-validation as generateForClass — recurring tasks
  // shouldn't reference staff that don't exist either.
  const staffRows = await sbGet('staff?select=id');
  const validStaff = new Set(staffRows.map(s => s.id));
  const finalRows = rows.map(t => ({
    week_key:           weekKey,
    due_date:           weekKey,                // Monday of the week is fine for recurring
    source_kind:        'recurring',
    recurring_task_id:  t.id,
    title:              t.title,
    phase:              null,
    batch_key:          null,
    assignee:           (t.default_owner && validStaff.has(t.default_owner)) ? t.default_owner : null,
    duration_minutes:   t.duration_minutes,
    status:             'todo',
    notes:              t.notes || null,
    updated_at:         new Date().toISOString(),
  }));

  if (!finalRows.length) return { inserted: 0 };
  await sbDelete(`weekly_tasks?week_key=eq.${weekKey}&source_kind=eq.recurring`);
  await sbPost('weekly_tasks', finalRows, { returning: 'minimal' });
  return { inserted: finalRows.length };
}

// ─── materializeGoalTasksForWeek ─────────────────────────────

// Surface goal_tasks + special_tasks whose deadlines fall in the requested
// week as weekly_tasks rows. Source tables stay as the metadata of record;
// these rows are projections.
export async function materializeGoalTasksForWeek(weekKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekKey)) throw new Error(`weekKey must be YYYY-MM-DD (got ${weekKey})`);
  const weekEnd = addDaysIso(weekKey, 6);

  const [goalTasks, specialTasks, staffRows] = await Promise.all([
    sbGet(`goal_tasks?deleted_at=is.null&deadline=gte.${weekKey}&deadline=lte.${weekEnd}&select=id,title,owner,deadline,status,notes,goal_id,goals(title)`),
    sbGet(`special_tasks?deleted_at=is.null&deadline=gte.${weekKey}&deadline=lte.${weekEnd}&select=id,title,scope,staff_id,deadline,status,week_key`),
    sbGet('staff?select=id'),
  ]);
  const validStaff = new Set(staffRows.map(s => s.id));

  const goalRows = goalTasks.map(g => ({
    week_key:       mondayIso(g.deadline),
    due_date:       g.deadline,
    source_kind:    'goal',
    goal_task_id:   g.id,
    title:          g.goals?.title ? `${g.goals.title}: ${g.title}` : g.title,
    phase:          null,
    batch_key:      null,
    assignee:       (g.owner && validStaff.has(g.owner)) ? g.owner : null,
    status:         g.status || 'todo',
    notes:          g.notes || null,
    duration_minutes: null,
    updated_at:     new Date().toISOString(),
  }));

  const specRows = specialTasks.map(s => ({
    week_key:        mondayIso(s.deadline || s.week_key),
    due_date:        s.deadline || s.week_key,
    source_kind:     'special',
    special_task_id: s.id,
    title:           s.title,
    phase:           null,
    batch_key:       null,
    assignee:        s.staff_id || null,
    status:          s.status || 'todo',
    notes:           s.scope || null,
    duration_minutes: null,
    updated_at:      new Date().toISOString(),
  }));

  await sbDelete(`weekly_tasks?week_key=eq.${weekKey}&source_kind=in.(goal,special)`);
  if (goalRows.length) await sbPost('weekly_tasks', goalRows, { returning: 'minimal' });
  if (specRows.length) await sbPost('weekly_tasks', specRows, { returning: 'minimal' });
  return { inserted: goalRows.length + specRows.length };
}

// ─── generateAllForWeek ──────────────────────────────────────
// Convenience: run all three generators for a single week.
export async function generateAllForWeek(weekKey) {
  const recurring = await generateRecurringForWeek(weekKey);
  const goalsAndSpec = await materializeGoalTasksForWeek(weekKey);
  return {
    weekKey,
    recurring:    recurring.inserted,
    goalsSpecial: goalsAndSpec.inserted,
  };
}
