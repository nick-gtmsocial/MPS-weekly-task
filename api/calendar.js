// GET /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
//   → { tasks: [...] }  weekly_tasks rows whose due_date falls in [from, to]
//
// Used by the Calendar tab to render multi-week views without making one
// /api/state call per week. Returns class context (type, date) so the UI
// can label tasks without a separate fetch.

import { requireAuth, setCors } from '../lib/auth.js';
import { sbGet, sbErrorResponse } from '../lib/supabase.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!requireAuth(req, res))   return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const from = (req.query.from || '').trim();
  const to   = (req.query.to   || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.status(400).json({ error: 'from and to query params must be YYYY-MM-DD' });
  }

  try {
    const rows = await sbGet(
      `weekly_tasks?due_date=gte.${from}&due_date=lte.${to}` +
      `&select=id,due_date,title,phase,batch_key,assignee,status,source_kind,class_id,classes(type,class_date)` +
      `&order=due_date.asc,batch_key.asc.nullsfirst`,
    );
    return res.status(200).json({
      from, to,
      tasks: rows.map(shape),
    });
  } catch (e) {
    return sbErrorResponse(res, e);
  }
}

function shape(r) {
  return {
    id:         r.id,
    dueDate:    r.due_date,
    title:      r.title,
    phase:      r.phase,
    batchKey:   r.batch_key,
    assignee:   r.assignee,
    status:     r.status,
    sourceKind: r.source_kind,
    classId:    r.class_id,
    classType:  r.classes?.type      || null,
    classDate:  r.classes?.class_date || null,
  };
}
