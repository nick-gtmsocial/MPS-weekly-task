-- MPS Weekly Task Dashboard — Phase 5: explicit kiln schedule
--
-- Cielo's feedback: the generator was scheduling bisque + glaze-fire on the
-- same day because it placed each class's kiln tasks at class_date+offset
-- without looking at what else was on the kiln. Real studios fire when the
-- kiln is full enough to be efficient, on dates the team picks deliberately.
--
-- This table holds those team-picked fire dates. Generator snaps kiln-phase
-- tasks (bisque, glaze-fire) to the next scheduled fire of the matching
-- phase on/after class_date+offset, instead of placing them blindly.
--
-- Pure additive: existing weekly_tasks rows are not touched.

create table if not exists fire_schedule (
  id          uuid primary key default gen_random_uuid(),
  fire_date   date not null,
  phase       text not null check (phase in ('bisque','glaze-fire')),
  capacity    int,                        -- nullable = unlimited
  notes       text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  deleted_at  timestamptz
);

-- One row per (date, phase) — you can't schedule two bisques on the same day.
-- Different phases on the same day is also blocked at the constraint layer
-- (cross-phase = real kiln conflict), but we let the row exist if the team
-- wants to plan it deliberately.
create unique index if not exists fire_schedule_unique_live
  on fire_schedule (fire_date, phase) where deleted_at is null;

-- Lookup index for "next fire of phase X after date Y".
create index if not exists fire_schedule_lookup
  on fire_schedule (phase, fire_date) where deleted_at is null;
