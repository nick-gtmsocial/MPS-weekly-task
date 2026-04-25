-- MPS Weekly Task Dashboard — Phase 4 Class-Driven Operations Engine
-- Adds:
--   class_types          definitions of each class type (Nick-curated)
--   class_type_tasks     per-class-type declarative workflow
--   recurring_tasks      non-class chores (kiln wash, inventory, etc.)
--   weekly_tasks         the canonical "what's due this week" table
--   kilnfire_scrapes     audit trail for the daily Kilnfire scrape
--
-- Apply via Supabase SQL Editor → New query → paste → Run.

-- ─────────────────────────────────────────────────────────────
-- class_types
-- ─────────────────────────────────────────────────────────────
create table if not exists class_types (
  id                  text primary key,                -- 'taster' | 'matcha-bowl' | ...
  name                text not null,                   -- 'Taster Class'
  pieces_per_student  int  not null default 1,
  pieces_per_couple   int  null,                       -- only for couples-format classes
  glaze_method        text null,                       -- 'hand-paint' | 'dunk' | 'student-applied'
  default_instructor  text null references staff(id),
  pickup_window_days  int  not null default 28,        -- 4-week studio standard
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- class_type_tasks
-- Each row defines a piece of work that should fire when a class
-- of this type runs. scope='per-class' fires once per class instance;
-- scope='per-piece' fires once per piece in that class.
-- ─────────────────────────────────────────────────────────────
create table if not exists class_type_tasks (
  id                uuid primary key default gen_random_uuid(),
  class_type_id     text not null references class_types(id) on delete cascade,
  phase             text not null,                     -- 'prep' | 'class' | 'process' | 'bisque' | 'glaze' | 'glaze-fire' | 'finish'
  scope             text not null,                     -- 'per-class' | 'per-piece'
  title             text not null,
  default_owner     text null,                          -- staff_id or special placeholder ('instructor', 'kiln-tech')
  offset_days       int  not null default 0,           -- relative to class_date; positive = after
  duration_minutes  int  null,                          -- estimated effort
  batchable         bool not null default false,
  sort_idx          int  not null default 0,
  notes             text,
  check (scope in ('per-class','per-piece'))
);

create index if not exists class_type_tasks_class_type_idx on class_type_tasks (class_type_id);

-- ─────────────────────────────────────────────────────────────
-- recurring_tasks
-- Non-class chores that fire on a cadence regardless of registrations.
-- ─────────────────────────────────────────────────────────────
create table if not exists recurring_tasks (
  id                text primary key,                  -- 'kiln-wash-quarterly' | 'inventory-check' | ...
  title             text not null,
  cadence           text not null,                     -- 'weekly' | 'biweekly' | 'monthly' | 'quarterly'
  default_owner     text null,
  duration_minutes  int  null,
  notes             text,
  active            bool not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (cadence in ('weekly','biweekly','monthly','quarterly'))
);

-- ─────────────────────────────────────────────────────────────
-- weekly_tasks
-- THE canonical "what's due this week" table. Filled by the
-- generation engine. Each row points back to its source via the
-- nullable FK fields; only one source FK is set per row.
-- ─────────────────────────────────────────────────────────────
create table if not exists weekly_tasks (
  id                  uuid primary key default gen_random_uuid(),
  week_key            date not null,                   -- Monday of the target week
  due_date            date not null,
  source_kind         text not null,                   -- 'piece' | 'class' | 'recurring' | 'goal' | 'special' | 'manual'

  -- Source FKs (only one is set per row, except 'piece' which sets both class_id + piece_id)
  class_id            uuid null references classes(id)         on delete cascade,
  piece_id            uuid null references pieces(id)          on delete cascade,
  class_type_task_id  uuid null references class_type_tasks(id) on delete set null,
  recurring_task_id   text null references recurring_tasks(id) on delete cascade,
  goal_task_id        uuid null references goal_tasks(id)      on delete cascade,
  special_task_id     uuid null references special_tasks(id)   on delete cascade,

  -- Denormalised for fast list rendering:
  title               text not null,
  phase               text null,
  batch_key           text null,                       -- shared key so cross-class bisque/glaze rows merge
  assignee            text null references staff(id),
  status              text not null default 'todo',
  duration_minutes    int  null,
  notes               text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  check (source_kind in ('piece','class','recurring','goal','special','manual'))
);

create index if not exists weekly_tasks_week_idx     on weekly_tasks (week_key);
create index if not exists weekly_tasks_assignee_idx on weekly_tasks (assignee);
create index if not exists weekly_tasks_batch_idx    on weekly_tasks (batch_key);
create index if not exists weekly_tasks_status_idx   on weekly_tasks (status);

-- Idempotency keys: prevent the generator from inserting duplicate rows on
-- re-runs. One unique constraint per source_kind, scoped to the dimensions
-- that uniquely identify a generated task.
create unique index if not exists weekly_tasks_unique_piece
  on weekly_tasks (piece_id, class_type_task_id) where source_kind = 'piece';

create unique index if not exists weekly_tasks_unique_class
  on weekly_tasks (class_id, class_type_task_id) where source_kind = 'class';

create unique index if not exists weekly_tasks_unique_recurring
  on weekly_tasks (recurring_task_id, week_key) where source_kind = 'recurring';

create unique index if not exists weekly_tasks_unique_goal
  on weekly_tasks (goal_task_id, week_key) where source_kind = 'goal';

create unique index if not exists weekly_tasks_unique_special
  on weekly_tasks (special_task_id, week_key) where source_kind = 'special';

-- ─────────────────────────────────────────────────────────────
-- kilnfire_scrapes
-- Audit row per scrape run. errors holds skipped-class details.
-- ─────────────────────────────────────────────────────────────
create table if not exists kilnfire_scrapes (
  id                 uuid primary key default gen_random_uuid(),
  scraped_at         timestamptz not null default now(),
  classes_pulled     int  not null default 0,
  classes_inserted   int  not null default 0,
  classes_skipped    int  not null default 0,
  errors             jsonb null,                       -- [{ template_name, reason, kilnfire_id? }]
  notes              text
);

create index if not exists kilnfire_scrapes_at_idx on kilnfire_scrapes (scraped_at desc);
