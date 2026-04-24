-- MPS Weekly Task Dashboard — Phase 3 Goals + Templates
-- Apply via: Supabase Dashboard → SQL Editor → paste + run.
-- RLS stays disabled; the Vercel API is the sole writer (STUDIO_PASSWORD gate).

-- ─────────────────────────────────────────────────────────────
-- Templates
-- sections shape: [
--   { "name": "Planning",
--     "tasks": [
--       { "title": "...",
--         "offset_days": -30,          -- nullable; relative to target_date
--         "default_owner": null,       -- nullable staff_id
--         "subsection": null,          -- nullable, e.g. "Design Assets"
--         "notes": ""
--       } ] } ]
-- ─────────────────────────────────────────────────────────────
create table if not exists templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  sections    jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Goals
-- target_date is the anchor: all template tasks with offset_days get a
-- deadline computed as target_date + offset_days when the goal is created.
-- ─────────────────────────────────────────────────────────────
create table if not exists goals (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  target_date date not null,
  owner       text,                 -- staff_id; nullable
  status      text not null default 'active',  -- active | done | cancelled
  notes       text,
  template_id uuid references templates(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists goals_target_date_idx on goals (target_date);
create index if not exists goals_status_idx      on goals (status);

-- ─────────────────────────────────────────────────────────────
-- Goal tasks — each goal's owned to-do list, instantiated from the
-- goal's template (if any) or added freeform.
-- ─────────────────────────────────────────────────────────────
create table if not exists goal_tasks (
  id          uuid primary key default gen_random_uuid(),
  goal_id     uuid not null references goals(id) on delete cascade,
  section     text,
  subsection  text,
  title       text not null,
  owner       text,
  deadline    date,
  status      text not null default 'todo',
  notes       text,
  sort_idx    int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists goal_tasks_goal_idx     on goal_tasks (goal_id);
create index if not exists goal_tasks_owner_idx    on goal_tasks (owner);
create index if not exists goal_tasks_deadline_idx on goal_tasks (deadline);
