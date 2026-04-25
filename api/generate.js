// Generation API: turn class instances and recurring/goal/special task
// definitions into weekly_tasks rows.
//
//   POST /api/generate { op: 'forClass', classId }
//   POST /api/generate { op: 'forWeek',  weekKey }   ← runs recurring + goals/special only
//   POST /api/generate { op: 'all',      weekKey }   ← runs forWeek then forClass for every
//                                                       class whose date falls in the week
//
// Idempotent — relies on weekly_tasks unique constraints from migration 0004.

import { requireAuth, setCors } from '../lib/auth.js';
import { sbErrorResponse, sbGet } from '../lib/supabase.js';
import {
  generateForClass,
  generateRecurringForWeek,
  materializeGoalTasksForWeek,
  generateAllForWeek,
  addDaysIso,
} from '../lib/generators.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!requireAuth(req, res))   return;

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { op, classId, weekKey } = req.body || {};

    if (op === 'forClass') {
      if (!classId) return res.status(400).json({ error: 'classId required' });
      const result = await generateForClass(classId);
      return res.status(200).json(result);
    }

    if (op === 'forWeek') {
      if (!weekKey) return res.status(400).json({ error: 'weekKey required' });
      const recurring    = await generateRecurringForWeek(weekKey);
      const goalsSpecial = await materializeGoalTasksForWeek(weekKey);
      return res.status(200).json({ weekKey, ...recurring, ...goalsSpecial });
    }

    if (op === 'all') {
      if (!weekKey) return res.status(400).json({ error: 'weekKey required' });
      const summary = await generateAllForWeek(weekKey);
      // Also run forClass for every class whose class_date falls in the
      // week. Generates their post-processing tasks even if the class was
      // entered before this endpoint existed.
      const weekEnd = addDaysIso(weekKey, 6);
      const classes = await sbGet(`classes?class_date=gte.${weekKey}&class_date=lte.${weekEnd}&select=id`);
      const classResults = [];
      for (const c of classes) {
        try {
          classResults.push(await generateForClass(c.id));
        } catch (e) {
          classResults.push({ classId: c.id, error: e.message });
        }
      }
      return res.status(200).json({ ...summary, classes: classResults });
    }

    return res.status(400).json({ error: `Unknown op: ${op}` });
  } catch (e) {
    return sbErrorResponse(res, e);
  }
}
