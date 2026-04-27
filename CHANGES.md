# What This Dashboard Does Now

Last updated: 2026-04-27

The MPS Weekly Task dashboard now **automatically generates the post-processing
tasks** that follow each class run by the studio, batches them where it makes
sense, and surfaces them to the right person on the right day.

Live at **<https://mps-weekly-task.vercel.app>** — password is the studio
password, set per device.

---

## TL;DR for staff

Open the dashboard. Pick **You: <your name>** in the top-right.

You'll land on **My Week** — a list of every task assigned to you, grouped
into:

- ⚠ **Overdue** — past due, still open
- ⏰ **Today**
- **This week**
- ✓ **Done** — what you've already finished

Click the **✓** button on any card to mark it done. Click again to un-mark.
Click the date if you need to move a task to a different day.

That's it. Everything else is for managers.

---

## TL;DR for management

Five views matter:

| Tab | What it's for |
|---|---|
| **My Week** | Your personal queue (above) |
| **Planner** | Every auto-generated task for the week, group-by-day, with owner dropdowns and "show done" toggle. The day-to-day operations cockpit. |
| **Calendar** | Month grid. Each day's dots are coloured by who's assigned (matches the legend). Click a day for the full task list. Spot bottlenecks visually. |
| **Goals** | Backwards-planned campaigns. Pick a target date and a template (Campaign Launch, Seasonal Promotion, Lapsed Customer Re-engagement, etc.) — system generates the task list with deadlines. Sub-goals supported. |
| **Classes** | The raw record of past + upcoming classes pulled in nightly from Kilnfire. |

Two legacy tabs (**Weekly Tasks** = old 6-day grid; **Special Tasks** = one-off
tasks per staff) still work but aren't where the action is.

---

## What runs on its own

Every morning at **10am ET**, a GitHub Action logs into Kilnfire, pulls the
last 14 days of classes, and for each new one:

1. Records the class in our database (with its Kilnfire id, attendees,
   instructor)
2. Looks up the class type (Taster / Matcha Bowl / Matcha Set / Mug Workshop /
   Clay Date for Two)
3. Generates the post-processing tasks

The post-processing recipes are deliberately minimal — class prep and the
class itself are NOT tracked here, because every instructor already knows
they have to do that. Just the post-class operational work:

| Class type | Post-processing pipeline |
|---|---|
| Taster + Clay Date | Trim (+3d) → Bisque fire (+6d) → Glaze hand-paint (+10d) → Glaze fire (+13d) → Mark ready (+16d) |
| Matcha Bowl + Mug Workshop | Bisque fire (+6d) → Dip glaze (+9d) → Glaze fire (+12d) → Mark ready (+15d) |
| Matcha Set (2-week course) | Bisque fire before W2 (+5d) → Glaze fire after W2 (+8d) → Mark ready (+14d) |

**Default owner rules** baked into the recipes:

- Miso loads the kiln (Cielo's preference — only Miso loads).
- Cielo glazes Taster + Clay Date pieces (her domain).
- Anyone can trim, dip-glaze, unload, or mark ready.

When two classes run the same week, their bisque-load and glaze-fire-load
tasks share a `batch` pill so the team sees one card covering all
classes' pieces, not three.

---

## How to do common things

| You want to… | Where |
|---|---|
| Mark a task done | Click the ✓ button on the task card. (My Week, Planner, or Calendar.) |
| Un-mark a task | Click ✓ again. Toggles both ways. |
| Move a task to a different day | Click the small date input on the task row. |
| Reassign a task | In **Planner**, the owner dropdown on each row. |
| Add a one-off task | **Planner** → **+ Add Task** (top-right). |
| Set a campaign goal | **Goals** → **+ New Goal**. Pick Campaign Launch (or another template) and a target date — system back-plans the deadlines. |
| Filter the Planner to one person | Click their chip in the toolbar. "All staff" resets. |
| See who's busy on a given day | **Calendar** — coloured dots match the legend bar. |

---

## How to add or remove a staff member

Just say it in chat to Claude:

- "add Phlox to staff"
- "deactivate Wesley"
- "change Cielo's color to teal"
- "rename Sam to Sam K"

Claude uses the `manage-staff` skill (defined in `Mini Pottery
Studio/.claude/skills/manage-staff/SKILL.md`) to make the API call. The
dashboard refreshes the staff list on next page load — no code edit, no
deploy needed.

Two important habits:

- **Soft delete** is the default. Setting `active=false` hides them from
  selectors but keeps the row, so historical task assignments don't break.
- **Hard delete** only when explicitly requested ("delete forever") and only
  if no special tasks point at them.

---

## How to edit class type recipes

The recipes are deliberately code-seeded (not editable in the UI) so the
operational workflow stays stable. To change one:

1. Edit `scripts/seed-class-types.js`.
2. Run `node scripts/seed-class-types.js` from the `MPS-weekly-task/`
   directory.
3. Existing classes' tasks get refreshed on next regeneration; new classes
   pick up the change immediately.

Same pattern for goal templates (`scripts/seed-templates.js`) and recurring
chores (`scripts/seed-recurring-tasks.js`).

---

## Architecture, briefly

- **Frontend**: single static `index.html` deployed to Vercel.
- **Backend**: small Vercel serverless functions in `api/` that proxy to
  Supabase (a Postgres database). Password-gated via `STUDIO_PASSWORD`.
- **Daily sync**: GitHub Actions runs `scripts/sync-kilnfire.py` against the
  Kilnfire admin export endpoint. Read-only against Kilnfire.
- **Tests**: 35 Playwright specs in `tests/`. Run with `npm test`. Cover
  generation math, batching, idempotency, UI flows, filters, and staff
  propagation.

Database tables live alongside the existing `calendar_state` table in the
same Supabase project. Migrations are in `supabase/migrations/` (run them
manually via the Supabase SQL Editor when applying a new one).

---

## Where to look when something's off

| Symptom | First thing to check |
|---|---|
| Tasks aren't generating for a class | Check `kilnfire_scrapes` audit table in Supabase for the latest run; the class template name might not match a known class type. |
| A staff member's tasks aren't showing | Verify they're `active=true` in the staff table (or the dashboard's legend). |
| Today's tab badge counts look off | Reload — the dashboard caches the loaded week in memory; mutations elsewhere don't auto-fan-out. |
| Kilnfire sync failed in GitHub Actions | Check the Actions tab on `nick-gtmsocial/MPS-weekly-task`. Most failures are auth — re-check the secrets. |
| Tests broke | `npm test` locally; if a Phase 5+ change touched the engine, the engine specs in `tests/engine.spec.js` are the canary. |
