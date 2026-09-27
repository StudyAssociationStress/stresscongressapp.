-- Sessions were introduced before multi-year events. Scope existing sessions to
-- the current published event where possible, then require all new reads to use
-- the event_id field.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS event_id text;

UPDATE sessions
SET event_id = (
  SELECT id
  FROM events
  WHERE status = 'published'
  ORDER BY year DESC
  LIMIT 1
)
WHERE event_id IS NULL
  AND EXISTS (SELECT 1 FROM events WHERE status = 'published');