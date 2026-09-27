CREATE TABLE IF NOT EXISTS notification_devices (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  user_id varchar NOT NULL REFERENCES users(id),
  device_id text NOT NULL,
  push_token text,
  push_enabled boolean NOT NULL DEFAULT true,
  event_reminders boolean NOT NULL DEFAULT true,
  session_alerts boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_devices_user_device_unique
  ON notification_devices (user_id, device_id);

ALTER TABLE gdpr_requests ADD COLUMN IF NOT EXISTS reason text;