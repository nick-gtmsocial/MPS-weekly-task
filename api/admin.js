// Curatorial ops: class types + recurring tasks. Used by the seed scripts and
// any future template-editor UI. Kept separate from state.js so the day-to-day
// mutation endpoint stays focused.
//
//   GET  /api/admin?resource=class-types       → list class types + their tasks
//   GET  /api/admin?resource=recurring-tasks   → list recurring tasks
//   POST /api/admin  body: { op, ... }         → mutation dispatch

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

async function handleGet(req, res) {
  const { resource } = req.query;
  if (resource === 'class-types') {
    const rows = await sbGet('class_types?select=*,class_type_tasks(*)&order=name.asc');
    return res.status(200).json({
      classTypes: rows.map(shapeClassType),
    });
  }
  if (resource === 'recurring-tasks') {
    const rows = await sbGet('recurring_tasks?select=*&order=cadence.asc,title.asc');
    return res.status(200).json({
      recurringTasks: rows.map(shapeRecurringTask),
    });
  }
  return res.status(400).json({ error: 'resource must be "class-types" or "recurring-tasks"' });
}

async function handlePost(req, res) {
  const { op, ...payload } = req.body || {};
  const handler = OPS[op];
  if (!handler) return res.status(400).json({ error: `Unknown op: ${op}` });
  const result = await handler(payload);
  return res.status(200).json(result);
}

const OPS = {
  // Upsert a class type by id. Replaces all class_type_tasks rows for that
  // type so seed scripts can edit + reseed without leaving stale rows.
  async upsertClassType({ id, name, piecesPerStudent, piecesPerCouple, glazeMethod, defaultInstructor, pickupWindowDays, notes, tasks }) {
    requireFields({ id, name });

    // Upsert the class_type row itself.
    await sbPost('class_types?on_conflict=id', {
      id,
      name,
      pieces_per_student: piecesPerStudent ?? 1,
      pieces_per_couple:  piecesPerCouple  ?? null,
      glaze_method:       glazeMethod      ?? null,
      default_instructor: defaultInstructor ?? null,
      pickup_window_days: pickupWindowDays ?? 28,
      notes:              notes            ?? null,
      updated_at:         new Date().toISOString(),
    }, { upsert: true, returning: 'minimal' });

    // Replace the task list. Idempotent reseed = clean slate every time.
    await sbDelete(`class_type_tasks?class_type_id=eq.${id}`);
    if (Array.isArray(tasks) && tasks.length) {
      const rows = tasks.map((t, i) => ({
        class_type_id:    id,
        phase:            t.phase,
        scope:            t.scope || 'per-class',
        title:            t.title,
        default_owner:    t.defaultOwner    || null,
        offset_days:      t.offsetDays      ?? 0,
        duration_minutes: t.durationMinutes ?? null,
        batchable:        !!t.batchable,
        sort_idx:         i,
        notes:            t.notes           || null,
      }));
      await sbPost('class_type_tasks', rows, { returning: 'minimal' });
    }

    return { id, taskCount: (tasks || []).length };
  },

  async deleteClassType({ id }) {
    requireFields({ id });
    await sbDelete(`class_types?id=eq.${id}`);
    return { ok: true };
  },

  // Upsert a recurring task by id (text PK, e.g. 'kiln-wash-quarterly').
  async upsertRecurringTask({ id, title, cadence, defaultOwner, durationMinutes, notes, active }) {
    requireFields({ id, title, cadence });
    if (!['weekly','biweekly','monthly','quarterly'].includes(cadence)) {
      throw badRequest(`cadence must be weekly|biweekly|monthly|quarterly (got "${cadence}")`);
    }
    await sbPost('recurring_tasks?on_conflict=id', {
      id,
      title,
      cadence,
      default_owner:    defaultOwner    ?? null,
      duration_minutes: durationMinutes ?? null,
      notes:            notes           ?? null,
      active:           active !== false,
      updated_at:       new Date().toISOString(),
    }, { upsert: true, returning: 'minimal' });
    return { id };
  },

  async deleteRecurringTask({ id }) {
    requireFields({ id });
    await sbDelete(`recurring_tasks?id=eq.${id}`);
    return { ok: true };
  },

  // Audit log written by sync-kilnfire.py at the end of each run.
  async logKilnfireScrape({ classes_pulled, classes_inserted, classes_skipped, errors, notes }) {
    const [row] = await sbPost('kilnfire_scrapes', {
      classes_pulled:   classes_pulled   ?? 0,
      classes_inserted: classes_inserted ?? 0,
      classes_skipped:  classes_skipped  ?? 0,
      errors:           errors           ?? null,
      notes:            notes            ?? null,
    });
    return { id: row.id, scrapedAt: row.scraped_at };
  },
};

// ─── Shapers ──────────────────────────────────────────────

function shapeClassType(r) {
  return {
    id:                 r.id,
    name:               r.name,
    piecesPerStudent:   r.pieces_per_student,
    piecesPerCouple:    r.pieces_per_couple,
    glazeMethod:        r.glaze_method,
    defaultInstructor:  r.default_instructor,
    pickupWindowDays:   r.pickup_window_days,
    notes:              r.notes,
    tasks: (r.class_type_tasks || [])
      .sort((a, b) => a.sort_idx - b.sort_idx)
      .map(t => ({
        id:               t.id,
        phase:            t.phase,
        scope:            t.scope,
        title:            t.title,
        defaultOwner:     t.default_owner,
        offsetDays:       t.offset_days,
        durationMinutes:  t.duration_minutes,
        batchable:        t.batchable,
        sortIdx:          t.sort_idx,
        notes:            t.notes,
      })),
  };
}

function shapeRecurringTask(r) {
  return {
    id:               r.id,
    title:            r.title,
    cadence:          r.cadence,
    defaultOwner:     r.default_owner,
    durationMinutes:  r.duration_minutes,
    notes:            r.notes,
    active:           r.active,
  };
}

function requireFields(fields) {
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || v === '') {
      throw badRequest(`Missing required field: ${k}`);
    }
  }
}

function badRequest(msg) {
  const err = new Error(msg);
  err.status = 400;
  return err;
}
