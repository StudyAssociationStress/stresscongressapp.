/**
 * Global test setup — seeds three deterministic test accounts into the
 * development database so the API tests can run without touching production
 * data or requiring an admin session.
 *
 * Users created here are identified by the @stress2026.test domain and are
 * removed in global-teardown.ts after every test run.
 */
import { Client } from "pg";
import bcrypt from "bcryptjs";

export const TEST_ADMIN_EMAIL = "test-e2e-admin@stress2026.test";
export const TEST_EVENT_ADMIN_EMAIL = "test-e2e-event-admin@stress2026.test";
export const TEST_STAFF_EMAIL = "test-e2e-staff@stress2026.test";
export const TEST_ATTENDEE_EMAIL = "test-e2e-attendee@stress2026.test";
export const TEST_ATTENDEE_QR = "SC2026-E2E-TESTATTENDEE001";
export const TEST_OTHER_EVENT_ID = "e2e-isolation-event";
export const TEST_OTHER_ATTENDEE_EMAIL = "test-e2e-other-event@stress2026.test";
export const TEST_OTHER_ATTENDEE_QR = "SC2026-E2E-OTHEREVENT001";
export const TEST_PASSWORD = "TestPass1!";

async function upsertUser(
  client: Client,
  opts: {
    email: string;
    name: string;
    role: string;
    qrCodeValue: string;
    passwordHash: string;
    eventId?: string | null;
  },
) {
  const existing = await client.query<{ id: string }>(
    `
    SELECT id
    FROM users
    WHERE lower(email) = lower($1)
      AND (
        event_id = $2
        OR (event_id IS NULL AND $2::text IS NULL)
      )
    LIMIT 1
    `,
    [opts.email, opts.eventId ?? null],
  );

  if (existing.rows[0]) {
    await client.query(
      `
      UPDATE users
      SET name = $2,
          role = $3,
          qr_code_value = $4,
          password_hash = $5,
          checked_in = false,
          event_id = $6
      WHERE id = $1
      `,
      [
        existing.rows[0].id,
        opts.name,
        opts.role,
        opts.qrCodeValue,
        opts.passwordHash,
        opts.eventId ?? null,
      ],
    );
    return;
  }

  await client.query(
    `
    INSERT INTO users (id, email, name, role, qr_code_value, checked_in, password_hash, event_id)
    VALUES (gen_random_uuid(), $1, $2, $3, $4, false, $5, $6)
    `,
    [
      opts.email,
      opts.name,
      opts.role,
      opts.qrCodeValue,
      opts.passwordHash,
      opts.eventId ?? null,
    ],
  );
}

export default async function globalSetup() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const hash = await bcrypt.hash(TEST_PASSWORD, 10);
  // Keep all deterministic test users on the dedicated published event.
  // Selecting an arbitrary published event can bind them to stale or
  // production-like data left by another test run.
  await client.query(
    `UPDATE events
     SET status = 'archived'
     WHERE status = 'published' AND id <> 'e2e-active-event'`,
  );
  const activeEventResult = await client.query<{ id: string }>(
    `INSERT INTO events (id, name, year, status, last_published_at)
     VALUES ('e2e-active-event', 'E2E Active Event', 2099, 'published', NOW())
     ON CONFLICT (id) DO UPDATE
     SET name = EXCLUDED.name,
         year = EXCLUDED.year,
         status = EXCLUDED.status,
         last_published_at = NOW()
     RETURNING id`,
  );
  const activeEventId = activeEventResult.rows[0].id;
  await client.query(
    `INSERT INTO events (id, name, year, status)
     VALUES ($1, 'E2E Other Event', 2100, 'draft')
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, year = EXCLUDED.year, status = EXCLUDED.status`,
    [TEST_OTHER_EVENT_ID],
  );

  await upsertUser(client, {
    email: TEST_ADMIN_EMAIL,
    name: "E2E Test Admin",
    role: "admin",
    qrCodeValue: "SC2026-E2E-ADMIN001",
    passwordHash: hash,
  });

  await upsertUser(client, {
    email: TEST_EVENT_ADMIN_EMAIL,
    name: "E2E Event Admin",
    role: "admin",
    qrCodeValue: "SC2026-E2E-EVENTADMIN001",
    passwordHash: hash,
    eventId: activeEventId,
  });

  await upsertUser(client, {
    email: TEST_STAFF_EMAIL,
    name: "E2E Test Staff",
    role: "staff",
    qrCodeValue: "SC2026-E2E-STAFF001",
    passwordHash: hash,
    eventId: activeEventId,
  });

  await upsertUser(client, {
    email: TEST_ATTENDEE_EMAIL,
    name: "E2E Test Attendee",
    role: "attendee",
    qrCodeValue: TEST_ATTENDEE_QR,
    passwordHash: hash,
    eventId: activeEventId,
  });

  await upsertUser(client, {
    email: TEST_OTHER_ATTENDEE_EMAIL,
    name: "E2E Other Event Attendee",
    role: "attendee",
    qrCodeValue: TEST_OTHER_ATTENDEE_QR,
    passwordHash: hash,
    eventId: TEST_OTHER_EVENT_ID,
  });

  await client.query(
    `DELETE FROM login_events WHERE email LIKE '%@stress2026.test'`,
  );
  await client.query(
    `INSERT INTO login_events (email, event_type, event_id)
     VALUES ($1, 'login_success', $2)`,
    [TEST_OTHER_ATTENDEE_EMAIL, TEST_OTHER_EVENT_ID],
  );
  await client.query(
    `INSERT INTO gdpr_requests
      (id, user_id, event_id, user_email, user_name, type, status)
     SELECT gen_random_uuid(), id, event_id, email, name, 'data', 'pending'
     FROM users
     WHERE email = $1
       AND NOT EXISTS (
         SELECT 1 FROM gdpr_requests
         WHERE user_id = users.id AND type = 'data'
       )`,
    [TEST_OTHER_ATTENDEE_EMAIL],
  );
  await client.query(
    `INSERT INTO admin_audit_log
      (admin_id, admin_email, action, target_type, metadata)
     VALUES (gen_random_uuid(), $1, 'e2e_other_event_report', 'user',
             $2)`,
    [TEST_ADMIN_EMAIL, JSON.stringify({ eventId: TEST_OTHER_EVENT_ID })],
  );

  await client.end();
  console.log("[e2e setup] Test users seeded.");
}
