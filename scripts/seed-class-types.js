// Seeds the 5 class types and their post-processing workflow.
// Usage:  node scripts/seed-class-types.js
// Idempotent — re-running replaces each class type's task list cleanly.
//
// Scope: ONLY post-processing tasks. Class prep (clay balls, wheels) and
// teaching the class itself are intentionally NOT here — every instructor
// already knows they have to do that. Surfacing them in the dashboard is
// noise that drowns the actual signal.
//
// Owner conventions (per Cielo's preferences as of 2026-04-25):
//   miso    — loads the kiln (bisque + glaze fire). Cielo's strong
//             preference is that ONLY Miso loads.
//   cielo   — handles all Taster + Clay Date glazing (her domain). May
//             delegate as needed.
//   shared  — anyone can unload, dip-glaze for handbuilding classes,
//             trim, and mark ready for pickup.
//
// Pickup window standardised at 28 days.

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });

const BASE = process.env.BASE_URL;
const PW   = process.env.STUDIO_PASSWORD;
if (!BASE || !PW) { console.error('BASE_URL and STUDIO_PASSWORD must be set'); process.exit(1); }

const classTypes = [
  // ────────────────────────────────────────────────────────────
  // Taster Class — wheel-thrown, hand-paint glaze
  // ────────────────────────────────────────────────────────────
  {
    id:                'taster',
    name:              'Taster Class',
    piecesPerStudent:  2,
    glazeMethod:       'hand-paint',
    pickupWindowDays:  28,
    notes:             '~3–5 pieces attempted, 2 take-home. Hand-paint glazing pools with Clay Date (~3hr per class).',
    tasks: [
      { phase: 'process',    title: 'Trim pieces',                offsetDays:  3, durationMinutes:  60, defaultOwner: 'shared', batchable: true,  notes: 'Batches across classes that ran the same week.' },
      { phase: 'bisque',     title: 'Bisque fire',                offsetDays:  6, durationMinutes:  30, defaultOwner: 'miso',   batchable: true,  notes: 'Miso loads. Anyone can unload after.' },
      { phase: 'glaze',      title: 'Glaze pieces (hand-paint)',  offsetDays: 10, durationMinutes: 180, defaultOwner: 'cielo',  batchable: true,  notes: 'Cielo coordinates; ~3hr glazing pool with other Tasters / Clay Dates.' },
      { phase: 'glaze-fire', title: 'Glaze fire',                 offsetDays: 13, durationMinutes:  30, defaultOwner: 'miso',   batchable: true },
      { phase: 'finish',     title: 'Mark ready for pickup',      offsetDays: 16, durationMinutes:  30, defaultOwner: 'shared',                   notes: 'Unload, label, stage on pickup shelf, mark ready in Kilnfire.' },
    ],
  },

  // ────────────────────────────────────────────────────────────
  // Matcha Bowl — single-week handbuilding, dunk clear glaze
  // ────────────────────────────────────────────────────────────
  {
    id:                'matcha-bowl',
    name:              'Matcha Bowl',
    piecesPerStudent:  1,
    glazeMethod:       'dunk',
    defaultInstructor: 'angel',
    pickupWindowDays:  28,
    notes:             'Single piece per student. Dunk-glaze batches with Mug Workshop in the same dunk session.',
    tasks: [
      { phase: 'bisque',     title: 'Bisque fire',                offsetDays:  6, durationMinutes: 30, defaultOwner: 'miso',   batchable: true },
      { phase: 'glaze',      title: 'Dip glaze (clear)',          offsetDays:  9, durationMinutes: 45, defaultOwner: 'shared', batchable: true,  notes: 'Wax-resist bottoms first. Batches with Mug Workshop.' },
      { phase: 'glaze-fire', title: 'Glaze fire',                 offsetDays: 12, durationMinutes: 30, defaultOwner: 'miso',   batchable: true },
      { phase: 'finish',     title: 'Mark ready for pickup',      offsetDays: 15, durationMinutes: 30, defaultOwner: 'shared',                   notes: 'Watch for thin glaze on unload — refire window is 4–7 days.' },
    ],
  },

  // ────────────────────────────────────────────────────────────
  // Matcha Set — 2-week course; students glaze in Week 2
  // Anchor = Week 1 class day. Bisque happens between weeks.
  // ────────────────────────────────────────────────────────────
  {
    id:                'matcha-set',
    name:              'Matcha Set (2-week course)',
    piecesPerStudent:  3,
    glazeMethod:       'student-applied',
    defaultInstructor: 'angel',
    pickupWindowDays:  28,
    notes:             '2-week course: pieces built Week 1, students glaze them Week 2. Highest refire rate due to student-applied glaze.',
    tasks: [
      { phase: 'bisque',     title: 'Bisque fire (before Week 2)', offsetDays:  5, durationMinutes: 30, defaultOwner: 'miso',   batchable: true,  notes: 'Pieces must be completely dry — wet pieces explode in the kiln.' },
      { phase: 'glaze-fire', title: 'Glaze fire (after Week 2)',   offsetDays:  8, durationMinutes: 30, defaultOwner: 'miso',   batchable: true },
      { phase: 'finish',     title: 'Mark ready for pickup',       offsetDays: 14, durationMinutes: 30, defaultOwner: 'shared',                   notes: 'Plan refire window for thin-glaze pieces (4–7 days).' },
    ],
  },

  // ────────────────────────────────────────────────────────────
  // Mug Workshop — single-week handbuilding (slab), dunk clear glaze
  // ────────────────────────────────────────────────────────────
  {
    id:                'mug',
    name:              'Mug Workshop',
    piecesPerStudent:  1,
    glazeMethod:       'dunk',
    defaultInstructor: 'zoe',
    pickupWindowDays:  28,
    notes:             'Slab-built mug, food-safe clear glaze. Dunk-glazes batch with Matcha Bowl.',
    tasks: [
      { phase: 'bisque',     title: 'Bisque fire',                offsetDays:  6, durationMinutes: 30, defaultOwner: 'miso',   batchable: true },
      { phase: 'glaze',      title: 'Dip glaze (clear)',          offsetDays:  9, durationMinutes: 45, defaultOwner: 'shared', batchable: true,  notes: 'Batches with Matcha Bowl in the same dunk session.' },
      { phase: 'glaze-fire', title: 'Glaze fire',                 offsetDays: 12, durationMinutes: 30, defaultOwner: 'miso',   batchable: true },
      { phase: 'finish',     title: 'Mark ready for pickup',      offsetDays: 15, durationMinutes: 30, defaultOwner: 'shared' },
    ],
  },

  // ────────────────────────────────────────────────────────────
  // Open Studio Hours — drop-in members' time. Pieces vary; default
  // to dunk-glaze workflow (the most common path).
  // ────────────────────────────────────────────────────────────
  {
    id:                'open-studio',
    name:              'Open Studio',
    piecesPerStudent:  1,
    glazeMethod:       'dunk',
    pickupWindowDays:  28,
    notes:             'Drop-in studio time. Default 1 piece/attendee with dunk-glaze workflow; staff can split/edit pieces after the session if needed.',
    tasks: [
      { phase: 'bisque',     title: 'Bisque fire',           offsetDays:  6, durationMinutes: 30, defaultOwner: 'miso',   batchable: true },
      { phase: 'glaze',      title: 'Dip glaze (clear)',     offsetDays:  9, durationMinutes: 30, defaultOwner: 'shared', batchable: true },
      { phase: 'glaze-fire', title: 'Glaze fire',            offsetDays: 12, durationMinutes: 30, defaultOwner: 'miso',   batchable: true },
      { phase: 'finish',     title: 'Mark ready for pickup', offsetDays: 15, durationMinutes: 20, defaultOwner: 'shared' },
    ],
  },

  // ────────────────────────────────────────────────────────────
  // Project-based Handbuilding for Beginners — generic handbuilding workshop
  // ────────────────────────────────────────────────────────────
  {
    id:                'handbuilding-project',
    name:              'Project-based Handbuilding',
    piecesPerStudent:  1,
    glazeMethod:       'dunk',
    pickupWindowDays:  28,
    notes:             'Generic handbuilding workshop. Same processing pipeline as Mug Workshop / Matcha Bowl.',
    tasks: [
      { phase: 'bisque',     title: 'Bisque fire',           offsetDays:  6, durationMinutes: 30, defaultOwner: 'miso',   batchable: true },
      { phase: 'glaze',      title: 'Dip glaze (clear)',     offsetDays:  9, durationMinutes: 45, defaultOwner: 'shared', batchable: true },
      { phase: 'glaze-fire', title: 'Glaze fire',            offsetDays: 12, durationMinutes: 30, defaultOwner: 'miso',   batchable: true },
      { phase: 'finish',     title: 'Mark ready for pickup', offsetDays: 15, durationMinutes: 30, defaultOwner: 'shared' },
    ],
  },

  // ────────────────────────────────────────────────────────────
  // Festive House / Holiday Village — seasonal handbuilding (decorative)
  // Hand-painted underglaze — needs more detail work than a dunk glaze.
  // ────────────────────────────────────────────────────────────
  {
    id:                'festive-house',
    name:              'Festive House',
    piecesPerStudent:  1,
    glazeMethod:       'hand-paint',
    pickupWindowDays:  28,
    notes:             'Seasonal handbuilding (Christmas village, Diwali tealights, etc.). Hand-painted underglaze for decorative detail.',
    tasks: [
      { phase: 'bisque',     title: 'Bisque fire',                offsetDays:  6, durationMinutes:  30, defaultOwner: 'miso',   batchable: true },
      { phase: 'glaze',      title: 'Hand-paint underglaze',      offsetDays: 10, durationMinutes: 120, defaultOwner: 'shared' },
      { phase: 'glaze-fire', title: 'Glaze fire',                 offsetDays: 13, durationMinutes:  30, defaultOwner: 'miso',   batchable: true },
      { phase: 'finish',     title: 'Mark ready for pickup',      offsetDays: 16, durationMinutes:  30, defaultOwner: 'shared' },
    ],
  },

  // ────────────────────────────────────────────────────────────
  // 2-week Crash Course — wheel-thrown, condensed
  // ────────────────────────────────────────────────────────────
  {
    id:                'crash-2wk',
    name:              '2-week Crash Course',
    piecesPerStudent:  2,
    glazeMethod:       'hand-paint',
    pickupWindowDays:  28,
    notes:             'Condensed wheel-throwing intro. Anchor = Week 1 class. Bisque happens between W1 and W2 (or after W2 depending on cohort).',
    tasks: [
      { phase: 'process',    title: 'Trim pieces',                offsetDays:  3, durationMinutes:  60, defaultOwner: 'shared', batchable: true },
      { phase: 'bisque',     title: 'Bisque fire',                offsetDays:  6, durationMinutes:  30, defaultOwner: 'miso',   batchable: true },
      { phase: 'class',      title: 'Week 2 class — students glaze + finish pieces', offsetDays: 7, durationMinutes: 150, defaultOwner: null },
      { phase: 'glaze-fire', title: 'Glaze fire (after Week 2)',  offsetDays:  9, durationMinutes:  30, defaultOwner: 'miso',   batchable: true },
      { phase: 'finish',     title: 'Mark ready for pickup',      offsetDays: 14, durationMinutes:  30, defaultOwner: 'shared' },
    ],
  },

  // ────────────────────────────────────────────────────────────
  // 3-week Pottery Foundations — wheel-thrown, multi-week course
  // ────────────────────────────────────────────────────────────
  {
    id:                'foundations-3wk',
    name:              '3-week Pottery Foundations',
    piecesPerStudent:  3,
    glazeMethod:       'hand-paint',
    pickupWindowDays:  28,
    notes:             'Anchor = Week 1 class. Bisque fires after W2; glaze in W3; final fire after W3.',
    tasks: [
      { phase: 'process',    title: 'Trim Week 1 pieces',         offsetDays:  3, durationMinutes:  60, defaultOwner: 'shared', batchable: true },
      { phase: 'bisque',     title: 'Bisque fire (between W2 and W3)', offsetDays: 12, durationMinutes: 30, defaultOwner: 'miso', batchable: true },
      { phase: 'class',      title: 'Week 3 class — students glaze pieces', offsetDays: 14, durationMinutes: 150, defaultOwner: null },
      { phase: 'glaze-fire', title: 'Glaze fire (after Week 3)',  offsetDays: 16, durationMinutes:  30, defaultOwner: 'miso',   batchable: true },
      { phase: 'finish',     title: 'Mark ready for pickup',      offsetDays: 21, durationMinutes:  30, defaultOwner: 'shared' },
    ],
  },

  // ────────────────────────────────────────────────────────────
  // 4-Week Mini Pottery Course — longer, more pieces
  // ────────────────────────────────────────────────────────────
  {
    id:                'course-4wk',
    name:              '4-Week Mini Pottery Course',
    piecesPerStudent:  4,
    glazeMethod:       'hand-paint',
    pickupWindowDays:  28,
    notes:             'Anchor = Week 1 class. Bisque after W3; glaze in W4; final fire after W4.',
    tasks: [
      { phase: 'process',    title: 'Trim across the course',     offsetDays:  3, durationMinutes:  90, defaultOwner: 'shared', batchable: true },
      { phase: 'bisque',     title: 'Bisque fire (between W3 and W4)', offsetDays: 19, durationMinutes: 30, defaultOwner: 'miso', batchable: true },
      { phase: 'class',      title: 'Week 4 class — students glaze pieces', offsetDays: 21, durationMinutes: 150, defaultOwner: null },
      { phase: 'glaze-fire', title: 'Glaze fire (after Week 4)',  offsetDays: 23, durationMinutes:  30, defaultOwner: 'miso',   batchable: true },
      { phase: 'finish',     title: 'Mark ready for pickup',      offsetDays: 28, durationMinutes:  30, defaultOwner: 'shared' },
    ],
  },

  // ────────────────────────────────────────────────────────────
  // Clay Date for Two — wheel-thrown, hand-paint glaze
  // ────────────────────────────────────────────────────────────
  {
    id:                'clay-date',
    name:              'Clay Date for Two',
    piecesPerStudent:  2,
    piecesPerCouple:   4,
    glazeMethod:       'hand-paint',
    pickupWindowDays:  28,
    notes:             '5 couples max. Cielo + Angel paired teach. Hand-paint glazing pools with Tasters.',
    tasks: [
      { phase: 'process',    title: 'Trim pieces',                offsetDays:  3, durationMinutes:  90, defaultOwner: 'shared', batchable: true,  notes: '4 pieces per couple. Batches with Tasters that ran the same week.' },
      { phase: 'bisque',     title: 'Bisque fire',                offsetDays:  6, durationMinutes:  30, defaultOwner: 'miso',   batchable: true },
      { phase: 'glaze',      title: 'Glaze pieces (hand-paint)',  offsetDays: 10, durationMinutes: 180, defaultOwner: 'cielo',  batchable: true,  notes: 'Pools with Taster glazing — Cielo coordinates.' },
      { phase: 'glaze-fire', title: 'Glaze fire',                 offsetDays: 13, durationMinutes:  30, defaultOwner: 'miso',   batchable: true },
      { phase: 'finish',     title: 'Mark ready for pickup',      offsetDays: 16, durationMinutes:  30, defaultOwner: 'shared',                   notes: 'Unload, label by couple, stage on pickup shelf.' },
    ],
  },
];

async function upsert(ct) {
  const res = await fetch(`${BASE}/api/admin`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PW}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ op: 'upsertClassType', ...ct }),
  });
  if (!res.ok) {
    console.error(`  upsert "${ct.name}" failed: ${res.status} — ${await res.text()}`);
    return false;
  }
  console.log(`  ✓ ${ct.name} — ${ct.tasks.length} tasks`);
  return true;
}

async function main() {
  console.log(`Seeding ${classTypes.length} class types against ${BASE}`);
  let ok = 0;
  for (const ct of classTypes) {
    if (await upsert(ct)) ok++;
  }
  console.log(`\nDone — ${ok}/${classTypes.length} succeeded.`);
  process.exit(ok === classTypes.length ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
