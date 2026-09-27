ALTER TABLE events ADD COLUMN IF NOT EXISTS last_published_at TIMESTAMP;

UPDATE events
SET last_published_at = created_at
WHERE status = 'published' AND last_published_at IS NULL;