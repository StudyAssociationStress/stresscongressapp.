CREATE TABLE IF NOT EXISTS event_email_outbox (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('event_live', 'attendee_added')),
  recipient_email TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_year INTEGER NOT NULL,
  event_start_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'skipped', 'cancelled', 'needs_review')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMP NOT NULL DEFAULT now(),
  lease_until TIMESTAMP,
  claim_token TEXT,
  last_error TEXT,
  sent_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT event_email_outbox_once UNIQUE (event_id, user_id, kind)
);

CREATE INDEX IF NOT EXISTS event_email_outbox_ready
  ON event_email_outbox (next_attempt_at, id)
  WHERE status IN ('pending', 'processing');

CREATE TABLE IF NOT EXISTS event_email_send_gate (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  next_send_at TIMESTAMP NOT NULL DEFAULT now(),
  lease_until TIMESTAMP,
  lease_token TEXT,
  circuit_breaker_until TIMESTAMP
);
CREATE TABLE IF NOT EXISTS event_email_urgent_requests (
  token TEXT PRIMARY KEY,
  requested_at TIMESTAMP NOT NULL DEFAULT now(),
  lease_until TIMESTAMP NOT NULL
);
INSERT INTO event_email_send_gate (id, next_send_at)
VALUES (1, now())
ON CONFLICT (id) DO NOTHING;