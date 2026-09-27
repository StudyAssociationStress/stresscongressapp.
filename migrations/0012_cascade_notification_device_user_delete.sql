ALTER TABLE notification_devices
  DROP CONSTRAINT IF EXISTS notification_devices_user_id_fkey;

ALTER TABLE notification_devices
  ADD CONSTRAINT notification_devices_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;