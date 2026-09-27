ALTER TABLE events
  ADD COLUMN IF NOT EXISTS schedule_start text,
  ADD COLUMN IF NOT EXISTS schedule_end text;