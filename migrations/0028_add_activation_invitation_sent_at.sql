ALTER TABLE users
  ADD COLUMN IF NOT EXISTS activation_invitation_sent_at TIMESTAMP;