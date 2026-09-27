-- Reset and activation codes must belong to one concrete admin-created account.
-- Existing codes are intentionally invalidated because they cannot be safely
-- associated with a user when event-scoped accounts share an email address.
ALTER TABLE password_reset_tokens
  ADD COLUMN IF NOT EXISTS user_id VARCHAR;

DELETE FROM password_reset_tokens;

ALTER TABLE password_reset_tokens
  ALTER COLUMN user_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'password_reset_tokens_user_id_users_id_fk'
  ) THEN
    ALTER TABLE password_reset_tokens
      ADD CONSTRAINT password_reset_tokens_user_id_users_id_fk
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_purpose_idx
  ON password_reset_tokens (user_id, purpose);