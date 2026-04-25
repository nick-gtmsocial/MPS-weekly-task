-- MPS Weekly Task Dashboard — Phase 3.5 Sub-goals
-- Adds parent_id to goals so a parent goal ("Mother's Day 2026") can
-- hold child goals ("Launch matcha class", "Re-engage lapsed customers",
-- "Studio prep") that each carry their own task list.

alter table goals
  add column if not exists parent_id uuid references goals(id) on delete cascade;

create index if not exists goals_parent_idx on goals (parent_id);
