-- MPS Weekly Task Dashboard — Phase 1 Foundation
-- Apply via: Supabase Dashboard → SQL Editor → paste + run.
-- Tables are accessed only by the Vercel API using the service key;
-- RLS is intentionally left disabled to match the calendar_state pattern.

-- ─────────────────────────────────────────────────────────────
-- Staff
-- ─────────────────────────────────────────────────────────────
create table if not exists staff (
  id       text primary key,
  name     text not null,
  color    text not null,
  initial  text not null,
  active   boolean not null default true,
  sort_idx int  not null default 0
);

insert into staff (id, name, color, initial, sort_idx) values
  ('kizza',  'Kizza',  '#0D9488', 'K',  1),
  ('cielo',  'Cielo',  '#0891B2', 'C',  2),
  ('nick',   'Nick',   '#7C3AED', 'N',  3),
  ('wesley', 'Wesley', '#2563EB', 'W',  4),
  ('miso',   'Miso',   '#DC2626', 'M',  5),
  ('sam',    'Sam',    '#DB2777', 'S',  6),
  ('angel',  'Angel',  '#16A34A', 'A',  7),
  ('shared', 'Shared', '#EA580C', 'SH', 8)
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────
-- Weekly recurring task assignments
-- One row = one cell (task × day-of-week) in one week.
-- week_key is the Monday of the week (date).
-- ─────────────────────────────────────────────────────────────
create table if not exists week_assignments (
  week_key   date not null,
  task_id    text not null,
  day_idx    int  not null check (day_idx between 0 and 5),
  assignees  text[] not null default '{}',
  status     text,
  note       text,
  updated_at timestamptz not null default now(),
  primary key (week_key, task_id, day_idx)
);

create index if not exists week_assignments_week_idx on week_assignments (week_key);

-- ─────────────────────────────────────────────────────────────
-- Special (one-off) tasks per staff per week
-- ─────────────────────────────────────────────────────────────
create table if not exists special_tasks (
  id         uuid primary key default gen_random_uuid(),
  week_key   date not null,
  staff_id   text not null references staff(id),
  title      text not null,
  scope      text,
  deadline   date,
  status     text not null default 'todo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists special_tasks_week_idx    on special_tasks (week_key);
create index if not exists special_tasks_staff_idx   on special_tasks (staff_id);

create table if not exists special_task_updates (
  id              uuid primary key default gen_random_uuid(),
  special_task_id uuid not null references special_tasks(id) on delete cascade,
  update_date     date not null default current_date,
  text            text not null,
  created_at      timestamptz not null default now()
);

create index if not exists special_task_updates_parent_idx on special_task_updates (special_task_id);

-- ─────────────────────────────────────────────────────────────
-- Classes (per week) + their pieces
-- classes.kilnfire_external_id is the Kilnfire class id for dedup on daily scrape.
-- ─────────────────────────────────────────────────────────────
create table if not exists classes (
  id                    uuid primary key default gen_random_uuid(),
  week_key              date not null,
  class_num             text,
  type                  text,
  class_date            date,
  instructor            text,
  kilnfire_link         text,
  kilnfire_external_id  text unique,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists classes_week_idx on classes (week_key);
create index if not exists classes_date_idx on classes (class_date);

-- pieces.stage_history is the append-only record used for cycle-time analytics
-- in Phase 6. Shape: [{"stage": "Greenware", "at": "2026-04-24T15:00:00Z", "by": "cielo"}, ...]
create table if not exists pieces (
  id            uuid primary key default gen_random_uuid(),
  class_id      uuid not null references classes(id) on delete cascade,
  student       text,
  description   text,
  stage         text not null default 'Greenware',
  notes         text,
  stage_history jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists pieces_class_idx on pieces (class_id);
create index if not exists pieces_stage_idx on pieces (stage);

-- ─────────────────────────────────────────────────────────────
-- Tables for later phases (Goals / Templates / Monthly goals / Kilnfire
-- scrape audit) are provisioned in later migration files so this first
-- apply stays small and easy to verify.
-- ─────────────────────────────────────────────────────────────
