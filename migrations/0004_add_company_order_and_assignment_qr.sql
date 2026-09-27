ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

ALTER TABLE user_case_studies
  ADD COLUMN IF NOT EXISTS qr_code_value TEXT;

UPDATE user_case_studies
  SET qr_code_value = 'SC-UCS-' || gen_random_uuid()
  WHERE qr_code_value IS NULL;

ALTER TABLE user_case_studies
  ALTER COLUMN qr_code_value SET DEFAULT ('SC-UCS-' || gen_random_uuid()),
  ALTER COLUMN qr_code_value SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_case_studies_qr_code_value_unique
  ON user_case_studies (qr_code_value);