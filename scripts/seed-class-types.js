// Seeds the 5 class types and their workflow tasks.
// Usage:  node scripts/seed-class-types.js
// Idempotent — re-running replaces each class type's task list cleanly.
//
// Owner conventions:
//   default_owner = null   → resolved to the class's instructor at generation time
//   default_owner = 'kizza' → studio operations (kiln, glaze, post-processing)
//   default_owner = 'shared' → anyone available
//
// Workflow detail derived from:
//   - transcripts/2026-03-25_ops-deep-dive_sarah-kizza-nick.md
//   - data/class-catalog.md
//   - /tmp/mps-template-research-internal.md (mined per-class breakdown)
//
// Pickup window standardised at 28 days (was inconsistent: site said 3 wks,
// studio said 4 wks — Sarah recommended standardising on 4-week, line 606).

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });

const BASE = process.env.BASE_URL;
const PW   = process.env.STUDIO_PASSWORD;
if (!BASE || !PW) { console.error('BASE_URL and STUDIO_PASSWORD must be set'); process.exit(1); }

const classTypes = [
  // ────────────────────────────────────────────────────────────
  // Taster Class — 2 pieces/student, hand-paint glaze, batches with Clay Date
  // ────────────────────────────────────────────────────────────
  {
    id:                'taster',
    name:              'Taster Class',
    piecesPerStudent:  2,
    glazeMethod:       'hand-paint',
    defaultInstructor: null,                    // paired Cielo/Angel — class.instructor decides
    pickupWindowDays:  28,
    notes:             '~3–5 pieces attempted per student, 2 take-home. ~3 hours of hand-paint glaze labor per class.',
    tasks: [
      { phase: 'prep',       scope: 'per-class', title: 'Prep clay balls (40g × 5 per attendee + extras)', offsetDays: 0,  durationMinutes: 30,  defaultOwner: null },
      { phase: 'prep',       scope: 'per-class', title: 'Set up wheels, tools, tables',                    offsetDays: 0,  durationMinutes: 15,  defaultOwner: null },
      { phase: 'class',      scope: 'per-class', title: 'Run class (demo + support)',                      offsetDays: 0,  durationMinutes: 120, defaultOwner: null },
      { phase: 'process',    scope: 'per-class', title: 'Cleanup + place pieces in damp box',              offsetDays: 0,  durationMinutes: 30,  defaultOwner: null },
      { phase: 'process',    scope: 'per-class', title: 'Unwrap pieces + start drying',                    offsetDays: 1,  durationMinutes: 15,  defaultOwner: 'kizza' },
      { phase: 'process',    scope: 'per-class', title: 'Trim pieces',                                     offsetDays: 3,  durationMinutes: 90,  defaultOwner: 'kizza', batchable: true, notes: 'Done by Shello / kiln tech. Batches across classes that ran same week.' },
      { phase: 'bisque',     scope: 'per-class', title: 'Bisque load',                                     offsetDays: 6,  durationMinutes: 30,  defaultOwner: 'kizza', batchable: true },
      { phase: 'bisque',     scope: 'per-class', title: 'Bisque unload + match pieces to Kilnfire photos', offsetDays: 8,  durationMinutes: 45,  defaultOwner: 'kizza' },
      { phase: 'glaze',      scope: 'per-class', title: 'Glaze prep + hand-paint pieces',                  offsetDays: 10, durationMinutes: 180, defaultOwner: 'kizza' },
      { phase: 'glaze-fire', scope: 'per-class', title: 'Glaze fire load',                                 offsetDays: 13, durationMinutes: 30,  defaultOwner: 'kizza', batchable: true },
      { phase: 'glaze-fire', scope: 'per-class', title: 'Glaze fire unload + label pieces',                offsetDays: 15, durationMinutes: 45,  defaultOwner: 'kizza' },
      { phase: 'finish',     scope: 'per-class', title: 'Photo + post IG story',                           offsetDays: 15, durationMinutes: 15,  defaultOwner: 'shared' },
      { phase: 'finish',     scope: 'per-class', title: 'Stage on pickup shelf + mark ready in Kilnfire',  offsetDays: 16, durationMinutes: 15,  defaultOwner: 'shared' },
    ],
  },

  // ────────────────────────────────────────────────────────────
  // Matcha Bowl — 1 piece/student, dunk clear glaze, batches with Mug
  // ────────────────────────────────────────────────────────────
  {
    id:                'matcha-bowl',
    name:              'Matcha Bowl',
    piecesPerStudent:  1,
    glazeMethod:       'dunk',
    defaultInstructor: 'angel',
    pickupWindowDays:  28,
    notes:             '600g clay per student. Wrapped on bat to slow-dry, unwrapped 2–4 days later. Dunk-glaze batches well with Mug.',
    tasks: [
      { phase: 'prep',       scope: 'per-class', title: 'Prep 600g clay balls + bats',                          offsetDays: 0, durationMinutes: 30,  defaultOwner: null },
      { phase: 'prep',       scope: 'per-class', title: 'Set up workstations',                                   offsetDays: 0, durationMinutes: 15,  defaultOwner: null },
      { phase: 'class',      scope: 'per-class', title: 'Run class (demo + handbuilding support)',               offsetDays: 0, durationMinutes: 120, defaultOwner: null },
      { phase: 'process',    scope: 'per-class', title: 'Wrap pieces in plastic + label + store on top shelf',   offsetDays: 0, durationMinutes: 20,  defaultOwner: null },
      { phase: 'process',    scope: 'per-class', title: 'Unwrap pieces + dry fully',                             offsetDays: 3, durationMinutes: 15,  defaultOwner: 'kizza' },
      { phase: 'bisque',     scope: 'per-class', title: 'Bisque load',                                           offsetDays: 6, durationMinutes: 30,  defaultOwner: 'kizza', batchable: true, notes: 'MUST bisque by next week — pieces must be completely dry first.' },
      { phase: 'bisque',     scope: 'per-class', title: 'Bisque unload + match to Kilnfire photos',              offsetDays: 8, durationMinutes: 30,  defaultOwner: 'kizza' },
      { phase: 'glaze',      scope: 'per-class', title: 'Wax-resist bottoms + dunk in clear glaze + wipe',       offsetDays: 10, durationMinutes: 60, defaultOwner: 'kizza', batchable: true, notes: 'Batches with Mug Workshop pieces in same dunk session.' },
      { phase: 'glaze-fire', scope: 'per-class', title: 'Glaze fire load',                                       offsetDays: 13, durationMinutes: 30,  defaultOwner: 'kizza', batchable: true },
      { phase: 'glaze-fire', scope: 'per-class', title: 'Glaze fire unload + check for thin glaze (refire?)',    offsetDays: 15, durationMinutes: 30,  defaultOwner: 'kizza', notes: 'Watch for thin glaze — refire turnaround is 4–7 days.' },
      { phase: 'finish',     scope: 'per-class', title: 'Label + group by student',                              offsetDays: 15, durationMinutes: 15,  defaultOwner: 'shared' },
      { phase: 'finish',     scope: 'per-class', title: 'Stage on pickup shelf + mark ready in Kilnfire',        offsetDays: 16, durationMinutes: 15,  defaultOwner: 'shared' },
    ],
  },

  // ────────────────────────────────────────────────────────────
  // Matcha Set — 3 pieces/student, STUDENT glazes (week 2), high refire risk
  // ────────────────────────────────────────────────────────────
  {
    id:                'matcha-set',
    name:              'Matcha Set (2-week course)',
    piecesPerStudent:  3,
    glazeMethod:       'student-applied',
    defaultInstructor: 'angel',
    pickupWindowDays:  28,
    notes:             '3 pieces: bowl (600g) + cup (500g) + slab whisk holder. Week 1 build, Week 2 students glaze. High refire rate — students apply glaze unevenly. Offsets are relative to Week 1 class day.',
    tasks: [
      { phase: 'prep',       scope: 'per-class', title: 'Prep clay (600g bowl + 500g cup + slab) per student', offsetDays: 0, durationMinutes: 30,  defaultOwner: null },
      { phase: 'class',      scope: 'per-class', title: 'Run Week 1 class (build all 3 pieces)',                offsetDays: 0, durationMinutes: 150, defaultOwner: null },
      { phase: 'process',    scope: 'per-class', title: 'Wrap attached pieces, unwrap solid pieces',            offsetDays: 0, durationMinutes: 20,  defaultOwner: null },
      { phase: 'process',    scope: 'per-class', title: 'Turn pieces over for even drying',                     offsetDays: 3, durationMinutes: 15,  defaultOwner: 'kizza' },
      { phase: 'process',    scope: 'per-class', title: 'Verify pieces are completely dry',                     offsetDays: 5, durationMinutes: 10,  defaultOwner: 'kizza', notes: 'Wet pieces explode in the kiln.' },
      { phase: 'bisque',     scope: 'per-class', title: 'Bisque load',                                          offsetDays: 6, durationMinutes: 30,  defaultOwner: 'kizza', batchable: true },
      { phase: 'bisque',     scope: 'per-class', title: 'Bisque unload + ready bisque for Week 2',              offsetDays: 7, durationMinutes: 30,  defaultOwner: 'kizza' },
      { phase: 'class',      scope: 'per-class', title: 'Run Week 2 class (students apply glaze, instructor supervises)', offsetDays: 7, durationMinutes: 120, defaultOwner: null },
      { phase: 'glaze-fire', scope: 'per-class', title: 'Glaze fire load',                                      offsetDays: 8,  durationMinutes: 30, defaultOwner: 'kizza', batchable: true },
      { phase: 'glaze-fire', scope: 'per-class', title: 'Glaze fire unload + QC for refires',                   offsetDays: 10, durationMinutes: 45, defaultOwner: 'kizza', notes: 'Highest refire rate of any class — student-applied glaze is uneven. Plan a refire window.' },
      { phase: 'finish',     scope: 'per-class', title: 'Refire any pieces with thin glaze (4–7 day window)',   offsetDays: 14, durationMinutes: 30, defaultOwner: 'kizza', batchable: true },
      { phase: 'finish',     scope: 'per-class', title: 'Label + group by student',                             offsetDays: 18, durationMinutes: 20, defaultOwner: 'shared' },
      { phase: 'finish',     scope: 'per-class', title: 'Stage on pickup shelf + mark ready in Kilnfire',       offsetDays: 18, durationMinutes: 15, defaultOwner: 'shared' },
    ],
  },

  // ────────────────────────────────────────────────────────────
  // Mug Workshop — 1 piece/student, dunk clear glaze, batches with Matcha Bowl
  // ────────────────────────────────────────────────────────────
  {
    id:                'mug',
    name:              'Mug Workshop',
    piecesPerStudent:  1,
    glazeMethod:       'dunk',
    defaultInstructor: null,                    // Zoe Tong — not yet in our staff list
    pickupWindowDays:  28,
    notes:             'Slab-built mug, food-safe clear glaze. Dunk-glazes batch with Matcha Bowl. Instructor (Zoe Tong) is not in the staff list — assign manually until added.',
    tasks: [
      { phase: 'prep',       scope: 'per-class', title: 'Prep slab clay + handles + texture tools',           offsetDays: 0,  durationMinutes: 25,  defaultOwner: null },
      { phase: 'prep',       scope: 'per-class', title: 'Set up workstations',                                 offsetDays: 0,  durationMinutes: 15,  defaultOwner: null },
      { phase: 'class',      scope: 'per-class', title: 'Run class (slab-build + handle attach + texture)',    offsetDays: 0,  durationMinutes: 120, defaultOwner: null },
      { phase: 'process',    scope: 'per-class', title: 'Wrap pieces + label + store',                         offsetDays: 0,  durationMinutes: 15,  defaultOwner: null },
      { phase: 'process',    scope: 'per-class', title: 'Unwrap + dry fully',                                  offsetDays: 3,  durationMinutes: 15,  defaultOwner: 'kizza' },
      { phase: 'bisque',     scope: 'per-class', title: 'Bisque load',                                         offsetDays: 6,  durationMinutes: 30,  defaultOwner: 'kizza', batchable: true },
      { phase: 'bisque',     scope: 'per-class', title: 'Bisque unload + match to Kilnfire photos',            offsetDays: 8,  durationMinutes: 30,  defaultOwner: 'kizza' },
      { phase: 'glaze',      scope: 'per-class', title: 'Wax-resist + dunk in clear glaze + wipe bottoms',     offsetDays: 10, durationMinutes: 45,  defaultOwner: 'kizza', batchable: true, notes: 'Batches with Matcha Bowl in same dunk session.' },
      { phase: 'glaze-fire', scope: 'per-class', title: 'Glaze fire load',                                     offsetDays: 13, durationMinutes: 30,  defaultOwner: 'kizza', batchable: true },
      { phase: 'glaze-fire', scope: 'per-class', title: 'Glaze fire unload',                                   offsetDays: 15, durationMinutes: 30,  defaultOwner: 'kizza' },
      { phase: 'finish',     scope: 'per-class', title: 'Label + group by student',                            offsetDays: 15, durationMinutes: 15,  defaultOwner: 'shared' },
      { phase: 'finish',     scope: 'per-class', title: 'Stage on pickup shelf + mark ready in Kilnfire',      offsetDays: 16, durationMinutes: 15,  defaultOwner: 'shared' },
    ],
  },

  // ────────────────────────────────────────────────────────────
  // Clay Date for Two — 4 pieces/couple, hand-paint, batches with Taster
  // ────────────────────────────────────────────────────────────
  {
    id:                'clay-date',
    name:              'Clay Date for Two',
    piecesPerStudent:  2,                     // 2 per person × 2 = 4 per couple
    piecesPerCouple:   4,
    glazeMethod:       'hand-paint',
    defaultInstructor: null,                  // paired Cielo + Angel
    pickupWindowDays:  28,
    notes:             '5 couples max. Cielo + Angel paired teach. Hand-paint glazing batches with Taster pieces (3-hour pool).',
    tasks: [
      { phase: 'prep',       scope: 'per-class', title: 'Prep ~50–60 clay balls (40g) for 5 couples',         offsetDays: 0,  durationMinutes: 30,  defaultOwner: null },
      { phase: 'prep',       scope: 'per-class', title: 'Set up 5 couple-stations with wheels + tools',       offsetDays: 0,  durationMinutes: 20,  defaultOwner: null },
      { phase: 'class',      scope: 'per-class', title: 'Run class (Cielo + Angel paired support)',           offsetDays: 0,  durationMinutes: 120, defaultOwner: null },
      { phase: 'process',    scope: 'per-class', title: 'Cleanup + place pieces in damp box',                  offsetDays: 0,  durationMinutes: 30,  defaultOwner: null },
      { phase: 'process',    scope: 'per-class', title: 'Unwrap + start drying',                               offsetDays: 1,  durationMinutes: 15,  defaultOwner: 'kizza' },
      { phase: 'process',    scope: 'per-class', title: 'Trim pieces',                                         offsetDays: 3,  durationMinutes: 90,  defaultOwner: 'kizza', batchable: true },
      { phase: 'bisque',     scope: 'per-class', title: 'Bisque load',                                         offsetDays: 6,  durationMinutes: 30,  defaultOwner: 'kizza', batchable: true },
      { phase: 'bisque',     scope: 'per-class', title: 'Bisque unload + match by couple',                     offsetDays: 8,  durationMinutes: 45,  defaultOwner: 'kizza' },
      { phase: 'glaze',      scope: 'per-class', title: 'Glaze prep + hand-paint pieces',                      offsetDays: 10, durationMinutes: 180, defaultOwner: 'kizza', batchable: true, notes: 'Batches with Taster glazing — 3-hour pool.' },
      { phase: 'glaze-fire', scope: 'per-class', title: 'Glaze fire load',                                     offsetDays: 13, durationMinutes: 30,  defaultOwner: 'kizza', batchable: true },
      { phase: 'glaze-fire', scope: 'per-class', title: 'Glaze fire unload + label by couple',                 offsetDays: 15, durationMinutes: 45,  defaultOwner: 'kizza' },
      { phase: 'finish',     scope: 'per-class', title: 'Photo + post IG story',                               offsetDays: 15, durationMinutes: 15,  defaultOwner: 'shared' },
      { phase: 'finish',     scope: 'per-class', title: 'Stage on pickup shelf + mark ready in Kilnfire',      offsetDays: 16, durationMinutes: 15,  defaultOwner: 'shared' },
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
