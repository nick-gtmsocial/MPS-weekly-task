// GET  /api/goals                   → { goals, templates }   (list views)
// GET  /api/goals?id=<goal_id>     → { goal, tasks }
// POST /api/goals body: { op, ... } → dispatched mutation
//
// Shared resource pattern like api/state.js — one endpoint, many ops,
// keeps the Vercel function count low.

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
  const { id } = req.query;

  if (id) {
    const [goal] = await sbGet(`goals?id=eq.${id}&select=*,goal_tasks(*)`);
    if (!goal) return res.status(404).json({ error: 'Goal not found' });
    return res.status(200).json({
      goal:  shapeGoal(goal),
      tasks: (goal.goal_tasks || []).map(shapeGoalTask).sort(compareTasks),
    });
  }

  const [goals, templates] = await Promise.all([
    sbGet('goals?select=*,goal_tasks(id,status,deadline)&order=target_date.asc'),
    sbGet('templates?select=id,name,description,sections&order=name.asc'),
  ]);

  // Shape each goal with its own task counts first, then roll child counts up
  // into their parents so the tree's progress bars include sub-goal work.
  const shaped = goals.map(g => ({
    ...shapeGoal(g),
    totalTasks: (g.goal_tasks || []).length,
    doneTasks:  (g.goal_tasks || []).filter(t => t.status === 'done').length,
    nextDeadline: (g.goal_tasks || [])
      .filter(t => t.status !== 'done' && t.deadline)
      .map(t => t.deadline)
      .sort()[0] || null,
  }));

  const byId = new Map(shaped.map(g => [g.id, g]));
  for (const g of shaped) {
    let cursor = g.parentId;
    while (cursor && byId.has(cursor)) {
      const p = byId.get(cursor);
      p.totalTasks += (g.totalTasks || 0);
      p.doneTasks  += (g.doneTasks  || 0);
      cursor = p.parentId;
    }
  }

  return res.status(200).json({
    goals:     shaped,
    templates: templates.map(shapeTemplate),
  });
}

async function handlePost(req, res) {
  const { op, ...payload } = req.body || {};
  const handler = OPS[op];
  if (!handler) return res.status(400).json({ error: `Unknown op: ${op}` });
  const result = await handler(payload);
  return res.status(200).json(result);
}

