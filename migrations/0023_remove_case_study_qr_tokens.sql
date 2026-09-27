-- Case-study selection now comes from the staff workflow, while attendee
-- identity always comes from users.qr_code_value. Preserve assignments and
-- check-in history, but remove obsolete per-case-study QR tokens.
ALTER TABLE user_case_studies
  DROP COLUMN IF EXISTS qr_code_value;

ALTER TABLE case_studies
  DROP COLUMN IF EXISTS qr_code_value;