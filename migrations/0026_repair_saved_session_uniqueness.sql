-- Repair databases where the original saved-session migration was recorded
-- before its unique index was present.
WITH ranked_saved_sessions AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id, session_id
      ORDER BY created_at ASC, id ASC
    ) AS duplicate_number
  FROM saved_sessions
)
DELETE FROM saved_sessions
WHERE id IN (
  SELECT id
  FROM ranked_saved_sessions
  WHERE duplicate_number > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS saved_sessions_user_session_unique
  ON saved_sessions (user_id, session_id);