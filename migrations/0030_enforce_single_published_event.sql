-- Repair any pre-existing duplicate live events before enforcing the invariant.
-- Keep the most recently published event live and archive the older rows without
-- changing their last_published_at history.
WITH ranked_published_events AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      ORDER BY last_published_at DESC NULLS LAST, created_at DESC, id DESC
    ) AS publication_rank
  FROM events
  WHERE status = 'published'
)
UPDATE events
SET status = 'archived'
WHERE id IN (
  SELECT id
  FROM ranked_published_events
  WHERE publication_rank > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS events_single_published_unique
  ON events (status)
  WHERE status = 'published';