// ─── Ops ──────────────────────────────────────────────────────
const OPS = {
  async createGoal({ title, targetDate, owner, notes, templateId, parentId }) {
    requireFields({ title, targetDate });
    const [goal] = await sbPost('goals', {
      title,
      target_date: targetDate,
      owner:       owner       || null,
      notes:       notes       || null,
      template_id: templateId  || null,
      parent_id:   parentId    || null,
      status:      'active',
    });

    // If a template was supplied, expand its tasks with deadlines relative to target_date.
    if (templateId) {
      const [tmpl] = await sbGet(`templates?id=eq.${templateId}&select=sections`);
      if (tmpl?.sections?.length) {
        const rows = expandTemplate(tmpl.sections, goal.id, targetDate);
        if (rows.length) await sbPost('goal_tasks', rows, { returning: 'minimal' });
      }
    }

    // Return the full goal bundle so the UI can render without a refetch.
    const [full] = await sbGet(`goals?id=eq.${goal.id}&select=*,goal_tasks(*)`);
    return {
      goal:  shapeGoal(full),
      tasks: (full.goal_tasks || []).map(shapeGoalTask).sort(compareTasks),
    };
  },

  async updateGoal({ id, title, targetDate, owner, notes, status, parentId }) {
    requireFields({ id });
    const patch = {};
    if (title      !== undefined) patch.title       = title;
    if (targetDate !== undefined) patch.target_date = targetDate;
    if (owner      !== undefined) patch.owner       = owner;
    if (notes      !== undefined) patch.notes       = notes;
    if (status     !== undefined) patch.status      = status;
    if (parentId   !== undefined) patch.parent_id   = parentId;
    patch.updated_at = new Date().toISOString();
    const [row] = await sbPatch(`goals?id=eq.${id}`, patch);
    return shapeGoal(row);
  },

  async deleteGoal({ id }) {
    requireFields({ id });
    await sbDelete(`goals?id=eq.${id}`);
    return { ok: true };
  },

  async addGoalTask({ goalId, section, subsection, title, owner, deadline, status, notes, sortIdx }) {
    requireFields({ goalId, title });
    const [row] = await sbPost('goal_tasks', {
      goal_id:    goalId,
      section:    section    || null,
      subsection: subsection || null,
      title,
      owner:      owner      || null,
      deadline:   deadline   || null,
      status:     status     || 'todo',
      notes:      notes      || null,
      sort_idx:   sortIdx ?? 999,
    });
    return shapeGoalTask(row);
  },

  async updateGoalTask({ id, section, subsection, title, owner, deadline, status, notes, sortIdx }) {
    requireFields({ id });
    const patch = {};
    if (section    !== undefined) patch.section    = section;
    if (subsection !== undefined) patch.subsection = subsection;
    if (title      !== undefined) patch.title      = title;
    if (owner      !== undefined) patch.owner      = owner;
    if (deadline   !== undefined) patch.deadline   = deadline;
    if (status     !== undefined) patch.status     = status;
    if (notes      !== undefined) patch.notes      = notes;
    if (sortIdx    !== undefined) patch.sort_idx   = sortIdx;
    patch.updated_at = new Date().toISOString();
    const [row] = await sbPatch(`goal_tasks?id=eq.${id}`, patch);
    return shapeGoalTask(row);
  },

  async deleteGoalTask({ id }) {
    requireFields({ id });
    await sbDelete(`goal_tasks?id=eq.${id}`);
    return { ok: true };
  },

  // Upsert a template by name. Used by the seed script and any future
  // template-editor UI.
  async upsertTemplate({ name, description, sections }) {
    requireFields({ name });
    const [row] = await sbPost(
      'templates?on_conflict=name',
      {
        name,
        description: description || null,
        sections:    sections    || [],
        updated_at:  new Date().toISOString(),
      },
      { upsert: true },
    );
    return shapeTemplate(row);
  },

  async deleteTemplate({ id }) {
    requireFields({ id });
    await sbDelete(`templates?id=eq.${id}`);
    return { ok: true };
  },
};

// ─── Helpers ──────────────────────────────────────────────────

// Convert a template's declarative sections into concrete goal_task rows,
// computing each deadline = target_date + offset_days (negative = before).
function expandTemplate(sections, goalId, targetDateIso) {
  const target = new Date(`${targetDateIso}T12:00:00Z`);
  const rows = [];
  let sortIdx = 0;
  for (const section of sections) {
    for (const task of (section.tasks || [])) {
      let deadline = null;
      if (typeof task.offset_days === 'number') {
        const d = new Date(target);
        d.setUTCDate(d.getUTCDate() + task.offset_days);
        deadline = d.toISOString().slice(0, 10);
      }
      rows.push({
        goal_id:    goalId,
        section:    section.name,
        subsection: task.subsection || null,
        title:      task.title,
        owner:      task.default_owner || null,
        deadline,
        status:     'todo',
        notes:      task.notes || null,
        sort_idx:   sortIdx++,
      });
    }
  }
  return rows;
}

function shapeGoal(r) {
  return {
    id:         r.id,
    title:      r.title,
    targetDate: r.target_date,
    owner:      r.owner,
    status:     r.status,
    notes:      r.notes,
    templateId: r.template_id,
    parentId:   r.parent_id,
    createdAt:  r.created_at,
  };
}

function shapeGoalTask(r) {
  return {
    id:         r.id,
    goalId:     r.goal_id,
    section:    r.section,
    subsection: r.subsection,
    title:      r.title,
    owner:      r.owner,
    deadline:   r.deadline,
    status:     r.status,
    notes:      r.notes,
    sortIdx:    r.sort_idx,
  };
}

function shapeTemplate(r) {
  return {
    id:          r.id,
    name:        r.name,
    description: r.description,
    sections:    r.sections,
  };
}

function compareTasks(a, b) {
  if (a.section    !== b.section)    return (a.section    || '').localeCompare(b.section    || '');
  if (a.subsection !== b.subsection) return (a.subsection || '').localeCompare(b.subsection || '');
  return a.sortIdx - b.sortIdx;
}

function requireFields(fields) {
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || v === '') {
      const err = new Error(`Missing required field: ${k}`);
      err.status = 400;
      throw err;
    }
  }
}
