-- Preserve the attendee's event on GDPR requests, including after account deletion.
ALTER TABLE "gdpr_requests" ADD COLUMN IF NOT EXISTS "event_id" VARCHAR;

-- Existing pending requests still have their attendee row available; retain their
-- event so they remain visible to the correct admin event only.
UPDATE "gdpr_requests" AS g
SET "event_id" = u."event_id"
FROM "users" AS u
WHERE g."event_id" IS NULL
  AND g."user_id" = u."id"
  AND u."event_id" IS NOT NULL;