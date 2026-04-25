// Seeds the non-class recurring chores. Same pattern as seed-class-types.js.
// Mirrors the `TASKS` array in index.html for the QUARTERLY/MONTHLY/BI-WEEKLY/
// WEEKLY/EVERY-SHIFT categories — those tasks are not driven by registrations
// so they live in recurring_tasks instead of class_type_tasks.

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });

const BASE = process.env.BASE_URL;
const PW   = process.env.STUDIO_PASSWORD;
if (!BASE || !PW) { console.error('BASE_URL and STUDIO_PASSWORD must be set'); process.exit(1); }

const recurringTasks = [
  // ── Quarterly ──
  { id: 'kiln-wash',           title: 'Apply kiln wash (3 coats, dry between, shelf tops only)', cadence: 'quarterly', defaultOwner: 'kizza', durationMinutes: 60, notes: 'NEVER apply to sidewalls — kiln wash on sidewalls migrates onto elements and causes failure.' },
  { id: 'clay-trap-check',     title: 'Check clay trap for blockages',                            cadence: 'quarterly', defaultOwner: 'kizza', durationMinutes: 30 },
  { id: 'air-filter',          title: 'Replace air filter',                                        cadence: 'quarterly', defaultOwner: 'kizza', durationMinutes: 20 },
  { id: 'kiln-element-check',  title: 'Test element resistance + replace full set if any fails',   cadence: 'quarterly', defaultOwner: 'kizza', durationMinutes: 90, notes: 'Mixed old/new elements fire unevenly; replace as a set.' },
  { id: 'thermocouple-check',  title: 'Test thermocouple with witness cones',                      cadence: 'quarterly', defaultOwner: 'kizza', durationMinutes: 30 },
  { id: 'shelves-stilts',      title: 'Inspect shelves, stilts, kiln furniture for cracks',        cadence: 'quarterly', defaultOwner: 'kizza', durationMinutes: 30 },
  { id: 'deep-clean-kiln',     title: 'Deep clean kiln interior (grounded vac), exterior, and table area', cadence: 'quarterly', defaultOwner: 'shared', durationMinutes: 60 },

  // ── Monthly ──
  { id: 'members-clay',        title: "Prepare members' clay (pre-portion + invoice update)", cadence: 'monthly', defaultOwner: 'kizza', durationMinutes: 60 },
  { id: 'mix-clear-glaze',     title: 'Mix clear glaze (if less than 1/3 of bucket remains)',  cadence: 'monthly', defaultOwner: 'kizza', durationMinutes: 45 },
  { id: 'sieve-glazes',        title: 'Sieve all glazes + recheck specific gravity',           cadence: 'monthly', defaultOwner: 'kizza', durationMinutes: 60, notes: 'One dedicated mixing stick per bucket, stored on hooks to dry.' },
  { id: 'workshop-cleanup',    title: 'Workshop / member-area maintenance (sweep, wipe, table-clean)', cadence: 'monthly', defaultOwner: 'shared', durationMinutes: 45 },
  { id: 'recharge-batteries',  title: 'Recharge heat-gun batteries',                            cadence: 'monthly', defaultOwner: 'wesley', durationMinutes: 10, notes: 'Recharge in studio; unplug before leaving.' },

  // ── Bi-weekly ──
  { id: 'inventory-check',     title: 'Check supply inventory (clay, glazes, underglazes, tools, brushes)', cadence: 'biweekly', defaultOwner: 'sam',    durationMinutes: 30 },
  { id: 'washroom-maint',      title: 'Washroom maintenance (or coordinate cleaner)',                       cadence: 'biweekly', defaultOwner: 'shared', durationMinutes: 30 },
  { id: 'dispose-clay-buckets',title: 'Dispose dirty clay buckets',                                          cadence: 'biweekly', defaultOwner: 'kizza',  durationMinutes: 30, notes: 'Clay-water bucket has been overflowing — increase frequency or rethink reclaim system.' },

  // ── Weekly ──
  { id: 'organize-tools',      title: 'Organize materials and tools',                                 cadence: 'weekly', defaultOwner: 'shared', durationMinutes: 30 },
  { id: 'reclaim-clay',        title: 'Reclaim clay (slurry method with drill + paint mixer)',        cadence: 'weekly', defaultOwner: 'kizza',  durationMinutes: 45 },
  { id: 'dispose-recyclables', title: 'Dispose recyclables',                                          cadence: 'weekly', defaultOwner: 'shared', durationMinutes: 15 },
  { id: 'mop-floor-1',         title: 'Mop floor (Tuesday)',                                          cadence: 'weekly', defaultOwner: 'shared', durationMinutes: 20 },
  { id: 'mop-floor-2',         title: 'Mop floor (Friday)',                                           cadence: 'weekly', defaultOwner: 'shared', durationMinutes: 20 },
  { id: 'invoicing',           title: 'Issue invoices (members, instructors)',                        cadence: 'weekly', defaultOwner: 'nick',   durationMinutes: 20 },
];

async function upsert(t) {
  const res = await fetch(`${BASE}/api/admin`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PW}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ op: 'upsertRecurringTask', ...t }),
  });
  if (!res.ok) {
    console.error(`  upsert "${t.title}" failed: ${res.status} — ${await res.text()}`);
    return false;
  }
  console.log(`  ✓ ${t.cadence.padEnd(10)} ${t.title}`);
  return true;
}

async function main() {
  console.log(`Seeding ${recurringTasks.length} recurring tasks against ${BASE}`);
  let ok = 0;
  for (const t of recurringTasks) {
    if (await upsert(t)) ok++;
  }
  console.log(`\nDone — ${ok}/${recurringTasks.length} succeeded.`);
  process.exit(ok === recurringTasks.length ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
