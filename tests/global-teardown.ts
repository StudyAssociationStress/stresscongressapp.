import { Client } from "pg";

export default async function globalTeardown() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  await client.query(`
    DELETE FROM gdpr_requests
    WHERE user_id IN (
      SELECT id FROM users WHERE email LIKE '%@stress2026.test'
    )
  `);
  await client.query(`
    DELETE FROM user_notifications
    WHERE user_id IN (
      SELECT id FROM users WHERE email LIKE '%@stress2026.test'
    )
  `);
  await client.query(`
    DELETE FROM user_case_studies
    WHERE user_id IN (
      SELECT id FROM users WHERE email LIKE '%@stress2026.test'
    )
  `);
  await client.query(
    `DELETE FROM login_events WHERE email LIKE '%@stress2026.test'`,
  );
  await client.query(
    `DELETE FROM admin_audit_log WHERE metadata LIKE '%e2e-isolation-event%'`,
  );
  await client.query(`DELETE FROM users WHERE email LIKE '%@stress2026.test'`);
  await client.query(`DELETE FROM events WHERE id = 'e2e-isolation-event'`);
  await client.query(`
    UPDATE events
    SET status = 'archived'
    WHERE id = 'e2e-active-event' AND name = 'E2E Active Event'
  `);

  await client.end();
  console.log("[e2e teardown] Test users removed.");
}
