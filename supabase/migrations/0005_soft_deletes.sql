-- MPS Weekly Task Dashboard — Phase 4 polish: soft-delete safety net
-- Adds deleted_at to tables holding user-generated work so accidental
-- DELETE ops become restorable for ~30 days. Pure additive change —
-- no existing rows touched.
--
-- Skipped tables (intentional):
--   staff, recurring_tasks, templates, class_types  — config, not work
--   week_assignments                                 — per-cell mutable state
--   special_task_updates                             — append-only audit
--   kilnfire_scrapes                                 — append-only audit

alter table classes        add column if not exists deleted_at timestamptz;
alter table pieces         add column if not exists deleted_at timestamptz;
alter table weekly_tasks   add column if not exists deleted_at timestamptz;
alter table special_tasks  add column if not exists deleted_at timestamptz;
alter table goals          add column if not exists deleted_at timestamptz;
alter table goal_tasks     add column if not exists deleted_at timestamptz;

-- Partial indexes so the common "fetch live rows" query stays fast even
-- when soft-deleted rows accumulate.
create index if not exists classes_live_idx        on classes        (week_key)  where deleted_at is null;
create index if not exists pieces_live_idx         on pieces         (class_id)  where deleted_at is null;
create index if not exists weekly_tasks_live_idx   on weekly_tasks   (week_key)  where deleted_at is null;
create index if not exists special_tasks_live_idx  on special_tasks  (staff_id)  where deleted_at is null;
create index if not exists goals_live_idx          on goals          (target_date) where deleted_at is null;
create index if not exists goal_tasks_live_idx     on goal_tasks     (goal_id)   where deleted_at is null;
