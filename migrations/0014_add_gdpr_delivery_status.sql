-- Track data-export delivery independently from the administrator's approval.
-- A failed delivery remains retryable without creating a second request.
ALTER TABLE gdpr_requests
  ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'not_started';
ALTER TABLE gdpr_requests
  ADD COLUMN IF NOT EXISTS delivery_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gdpr_requests
  ADD COLUMN IF NOT EXISTS delivery_error TEXT;