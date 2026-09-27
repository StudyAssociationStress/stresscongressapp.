import { test, expect, APIRequestContext } from "@playwright/test";
import { Client } from "pg";
import bcrypt from "bcryptjs";
import {
  TEST_ADMIN_EMAIL,
  TEST_ATTENDEE_EMAIL,
  TEST_PASSWORD,
  TEST_OTHER_EVENT_ID,
} from "./global-setup";

async function withDatabase<T>(
  callback: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function login(
  request: APIRequestContext,
  email: string,
  password = TEST_PASSWORD,
): Promise<string> {
  const response = await request.post("/api/auth/login", {
    data: { email, password, deviceId: `security-audit-${Date.now()}` },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.token).toBeTruthy();
  return body.token as string;
}

function uniqueEmail(label: string) {
  return `security-audit-${label}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}@stress2026.test`;
}

async function createResetFixture(email: string, code: string) {
  await withDatabase(async (client) => {
    const event = await client.query<{ id: string }>(
      "SELECT id FROM events WHERE status = 'published' ORDER BY year DESC LIMIT 1",
    );
    expect(event.rows[0]).toBeTruthy();
    const user = await client.query<{ id: string }>(
      `INSERT INTO users
        (id, email, name, role, qr_code_value, checked_in, password_hash, event_id)
       VALUES (gen_random_uuid(), $1, 'Security Audit Fixture', 'attendee', $2, false, $3, $4)
       RETURNING id`,
      [
        email,
        `SC-SECURITY-${Date.now()}-${Math.random()}`,
        await bcrypt.hash(TEST_PASSWORD, 10),
        event.rows[0].id,
      ],
    );
    await client.query(
      `INSERT INTO password_reset_tokens
        (id, user_id, email, code, purpose, attempts, expires_at, used)
       VALUES (gen_random_uuid(), $1, $2, $3, 'reset', 0, NOW() + INTERVAL '10 minutes', false)`,
      [user.rows[0].id, email, await bcrypt.hash(code, 10)],
    );
  });
}

async function removeFixture(email: string) {
  await withDatabase(async (client) => {
    await client.query("DELETE FROM password_reset_tokens WHERE email = $1", [
      email,
    ]);
    await client.query("DELETE FROM users WHERE email = $1", [email]);
  });
}

test.describe("deep security regression coverage", () => {
  test("email-only sign-in identifies registered addresses before password entry", async ({
    request,
  }) => {
    const unknownEmail = uniqueEmail("unassigned");
    const [known, admin, unknown] = await Promise.all([
      request.post("/api/auth/login", { data: { email: TEST_ATTENDEE_EMAIL } }),
      request.post("/api/auth/login", { data: { email: TEST_ADMIN_EMAIL } }),
      request.post("/api/auth/login", { data: { email: unknownEmail } }),
    ]);

    expect(known.status()).toBe(200);
    expect(await known.json()).toMatchObject({
      needsPassword: true,
      needsSetup: false,
      accountType: "event",
    });
    expect(admin.status()).toBe(200);
    expect(await admin.json()).toEqual({
      needsPassword: true,
      needsSetup: false,
      accountType: "global",
      event: null,
    });
    expect(unknown.status()).toBe(404);
    expect(await unknown.json()).toEqual({
      code: "INVALID_EMAIL",
      message: "This email is not registered for an event.",
    });
  });

  test("admin user responses never expose password hashes, push tokens, or QR secrets", async ({
    request,
  }) => {
    const token = await login(request, TEST_ADMIN_EMAIL);
    const event = await request.get("/api/events/active");
    expect(event.status()).toBe(200);
    const eventId = (await event.json()).id as string;

    const response = await request.get(`/api/admin/users?eventId=${eventId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status()).toBe(200);
    const users = (await response.json()) as Record<string, unknown>[];
    const attendee = users.find((user) => user.email === TEST_ATTENDEE_EMAIL);
    expect(attendee).toBeTruthy();
    expect(attendee).not.toHaveProperty("passwordHash");
    expect(attendee).not.toHaveProperty("pushToken");
    expect(attendee).not.toHaveProperty("qrCodeValue");
    expect(attendee).not.toHaveProperty("passwordVersion");
  });

  test("logout revokes the current server-side session", async ({
    request,
  }) => {
    const token = await login(request, TEST_ATTENDEE_EMAIL);
    const logout = await request.post("/api/auth/logout", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(logout.status()).toBe(204);

    const replay = await request.get("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(replay.status()).toBe(401);
    expect((await replay.json()).code).toBe("SESSION_REVOKED");
  });

  test("a reset code can change a password only once under concurrent requests", async ({
    request,
  }) => {
    const email = uniqueEmail("reset-race");
    const code = "765432";
    await createResetFixture(email, code);
    try {
      const [first, second] = await Promise.all([
        request.post("/api/auth/reset-password", {
          data: { email, code, newPassword: "ConcurrentPass1!" },
        }),
        request.post("/api/auth/reset-password", {
          data: { email, code, newPassword: "ConcurrentPass2!" },
        }),
      ]);
      expect([first.status(), second.status()].sort()).toEqual([200, 400]);

      const firstLogin = await request.post("/api/auth/login", {
        data: { email, password: "ConcurrentPass1!" },
      });
      const secondLogin = await request.post("/api/auth/login", {
        data: { email, password: "ConcurrentPass2!" },
      });
      expect([firstLogin.status(), secondLogin.status()].sort()).toEqual([
        200, 401,
      ]);
    } finally {
      await removeFixture(email);
    }
  });

  test("admin notification and audit endpoints require an explicit event scope", async ({
    request,
  }) => {
    const token = await login(request, TEST_ADMIN_EMAIL);
    const headers = { Authorization: `Bearer ${token}` };

    const list = await request.get("/api/admin/notifications", { headers });
    expect(list.status()).toBe(400);

    const publish = await request.post("/api/admin/notifications", {
      headers,
      data: {
        title: "Unscoped notification",
        message: "This must never become global.",
      },
    });
    expect(publish.status()).toBe(400);

    const audit = await request.get("/api/admin/audit-log", { headers });
    expect(audit.status()).toBe(400);

    const scopedAudit = await request.get(
      `/api/admin/audit-log?eventId=${TEST_OTHER_EVENT_ID}`,
      { headers },
    );
    expect(scopedAudit.status()).toBe(200);
  });

  test("event updates reject hidden lifecycle fields", async ({ request }) => {
    const token = await login(request, TEST_ADMIN_EMAIL);
    const response = await request.put(
      `/api/admin/events/${TEST_OTHER_EVENT_ID}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: "E2E Other Event", status: "published" },
      },
    );
    expect(response.status()).toBe(400);
  });
});
