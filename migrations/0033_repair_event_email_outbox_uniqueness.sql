-- Repair databases where Drizzle schema push created the outbox table before
-- migration 0032 could add its unique constraint. Keep a sent or active row
-- when duplicates exist so the repair does not re-queue a completed delivery.
WITH ranked_event_email_outbox AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY event_id, user_id, kind
      ORDER BY
        CASE
          WHEN status = 'sent' THEN 0
          WHEN status = 'processing' THEN 1
          WHEN status = 'pending' THEN 2
          ELSE 3
        END,
        updated_at DESC,
        created_at ASC,
        id ASC
    ) AS duplicate_number
  FROM event_email_outbox
)
DELETE FROM event_email_outbox
WHERE id IN (
  SELECT id
  FROM ranked_event_email_outbox
  WHERE duplicate_number > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS event_email_outbox_once
  ON event_email_outbox (event_id, user_id, kind);