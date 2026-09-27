-- Concurrent devices can race while creating read/dismiss receipts. Keep the
-- oldest receipt and enforce one row per user/notification pair before the
-- application uses atomic upserts.
DELETE FROM user_notifications duplicate
USING user_notifications original
WHERE duplicate.user_id = original.user_id
  AND duplicate.notification_id = original.notification_id
  AND (
    duplicate.created_at > original.created_at
    OR (
      duplicate.created_at = original.created_at
      AND duplicate.id > original.id
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS user_notifications_user_notification_unique
  ON user_notifications (user_id, notification_id);