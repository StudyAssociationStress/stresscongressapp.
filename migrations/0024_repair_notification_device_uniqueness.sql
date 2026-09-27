-- The original notification-device migration may already be recorded in the
-- migration ledger on databases that were created before its unique index was
-- added. Recreate the index independently so the device upserts have a
-- matching conflict target.
--
-- This is intentionally additive: IF NOT EXISTS makes it safe to run more
-- than once, and creating an index does not remove existing device records.
CREATE UNIQUE INDEX IF NOT EXISTS notification_devices_user_device_unique
  ON notification_devices (user_id, device_id);