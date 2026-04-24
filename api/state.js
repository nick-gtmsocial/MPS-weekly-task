// GET  /api/state?week=YYYY-MM-DD
//   → { weekKey, assignments, specialTasks, classes }  (classes include their pieces)
// POST /api/state  body: { op: '...', ...payload }
//   → operation-specific result (usually the new/updated row, or { ok: true })
//
// Single endpoint with op dispatch (vs many per-resource routes) keeps
// Vercel function count low and the client's mutation layer small.

import { requireAuth, setCors } from '../lib/auth.js';
import { sbGet, sbPost, sbPatch, sbDelete, sbErrorResponse } from '../lib/supabase.js';

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

  const [assignmentRows, specialRows, classRows, goalTaskRows] = await Promise.all([
    sbGet(`week_assignments?week_key=eq.${weekKey}&select=task_id,day_idx,assignees,status,note`),
    sbGet(`special_tasks?week_key=eq.${weekKey}&select=id,staff_id,title,scope,deadline,status,created_at,special_task_updates(id,update_date,text,created_at)&order=created_at.asc`),
    sbGet(`classes?week_key=eq.${weekKey}&select=id,class_num,type,class_date,instructor,kilnfire_link,kilnfire_external_id,notes,created_at,pieces(id,student,description,stage,notes,stage_history,created_at)&order=created_at.asc`),
    // Goal tasks whose deadline is in this week, OR that are still open and
    // were due before this week (to surface overdue items regardless of
    // which week you're viewing).
    sbGet(`goal_tasks?deadline=lte.${weekEnd}&or=(deadline.gte.${weekKey},status.neq.done)&select=id,goal_id,section,subsection,title,owner,deadline,status,notes,goals(id,title,target_date)&order=deadline.asc.nullslast`),
  ]);

  return res.status(200).json({
    weekKey,
    assignments:  shapeAssignments(assignmentRows),
    specialTasks: specialRows.map(shapeSpecialTask),
    classes:      classRows.map(shapeClass),
    goalTasks:    goalTaskRows.map(shapeGoalTaskForWeek),
  });
}

function addDaysIso(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
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
    await sbDelete(`special_tasks?id=eq.${id}`);
    return { ok: true };
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
    return shapeClass({ ...row, pieces: [] });
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
    await sbDelete(`classes?id=eq.${id}`);
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
    await sbDelete(`pieces?id=eq.${id}`);
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
