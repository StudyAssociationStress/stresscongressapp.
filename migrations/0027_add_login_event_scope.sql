-- Preserve the event that owns each login/security record.
ALTER TABLE "login_events"
  ADD COLUMN IF NOT EXISTS "event_id" TEXT;