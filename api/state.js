// GET  /api/state?week=YYYY-MM-DD
//   → { weekKey, assignments, specialTasks, classes }  (classes include their pieces)
// POST /api/state  body: { op: '...', ...payload }
//   → operation-specific result (usually the new/updated row, or { ok: true })
//
// Single endpoint with op dispatch (vs many per-resource routes) keeps
// Vercel function count low and the client's mutation layer small.

import { requireAuth, setCors } from '../lib/auth.js';
import { sbGet, sbPost, sbPatch, sbDelete, sbErrorResponse } from '../lib/supabase.js';
import { generateForClass, addDaysIso } from '../lib/generators.js';
import { flagsFor } from '../lib/constraints.js';

// Helper: load the live weekly_tasks for the row's week and compute
// constraint flags for it. Used after any mutation that could create
// a kiln conflict or assign staff to a day they don't work.
async function constraintWarnings({ id, week_key, due_date, assignee, phase, status }) {
  const wk = week_key || (due_date && new Date(`${due_date}T12:00:00Z`));
  if (!wk) return [];
  const wkIso = typeof wk === 'string' ? wk : (() => {
    const d = new Date(wk);
    const dow = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
    return d.toISOString().slice(0, 10);
  })();
  // Pull the surrounding week + the next week so we catch cross-week
  // kiln conflicts too.
  const weekEnd = (() => {
    const d = new Date(`${wkIso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 13);
    return d.toISOString().slice(0, 10);
  })();
  const rows = await sbGet(`weekly_tasks?week_key=gte.${wkIso}&week_key=lte.${weekEnd}&deleted_at=is.null&select=id,due_date,phase,assignee,status`);
  const me = { id, dueDate: due_date, phase, assignee, status };
  const others = rows.map(r => ({
    id: r.id, dueDate: r.due_date, phase: r.phase, assignee: r.assignee, status: r.status,
  }));
  return flagsFor(me, others);
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!requireAuth(req, res))   return;

  try {
    if (req.method === 'GET')  return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return sbErrorResponse(res, e);
  }
}

// ─── GET: full week bundle ───────────────────────────────────
async function handleGet(req, res) {
  const weekKey = (req.query.week || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekKey)) {
    return res.status(400).json({ error: 'week query param must be YYYY-MM-DD (Monday of the week)' });
  }

  // Compute the Sunday of the week so goal-task queries can filter by [Mon, Sun].
  const weekEnd = addDaysIso(weekKey, 6);

  const [assignmentRows, specialRows, classRows, goalTaskRows, weeklyTaskRows, fireRows] = await Promise.all([
    sbGet(`week_assignments?week_key=eq.${weekKey}&select=task_id,day_idx,assignees,status,note`),
    // Special tasks are NOT week-scoped — multi-week, persistent. Filter
    // out soft-deleted rows here.
    sbGet(`special_tasks?deleted_at=is.null&select=id,staff_id,title,scope,deadline,status,week_key,created_at,special_task_updates(id,update_date,text,created_at)&order=deadline.asc.nullslast`),
    // Pieces are filtered to live ones via the embedded resource filter.
    sbGet(`classes?week_key=eq.${weekKey}&deleted_at=is.null&select=id,class_num,type,class_date,instructor,kilnfire_link,kilnfire_external_id,notes,created_at,pieces(id,student,description,stage,notes,stage_history,created_at,deleted_at)&order=created_at.asc`),
    sbGet(`goal_tasks?deleted_at=is.null&deadline=lte.${weekEnd}&or=(deadline.gte.${weekKey},status.neq.done)&select=id,goal_id,section,subsection,title,owner,deadline,status,notes,goals(id,title,target_date)&order=deadline.asc.nullslast`),
    sbGet(`weekly_tasks?week_key=eq.${weekKey}&deleted_at=is.null&select=*,classes(type,class_date),pieces(student)&order=due_date.asc,batch_key.asc.nullsfirst`),
    // Fire schedule is global, not week-scoped. Return upcoming days from
    // the week's Monday onward so the Kiln tab can render the same source
    // as the rest of the bundle. Defensive: if the migration hasn't run
    // yet, return [] instead of breaking the whole bundle fetch.
    sbGet(`fire_schedule?deleted_at=is.null&fire_date=gte.${weekKey}&select=id,fire_date,phase,capacity,notes&order=fire_date.asc`)
      .catch(() => []),
  ]);

  // PostgREST doesn't filter embedded resources without an !inner hint,
  // so strip soft-deleted pieces client-side. Cheap, robust.
  for (const c of classRows) {
    if (c.pieces) c.pieces = c.pieces.filter(p => !p.deleted_at);
  }

  return res.status(200).json({
    weekKey,
    assignments:  shapeAssignments(assignmentRows),
    specialTasks: specialRows.map(shapeSpecialTask),
    classes:      classRows.map(shapeClass),
    goalTasks:    goalTaskRows.map(shapeGoalTaskForWeek),
    weeklyTasks:  weeklyTaskRows.map(shapeWeeklyTask),
    fireSchedule: fireRows.map(shapeFireDay),
  });
}

function shapeFireDay(r) {
  return {
    id:       r.id,
    fireDate: r.fire_date,
    phase:    r.phase,
    capacity: r.capacity,
    notes:    r.notes,
  };
}

function shapeWeeklyTask(r) {
  return {
    id:                 r.id,
    weekKey:            r.week_key,
    dueDate:            r.due_date,
    sourceKind:         r.source_kind,
    classId:            r.class_id,
    pieceId:            r.piece_id,
    classTypeTaskId:    r.class_type_task_id,
    recurringTaskId:    r.recurring_task_id,
    goalTaskId:         r.goal_task_id,
    specialTaskId:      r.special_task_id,
    title:              r.title,
    phase:              r.phase,
    batchKey:           r.batch_key,
    assignee:           r.assignee,
    status:             r.status,
    durationMinutes:    r.duration_minutes,
    notes:              r.notes,
    // Embedded context (for fast UI rendering without a second fetch):
    classType:          r.classes?.type      || null,
    classDate:          r.classes?.class_date || null,
    pieceStudent:       r.pieces?.student     || null,
  };
}

function shapeGoalTaskForWeek(r) {
  return {
    id:         r.id,
    goalId:     r.goal_id,
    goalTitle:  r.goals?.title || null,
    section:    r.section,
    subsection: r.subsection,
    title:      r.title,
    owner:      r.owner,
    deadline:   r.deadline,
    status:     r.status,
    notes:      r.notes,
  };
}

function shapeAssignments(rows) {
  const out = {};
  for (const r of rows) {
    if (!out[r.task_id]) out[r.task_id] = {};
    out[r.task_id][r.day_idx] = {
      assignees: r.assignees || [],
      status:    r.status,
      note:      r.note,
    };
  }
  return out;
}

function shapeSpecialTask(r) {
  return {
    id:       r.id,
    staffId:  r.staff_id,
    title:    r.title,
    scope:    r.scope,
    deadline: r.deadline,
    status:   r.status,
    updates:  (r.special_task_updates || [])
                .sort((a, b) => a.created_at.localeCompare(b.created_at))
                .map(u => ({ id: u.id, date: u.update_date, text: u.text })),
  };
}

function shapeClass(r) {
  return {
    id:                   r.id,
    classNum:             r.class_num,
    type:                 r.type,
    date:                 r.class_date,
    instructor:           r.instructor,
    kilnfireLink:         r.kilnfire_link,
    kilnfireExternalId:   r.kilnfire_external_id,
    notes:                r.notes,
    pieces: (r.pieces || [])
              .sort((a, b) => a.created_at.localeCompare(b.created_at))
              .map(p => ({
                id:           p.id,
                student:      p.student,
                description:  p.description,
                stage:        p.stage,
                notes:        p.notes,
                stageHistory: p.stage_history || [],
              })),
  };
}

// ─── POST: op dispatch ───────────────────────────────────────
async function handlePost(req, res) {
  const { op, ...payload } = req.body || {};
  const handler = OPS[op];
  if (!handler) return res.status(400).json({ error: `Unknown op: ${op}` });
  const result = await handler(payload);
  return res.status(200).json(result);
}

const OPS = {
  // ── week_assignments ──
  async setAssignment({ weekKey, taskId, dayIdx, assignees, status, note }) {
    requireFields({ weekKey, taskId, dayIdx });
    const [row] = await sbPost('week_assignments?on_conflict=week_key,task_id,day_idx', {
      week_key:   weekKey,
      task_id:    taskId,
      day_idx:    dayIdx,
      assignees:  assignees || [],
      status:     status    || null,
      note:       note      || null,
      updated_at: new Date().toISOString(),
    }, { upsert: true });
    return { ok: true, row };
  },

  async clearAssignment({ weekKey, taskId, dayIdx }) {
    requireFields({ weekKey, taskId, dayIdx });
    await sbDelete(`week_assignments?week_key=eq.${weekKey}&task_id=eq.${taskId}&day_idx=eq.${dayIdx}`);
    return { ok: true };
  },

  // ── special_tasks ──
  async addSpecialTask({ weekKey, staffId, title, scope, deadline, status }) {
    requireFields({ weekKey, staffId, title });
    const [row] = await sbPost('special_tasks', {
      week_key: weekKey,
      staff_id: staffId,
      title,
      scope:    scope    || null,
      deadline: deadline || null,
      status:   status   || 'todo',
    });
    return shapeSpecialTask({ ...row, special_task_updates: [] });
  },

  async updateSpecialTask({ id, title, scope, deadline, status, staffId }) {
    requireFields({ id });
    const patch = {};
    if (title    !== undefined) patch.title    = title;
    if (scope    !== undefined) patch.scope    = scope;
    if (deadline !== undefined) patch.deadline = deadline;
    if (status   !== undefined) patch.status   = status;
    if (staffId  !== undefined) patch.staff_id = staffId;
    patch.updated_at = new Date().toISOString();
    const [row] = await sbPatch(`special_tasks?id=eq.${id}`, patch);
    return shapeSpecialTask({ ...row, special_task_updates: [] });
  },

  async deleteSpecialTask({ id }) {
    requireFields({ id });
    // Soft delete — recoverable via restoreSpecialTask. Rows stay in the
    // table; queries filter on deleted_at IS NULL.
    await sbPatch(`special_tasks?id=eq.${id}`, { deleted_at: new Date().toISOString() });
    return { ok: true };
  },

  async restoreSpecialTask({ id }) {
    requireFields({ id });
    const [row] = await sbPatch(`special_tasks?id=eq.${id}`, { deleted_at: null });
    return shapeSpecialTask({ ...row, special_task_updates: [] });
  },

  async addSpecialTaskUpdate({ specialTaskId, text, date }) {
    requireFields({ specialTaskId, text });
    const [row] = await sbPost('special_task_updates', {
      special_task_id: specialTaskId,
      update_date:     date || new Date().toISOString().slice(0, 10),
      text,
    });
    return { id: row.id, date: row.update_date, text: row.text };
  },

  // ── classes ──
  async addClass({ weekKey, classNum, type, date, instructor, kilnfireLink, kilnfireExternalId, notes }) {
    requireFields({ weekKey });
    const [row] = await sbPost('classes', {
      week_key:             weekKey,
      class_num:            classNum           || null,
      type:                 type               || null,
      class_date:           date               || null,
      instructor:           instructor         || null,
      kilnfire_link:        kilnfireLink       || null,
      kilnfire_external_id: kilnfireExternalId || null,
      notes:                notes              || null,
    });
    // Auto-generate follow-on tasks if the class type matches a known
    // class_types row. Generator is forgiving — it returns a no-op result
    // for unmatched types instead of throwing, so a free-form class type
    // doesn't block class creation.
    let generation = null;
    if (row.class_date && row.type) {
      try { generation = await generateForClass(row.id); }
      catch (e) { generation = { error: e.message }; }
    }
    return { ...shapeClass({ ...row, pieces: [] }), generation };
  },

  async updateClass({ id, classNum, type, date, instructor, kilnfireLink, notes }) {
    requireFields({ id });
    const patch = {};
    if (classNum     !== undefined) patch.class_num     = classNum;
    if (type         !== undefined) patch.type          = type;
    if (date         !== undefined) patch.class_date    = date;
    if (instructor   !== undefined) patch.instructor    = instructor;
    if (kilnfireLink !== undefined) patch.kilnfire_link = kilnfireLink;
    if (notes        !== undefined) patch.notes         = notes;
    patch.updated_at = new Date().toISOString();
    const [row] = await sbPatch(`classes?id=eq.${id}`, patch);
    return shapeClass({ ...row, pieces: [] });
  },

  async deleteClass({ id }) {
    requireFields({ id });
    const now = new Date().toISOString();
    // Soft-delete cascade: hide the class plus its pieces and any
    // generated weekly_tasks referencing it. Recovery via restoreClass
    // unhides the same set.
    await sbPatch(`classes?id=eq.${id}`,                  { deleted_at: now });
    await sbPatch(`pieces?class_id=eq.${id}`,             { deleted_at: now });
    await sbPatch(`weekly_tasks?class_id=eq.${id}`,       { deleted_at: now });
    return { ok: true };
  },

  async restoreClass({ id }) {
    requireFields({ id });
    await sbPatch(`classes?id=eq.${id}`,                  { deleted_at: null });
    await sbPatch(`pieces?class_id=eq.${id}`,             { deleted_at: null });
    await sbPatch(`weekly_tasks?class_id=eq.${id}`,       { deleted_at: null });
    return { ok: true };
  },

  // ── pieces ──
  async addPiece({ classId, student, description, stage, notes }) {
    requireFields({ classId });
    const initialStage = stage || 'Greenware';
    const [row] = await sbPost('pieces', {
      class_id:      classId,
      student:       student     || null,
      description:   description || null,
      stage:         initialStage,
      notes:         notes       || null,
      stage_history: [{ stage: initialStage, at: new Date().toISOString() }],
    });
    return {
      id: row.id, student: row.student, description: row.description,
      stage: row.stage, notes: row.notes, stageHistory: row.stage_history,
    };
  },

  async updatePiece({ id, student, description, stage, notes, by }) {
    requireFields({ id });
    const patch = {};
    if (student     !== undefined) patch.student     = student;
    if (description !== undefined) patch.description = description;
    if (notes       !== undefined) patch.notes       = notes;
    patch.updated_at = new Date().toISOString();

    // Stage change → append to stage_history. Fetch current row first.
    if (stage !== undefined) {
      const [current] = await sbGet(`pieces?id=eq.${id}&select=stage,stage_history`);
      if (!current) return { error: 'piece not found' };
      if (current.stage !== stage) {
        const entry = { stage, at: new Date().toISOString() };
        if (by) entry.by = by;
        patch.stage = stage;
        patch.stage_history = [...(current.stage_history || []), entry];
      }
    }

    const [row] = await sbPatch(`pieces?id=eq.${id}`, patch);
    return {
      id: row.id, student: row.student, description: row.description,
      stage: row.stage, notes: row.notes, stageHistory: row.stage_history,
    };
  },

  async deletePiece({ id }) {
    requireFields({ id });
    const now = new Date().toISOString();
    await sbPatch(`pieces?id=eq.${id}`,                   { deleted_at: now });
    await sbPatch(`weekly_tasks?piece_id=eq.${id}`,       { deleted_at: now });
    return { ok: true };
  },

  // ── weekly_tasks ──
  async markWeeklyTaskDone({ id, status }) {
    requireFields({ id });
    const [row] = await sbPatch(`weekly_tasks?id=eq.${id}`, {
      status:     status || 'done',
      updated_at: new Date().toISOString(),
    });
    return shapeWeeklyTask(row);
  },

  async assignWeeklyTask({ id, assignee }) {
    requireFields({ id });
    const [row] = await sbPatch(`weekly_tasks?id=eq.${id}`, {
      assignee:   assignee || null,
      updated_at: new Date().toISOString(),
    });
    const warnings = await constraintWarnings(row);
    return { ...shapeWeeklyTask(row), warnings };
  },

  // Move a task's due date. Recomputes week_key (Monday of new due_date)
  // and batch_key (when the task is batchable, the key follows the new
  // week so the task rejoins the right batch — or starts a new one if
  // no others land in that week).
  async setWeeklyTaskDueDate({ id, dueDate }) {
    requireFields({ id, dueDate });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      const err = new Error('dueDate must be YYYY-MM-DD');
      err.status = 400;
      throw err;
    }

    // Snap to Monday for week_key.
    const d = new Date(`${dueDate}T12:00:00Z`);
    const dow = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
    const weekKey = d.toISOString().slice(0, 10);

    // Read the existing row to know whether to keep batching.
    const [current] = await sbGet(`weekly_tasks?id=eq.${id}&select=phase,batch_key`);
    if (!current) {
      const err = new Error(`weekly_task not found: ${id}`);
      err.status = 404;
      throw err;
    }
    const newBatchKey = current.batch_key
      ? `${current.phase || 'task'}-${weekKey}`
      : null;

    const [row] = await sbPatch(`weekly_tasks?id=eq.${id}`, {
      due_date:   dueDate,
      week_key:   weekKey,
      batch_key:  newBatchKey,
      updated_at: new Date().toISOString(),
    });
    const warnings = await constraintWarnings(row);
    return { ...shapeWeeklyTask(row), warnings };
  },

  async addManualWeeklyTask({ weekKey, dueDate, title, assignee, durationMinutes, notes }) {
    requireFields({ weekKey, title });
    const [row] = await sbPost('weekly_tasks', {
      week_key:         weekKey,
      due_date:         dueDate || weekKey,
      source_kind:      'manual',
      title,
      phase:            null,
      batch_key:        null,
      assignee:         assignee || null,
      status:           'todo',
      duration_minutes: durationMinutes || null,
      notes:            notes || null,
    });
    const warnings = await constraintWarnings(row);
    return { ...shapeWeeklyTask(row), warnings };
  },

  async deleteWeeklyTask({ id }) {
    requireFields({ id });
    await sbPatch(`weekly_tasks?id=eq.${id}`, { deleted_at: new Date().toISOString() });
    return { ok: true };
  },

  // ── fire_schedule ──
  // Team-curated list of planned kiln fire days. The class generator snaps
  // bisque/glaze-fire tasks to the next scheduled day of the matching phase
  // on/after class_date+offset, instead of placing them blindly. Editing the
  // schedule does NOT retroactively move existing weekly_tasks — re-run
  // generateForClass(classId) explicitly if you want a class re-snapped.
  async listFireDays({ from } = {}) {
    const since = (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) ? from : new Date().toISOString().slice(0, 10);
    const rows = await sbGet(`fire_schedule?deleted_at=is.null&fire_date=gte.${since}&select=id,fire_date,phase,capacity,notes&order=fire_date.asc`);
    return rows.map(shapeFireDay);
  },

  async addFireDay({ fireDate, phase, capacity, notes }) {
    requireFields({ fireDate, phase });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fireDate)) {
      const err = new Error('fireDate must be YYYY-MM-DD'); err.status = 400; throw err;
    }
    if (phase !== 'bisque' && phase !== 'glaze-fire') {
      const err = new Error("phase must be 'bisque' or 'glaze-fire'"); err.status = 400; throw err;
    }
    const [row] = await sbPost('fire_schedule', {
      fire_date: fireDate,
      phase,
      capacity:  capacity == null ? null : Number(capacity),
      notes:     notes || null,
    });
    return shapeFireDay(row);
  },

  async updateFireDay({ id, fireDate, phase, capacity, notes }) {
    requireFields({ id });
    const patch = { updated_at: new Date().toISOString() };
    if (fireDate !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fireDate)) {
        const err = new Error('fireDate must be YYYY-MM-DD'); err.status = 400; throw err;
      }
      patch.fire_date = fireDate;
    }
    if (phase !== undefined) {
      if (phase !== 'bisque' && phase !== 'glaze-fire') {
        const err = new Error("phase must be 'bisque' or 'glaze-fire'"); err.status = 400; throw err;
      }
      patch.phase = phase;
    }
    if (capacity !== undefined) patch.capacity = capacity == null ? null : Number(capacity);
    if (notes    !== undefined) patch.notes    = notes || null;
    const [row] = await sbPatch(`fire_schedule?id=eq.${id}`, patch);
    return shapeFireDay(row);
  },

  async deleteFireDay({ id }) {
    requireFields({ id });
    await sbPatch(`fire_schedule?id=eq.${id}`, {
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    return { ok: true };
  },
};

function requireFields(fields) {
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || v === '') {
      const err = new Error(`Missing required field: ${k}`);
      err.status = 400;
      throw err;
    }
  }
}
