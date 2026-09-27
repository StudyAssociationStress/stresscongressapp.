import { test, expect } from "@playwright/test";
import { Client } from "pg";
import {
  TEST_ADMIN_EMAIL,
  TEST_ATTENDEE_EMAIL,
  TEST_PASSWORD,
  TEST_OTHER_EVENT_ID,
} from "./global-setup";

async function withDatabase<T>(callback: (client: Client) => Promise<T>) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function loginAs(
  request: import("@playwright/test").APIRequestContext,
  email: string,
) {
  const response = await request.post("/api/auth/login", {
    data: { email, password: TEST_PASSWORD },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).token as string;
}

async function createAttendee(
  request: import("@playwright/test").APIRequestContext,
  adminToken: string,
  eventId: string,
  suffix: string,
  email = `gdpr-${suffix}@stress2026.test`,
) {
  const created = await request.post(`/api/admin/users?eventId=${eventId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: {
      name: `GDPR Test ${suffix}`,
      email,
      role: "attendee",
    },
  });
  expect(created.status()).toBe(201);
  const user = (await created.json()) as { id: string; email: string };
  const password = await request.put(
    `/api/admin/users/${user.id}?eventId=${eventId}`,
    {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { password: TEST_PASSWORD },
    },
  );
  expect(password.status()).toBe(200);
  return user;
}

async function findRequest(
  request: import("@playwright/test").APIRequestContext,
  adminToken: string,
  eventId: string,
  email: string,
  type: "data" | "deletion",
) {
  const response = await request.get("/api/admin/gdpr-requests", {
    headers: { Authorization: `Bearer ${adminToken}` },
    params: { eventId, status: "all" },
  });
  expect(response.status()).toBe(200);
  const item = (await response.json()).find(
    (candidate: { userEmail: string; type: string }) =>
      candidate.userEmail === email && candidate.type === type,
  );
  expect(item).toBeTruthy();
  return item as { id: string; status: string };
}

test.describe("GDPR request delivery and event scope", () => {
  test("public deletion validates input without revealing account existence", async ({
    request,
  }) => {
    const invalid = await request.post("/api/data-deletion", {
      data: { email: "not-an-email" },
    });
    expect(invalid.status()).toBe(400);

    const unknown = await request.post("/api/data-deletion", {
      data: { email: `unknown-${Date.now()}@example.com` },
    });
    expect(unknown.status()).toBe(202);
    const known = await request.post("/api/data-deletion", {
      data: { email: TEST_ATTENDEE_EMAIL, reason: "Privacy request" },
    });
    expect(known.status()).toBe(202);
    const knownBody = await known.json();
    expect(knownBody.message).toContain("If an account matches");
    const duplicate = await request.post("/api/gdpr/deletion-request", {
      data: { email: TEST_ATTENDEE_EMAIL },
    });
    expect(duplicate.status()).toBe(202);
    expect((await duplicate.json()).message).toBe(knownBody.message);
  });

  test("creates an event-scoped admin notification for a data request", async ({
    request,
  }) => {
    const attendeeToken = await loginAs(request, TEST_ATTENDEE_EMAIL);
    const submit = await request.post("/api/auth/request-data", {
      headers: { Authorization: `Bearer ${attendeeToken}` },
    });
    expect(submit.status()).toBe(200);

    const adminToken = await loginAs(request, TEST_ADMIN_EMAIL);
    const events = await (
      await request.get("/api/admin/events", {
        headers: { Authorization: `Bearer ${adminToken}` },
      })
    ).json();
    const testEvent = events.find(
      (event: { id: string; name: string }) =>
        event.id === "e2e-active-event" || event.name === "E2E Active Event",
    );
    expect(testEvent, "Expected the dedicated E2E event").toBeTruthy();
    const eventId = testEvent.id;
    const requests = await request.get("/api/admin/gdpr-requests", {
      headers: { Authorization: `Bearer ${adminToken}` },
      params: { eventId },
    });
    expect(requests.status()).toBe(200);
    const body = await requests.json();
    expect(
      body.some(
        (item: { userEmail: string; type: string; eventId: string }) =>
          item.userEmail === TEST_ATTENDEE_EMAIL &&
          item.type === "data" &&
          item.eventId,
      ),
    ).toBe(true);

    const notifications = await request.get("/api/admin/notifications", {
      headers: { Authorization: `Bearer ${adminToken}` },
      params: { eventId },
    });
    expect(notifications.status()).toBe(200);
    const notificationBody = await notifications.json();
    expect(
      notificationBody.some(
        (item: { title: string; targetRole: string; eventId: string }) =>
          item.title === "GDPR data request requires review" &&
          item.targetRole === "admin" &&
          item.eventId,
      ),
    ).toBe(true);

    const requestItem = body.find(
      (item: { userEmail: string; type: string }) =>
        item.userEmail === TEST_ATTENDEE_EMAIL && item.type === "data",
    );
    expect(requestItem).toBeTruthy();

    const approve = await request.post(
      `/api/admin/gdpr-requests/${requestItem.id}/approve?eventId=${eventId}`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    expect(approve.status()).toBe(200);

    const resolved = await request.get(
      `/api/admin/gdpr-requests?status=approved&eventId=${eventId}`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
      },
    );
    const resolvedItem = (await resolved.json()).find(
      (item: { id: string }) => item.id === requestItem.id,
    );
    expect(resolvedItem.deliveryStatus).toBe("delivered");
    expect(resolvedItem.deliveryAttempts).toBe(1);
  });

  test("protects approval and retry endpoints from non-admin users", async ({
    request,
  }) => {
    const attendeeToken = await loginAs(request, TEST_ATTENDEE_EMAIL);
    const adminList = await request.get("/api/admin/gdpr-requests", {
      headers: { Authorization: `Bearer ${attendeeToken}` },
    });
    expect(adminList.status()).toBe(403);

    const retry = await request.post(
      "/api/admin/gdpr-requests/not-a-request/retry",
      { headers: { Authorization: `Bearer ${attendeeToken}` } },
    );
    expect(retry.status()).toBe(403);
  });

  test("denies requests and rejects duplicate or wrong-event actions", async ({
    request,
  }) => {
    const adminToken = await loginAs(request, TEST_ADMIN_EMAIL);
    const events = await (
      await request.get("/api/admin/events", {
        headers: { Authorization: `Bearer ${adminToken}` },
      })
    ).json();
    const activeEvent = events.find(
      (event: { id: string }) => event.id === "e2e-active-event",
    );
    expect(activeEvent).toBeTruthy();
    const user = await createAttendee(
      request,
      adminToken,
      activeEvent.id,
      `${Date.now()}-deny`,
    );
    const attendeeToken = await loginAs(request, user.email);
    const submitted = await request.post("/api/auth/request-data", {
      headers: { Authorization: `Bearer ${attendeeToken}` },
    });
    expect(submitted.status()).toBe(200);

    const item = await findRequest(
      request,
      adminToken,
      activeEvent.id,
      user.email,
      "data",
    );
    const wrongEvent = await request.post(
      `/api/admin/gdpr-requests/${item.id}/deny?eventId=${TEST_OTHER_EVENT_ID}`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    expect(wrongEvent.status()).toBe(404);

    const denied = await request.post(
      `/api/admin/gdpr-requests/${item.id}/deny?eventId=${activeEvent.id}`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    expect(denied.status()).toBe(200);

    const duplicate = await request.post(
      `/api/admin/gdpr-requests/${item.id}/deny?eventId=${activeEvent.id}`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    expect(duplicate.status()).toBe(409);
  });

  test("deletes an approved account even when the processing email is unavailable", async ({
    request,
  }) => {
    const adminToken = await loginAs(request, TEST_ADMIN_EMAIL);
    const user = await createAttendee(
      request,
      adminToken,
      "e2e-active-event",
      `${Date.now()}-delete`,
    );
    const attendeeToken = await loginAs(request, user.email);
    const submitted = await request.post("/api/auth/request-deletion", {
      headers: { Authorization: `Bearer ${attendeeToken}` },
    });
    expect(submitted.status()).toBe(200);

    const item = await findRequest(
      request,
      adminToken,
      "e2e-active-event",
      user.email,
      "deletion",
    );
    const approved = await request.post(
      `/api/admin/gdpr-requests/${item.id}/approve?eventId=e2e-active-event`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    expect(approved.status()).toBe(200);

    const users = await request.get(
      `/api/admin/users?eventId=e2e-active-event`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    expect(users.status()).toBe(200);
    expect(
      (await users.json()).some(
        (candidate: { email: string }) => candidate.email === user.email,
      ),
    ).toBe(false);
  });

  test("releases an in-progress claim back to pending", async ({ request }) => {
    const adminToken = await loginAs(request, TEST_ADMIN_EMAIL);
    const user = await createAttendee(
      request,
      adminToken,
      "e2e-active-event",
      `${Date.now()}-release`,
    );
    const attendeeToken = await loginAs(request, user.email);
    const submitted = await request.post("/api/auth/request-data", {
      headers: { Authorization: `Bearer ${attendeeToken}` },
    });
    expect(submitted.status()).toBe(200);

    const item = await findRequest(
      request,
      adminToken,
      "e2e-active-event",
      user.email,
      "data",
    );
    await withDatabase(async (client) => {
      await client.query(
        `UPDATE gdpr_requests
         SET status = 'in_progress', claim_token = 'gdpr-test-claim'
         WHERE id = $1`,
        [item.id],
      );
    });

    const released = await request.post(
      `/api/admin/gdpr-requests/${item.id}/release?eventId=e2e-active-event`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    expect(released.status()).toBe(200);

    const pending = await findRequest(
      request,
      adminToken,
      "e2e-active-event",
      user.email,
      "data",
    );
    expect(pending.status).toBe("pending");
  });

  test("isolates login history for same-email accounts in different events", async ({
    request,
  }) => {
    const adminToken = await loginAs(request, TEST_ADMIN_EMAIL);
    const activeEventResponse = await request.get("/api/events/active");
    expect(activeEventResponse.status()).toBe(200);
    const activeEvent = (await activeEventResponse.json()) as { id: string };
    const sharedEmail = `gdpr-${Date.now()}-shared@stress2026.test`;

    const activeUser = await createAttendee(
      request,
      adminToken,
      activeEvent.id,
      "shared-active",
      sharedEmail,
    );
    const otherUser = await createAttendee(
      request,
      adminToken,
      TEST_OTHER_EVENT_ID,
      "shared-other",
      sharedEmail,
    );

    await withDatabase(async (client) => {
      await client.query(
        `INSERT INTO login_events (email, event_type, event_id)
         VALUES
           ($1, 'active_event_login', $2),
           ($1, 'other_event_login', $3)`,
        [sharedEmail, activeEvent.id, TEST_OTHER_EVENT_ID],
      );
    });

    const activeExport = await request.get(
      `/api/admin/users/${activeUser.id}/export?eventId=${activeEvent.id}`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    expect(activeExport.status()).toBe(200);
    const activeLoginTypes = (
      (await activeExport.json()) as {
        loginHistory: { eventType: string }[];
      }
    ).loginHistory.map((entry) => entry.eventType);
    expect(activeLoginTypes).toContain("active_event_login");
    expect(activeLoginTypes).not.toContain("other_event_login");

    const otherExport = await request.get(
      `/api/admin/users/${otherUser.id}/export?eventId=${TEST_OTHER_EVENT_ID}`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    expect(otherExport.status()).toBe(200);
    const otherLoginTypes = (
      (await otherExport.json()) as {
        loginHistory: { eventType: string }[];
      }
    ).loginHistory.map((entry) => entry.eventType);
    expect(otherLoginTypes).toContain("other_event_login");
    expect(otherLoginTypes).not.toContain("active_event_login");
  });
});
