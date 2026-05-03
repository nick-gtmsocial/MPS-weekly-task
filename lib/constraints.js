// Real-world scheduling constraints expressed as data + small pure
// functions. Imported by the API to attach warnings to mutation
// responses; mirrored client-side in index.html for live badges in
// the UI. (Two copies of the data is the price of static-HTML
// distribution; tests pin both sides to the same truth.)
//
// Every change here MUST be reflected in the equivalent block at the
// top of index.html (search for `// === CONSTRAINTS ===`).

// Phases that share the studio's single kiln. Two tasks with any of
// these phases on the same date = conflict — only one fire cycle can
// run at a time. Bisque vs glaze fire is the same kiln; loading is
// what the staff schedule against.
export const KILN_FIRE_PHASES = ['bisque', 'glaze-fire'];

// Per-staff availability. Days are 3-letter names (Sun/Mon/Tue/Wed/
// Thu/Fri/Sat). maxPerWeek caps active assignments inside a Mon–Sun
// week. Staff not listed here have no constraints.
//
// Add new entries as constraints surface.
export const STAFF_AVAILABILITY = {
  miso: {
    days:        ['Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    maxPerWeek:  3,
    note:        'Miso loads the kiln. Not available Sun/Mon. Max 3 days/week.',
  },
};

const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

export function dayName(iso) {
  return DAY_NAMES[new Date(`${iso}T12:00:00Z`).getUTCDay()];
}

export function mondayOf(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return d.toISOString().slice(0, 10);
}

// Compute every constraint flag a task trips, given a snapshot of all
// other live tasks to compare against. Returns [{ kind, message }].
//
// Pass any iterable of tasks with at minimum: { id, dueDate, phase,
// assignee, status }. Done tasks count toward kiln-conflict (the kiln
// was occupied that day) but NOT toward staff over-cap (closed work).
export function flagsFor(task, allTasks = []) {
  const flags = [];
  if (!task) return flags;

  const isKiln = task.phase && KILN_FIRE_PHASES.includes(task.phase);
  const avail  = task.assignee && STAFF_AVAILABILITY[task.assignee];

  // Kiln conflict — a DIFFERENT fire phase on the same day. Same-phase
  // same-day is fine: that's how the studio batches (multiple classes'
  // bisques fire together to fill the kiln efficiently). Cross-phase on
  // the same day is the real conflict — the kiln can only run one mode
  // at a time.
  if (isKiln && task.dueDate) {
    const others = [];
    for (const t of allTasks) {
      if (!t || t.id === task.id) continue;
      if (t.dueDate !== task.dueDate) continue;
      if (!KILN_FIRE_PHASES.includes(t.phase)) continue;
      if (t.phase === task.phase) continue;       // same phase = batch, OK
      if (t.status === 'cancelled') continue;
      others.push(t);
    }
    if (others.length > 0) {
      const otherPhases = [...new Set(others.map(o => o.phase))].join(', ');
      flags.push({
        kind:    'kiln-conflict',
        message: `Kiln conflict — ${task.phase} can't run with ${otherPhases} on ${task.dueDate}`,
      });
    }
  }

  // Staff availability — wrong day of week.
  if (avail && task.dueDate) {
    const dn = dayName(task.dueDate);
    if (!avail.days.includes(dn)) {
      flags.push({
        kind:    'unavailable',
        message: `${task.assignee} unavailable on ${dn} (${avail.note || ''})`.trim(),
      });
    } else {
      // Over weekly cap — count distinct days they're already
      // assigned this week (open work only).
      const wk = mondayOf(task.dueDate);
      const sameWeekDays = new Set();
      for (const t of allTasks) {
        if (!t || t.id === task.id) continue;
        if (t.assignee !== task.assignee) continue;
        if (!t.dueDate) continue;
        if (t.status === 'done' || t.status === 'cancelled') continue;
        if (mondayOf(t.dueDate) !== wk) continue;
        sameWeekDays.add(t.dueDate);
      }
      if (sameWeekDays.size >= avail.maxPerWeek) {
        flags.push({
          kind:    'over-cap',
          message: `${task.assignee} over weekly cap (${avail.maxPerWeek} days/week)`,
        });
      }
    }
  }

  return flags;
}

// Walk forward from `fromIso` looking for the next day that satisfies
// the assignee's availability AND (when phase is a kiln phase) doesn't
// conflict with another kiln task. Returns ISO string or null after
// scanning 30 days.
export function findNextValidDay({ fromIso, assignee, phase }, allTasks = []) {
  const isKiln = phase && KILN_FIRE_PHASES.includes(phase);
  const avail  = assignee && STAFF_AVAILABILITY[assignee];

  for (let i = 0; i < 30; i++) {
    const d = new Date(`${fromIso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    const candidate = d.toISOString().slice(0, 10);

    // Staff day-of-week
    if (avail && !avail.days.includes(dayName(candidate))) continue;

    // Staff weekly cap
    if (avail) {
      const wk = mondayOf(candidate);
      const sameWeekDays = new Set();
      for (const t of allTasks) {
        if (!t || t.assignee !== assignee || !t.dueDate) continue;
        if (t.status === 'done' || t.status === 'cancelled') continue;
        if (mondayOf(t.dueDate) !== wk) continue;
        sameWeekDays.add(t.dueDate);
      }
      // If the candidate day isn't already a Miso day, adding it pushes
      // the cap. If it IS already one of her days, no impact.
      if (!sameWeekDays.has(candidate) && sameWeekDays.size >= avail.maxPerWeek) continue;
    }

    // Kiln conflict — only blocked by a *different* kiln phase on the
    // same day. Same-phase tasks share the fire (intentional batching).
    if (isKiln) {
      const conflict = allTasks.find(t =>
        t && t.dueDate === candidate &&
        KILN_FIRE_PHASES.includes(t.phase) &&
        t.phase !== phase &&
        t.status !== 'cancelled'
      );
      if (conflict) continue;
    }

    return candidate;
  }
  return null;
}
