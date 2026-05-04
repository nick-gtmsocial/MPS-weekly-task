-- MPS Weekly Task Dashboard — Phase 5b: student count on classes
--
-- The generator was creating bisque + glaze fires for every class regardless
-- of whether anyone showed up, then multiplying per-piece tasks against an
-- always-empty pieces table (sync never populated it). Result: a flood of
-- robot tasks for empty classes (Cielo's complaint) AND missing fires for
-- classes that DID have students.
--
-- This column flips the trigger: kiln-phase tasks generate only when the
-- class has student_count > 0. Sync now passes the parsed Kilnfire "Fill"
-- count straight through to addClass.
--
-- Pure additive — defaults to 0 so existing rows keep behaving (no fires
-- spawned automatically until someone fills in the count).

alter table classes
  add column if not exists student_count int default 0;

-- Light index for the kiln-load preview query (sum student_counts across
-- classes feeding into a fire day). Keep it scoped to live rows.
create index if not exists classes_student_count_idx
  on classes (class_date, student_count) where deleted_at is null;
