WITH normalized AS (
  SELECT
    id,
    regexp_replace(lower(trim(email)), '\.+$', '') AS email,
    event_id
  FROM users
)
UPDATE users AS u
SET email = n.email
FROM normalized AS n
WHERE u.id = n.id
  AND u.email <> n.email
  AND NOT EXISTS (
    SELECT 1
    FROM users AS c
    WHERE c.id <> u.id
      AND c.email = n.email
      AND coalesce(c.event_id, '__global__') =
          coalesce(u.event_id, '__global__')
  );