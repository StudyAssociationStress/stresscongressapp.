ALTER TABLE users
  ADD COLUMN IF NOT EXISTS event_invitation_sent_at TIMESTAMP;