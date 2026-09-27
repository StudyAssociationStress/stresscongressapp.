WITH ranked_assignments AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id, case_study_id
      ORDER BY assigned_at ASC, id ASC
    ) AS duplicate_number
  FROM user_case_studies
)
DELETE FROM user_case_studies
WHERE id IN (
  SELECT id
  FROM ranked_assignments
  WHERE duplicate_number > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS user_case_studies_user_case_unique
  ON user_case_studies (user_id, case_study_id);