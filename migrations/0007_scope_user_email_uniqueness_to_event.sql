ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_unique;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_event_unique
  ON users (lower(email), COALESCE(event_id, '__global__'));