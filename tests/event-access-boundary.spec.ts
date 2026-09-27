import { test, expect, APIRequestContext } from "@playwright/test";
import { Client } from "pg";
import bcrypt from "bcryptjs";
import {
  TEST_ADMIN_EMAIL,
  TEST_ATTENDEE_EMAIL,
  TEST_OTHER_EVENT_ID,
  TEST_PASSWORD,
} from "./global-setup";
import { WEB_PREVIEW_URL } from "./web-preview";

type EventFixture = {
  eventId: string;
  email: string;
};

type EventRecord = {
  id: string;
  name: string;
  year: number;
  status: string;
  showYearOnLogin: boolean;
};

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

async function createArchivedAttendee(label: string): Promise<EventFixture> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const eventId = `e2e-archived-${suffix}`;
  const email = `archived-attendee-${label}-${suffix}@stress2026.test`;
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);

  await withDatabase(async (client) => {
    await client.query(
      `INSERT INTO events
         (id, name, year, status, location, last_published_at)
       VALUES ($1, $2, $3, 'archived', 'Archived venue', NOW())`,
      [eventId, `Archived Event ${label}`, 2001],
    );
    await client.query(
      `INSERT INTO users
        (id, email, name, role, qr_code_value, checked_in, password_hash, event_id)
       VALUES (gen_random_uuid(), $1, $2, 'attendee', $3, false, $4, $5)`,
      [
        email,
        "Archived Event Attendee",
        `SC-ARCHIVED-${suffix}`,
        passwordHash,
        eventId,
      ],
    );
  });

  return { eventId, email };
}

async function removeFixture(fixture: EventFixture): Promise<void> {
  await withDatabase(async (client) => {
    await client.query("DELETE FROM users WHERE email = $1", [fixture.email]);
    await client.query("DELETE FROM events WHERE id = $1", [fixture.eventId]);
  });
}

async function login(
  request: APIRequestContext,
  email: string,
  password = TEST_PASSWORD,
): Promise<string> {
  const response = await request.post("/api/auth/login", {
    data: { email, password },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).token as string;
}

test.describe("event access boundaries", () => {
  test("keeps login year visibility scoped to each event and the home heading name-only", async ({
    request,
    page,
  }) => {
    test.setTimeout(90_000);
    const adminToken = await login(request, TEST_ADMIN_EMAIL);
    const headers = { Authorization: `Bearer ${adminToken}` };
    const eventsResponse = await request.get("/api/admin/events", { headers });
    expect(eventsResponse.status()).toBe(200);
    const events = (await eventsResponse.json()) as EventRecord[];
    const activeEvent = events.find((event) => event.status === "published");
    const otherEvent = events.find((event) => event.id === TEST_OTHER_EVENT_ID);
    expect(activeEvent).toBeTruthy();
    expect(otherEvent).toBeTruthy();
    expect(activeEvent).toMatchObject({ showYearOnLogin: true });
    expect(otherEvent).toMatchObject({ showYearOnLogin: true });

    const updateEvent = async (eventId: string, showYearOnLogin: boolean) => {
      const response = await request.put(`/api/admin/events/${eventId}`, {
        headers,
        data: { showYearOnLogin },
      });
      expect(response.status()).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        id: eventId,
        showYearOnLogin,
      });
    };

    const readEventsById = async () => {
      const response = await request.get("/api/admin/events", { headers });
      expect(response.status()).toBe(200);
      return new Map(
        ((await response.json()) as EventRecord[]).map((event) => [
          event.id,
          event,
        ]),
      );
    };

    try {
      await page.goto(WEB_PREVIEW_URL);
      await expect(page.getByTestId("login-event-name")).toHaveText(
        activeEvent!.name,
      );
      await expect(page.getByTestId("login-event-year")).toHaveText(
        String(activeEvent!.year),
      );

      await updateEvent(activeEvent!.id, false);

      let eventsById = await readEventsById();
      expect(eventsById.get(activeEvent!.id)).toMatchObject({
        showYearOnLogin: false,
      });
      expect(eventsById.get(otherEvent!.id)).toMatchObject({
        showYearOnLogin: true,
      });

      await page.reload();
      await expect(page.getByTestId("login-event-year")).toHaveCount(0);

      const attendeeToken = await login(request, TEST_ATTENDEE_EMAIL);
      await page.evaluate((token) => {
        window.localStorage.setItem("auth_token", token);
      }, attendeeToken);
      await page.reload();
      await expect(page.getByTestId("attendee-event-name")).toHaveText(
        activeEvent!.name,
      );

      await page.evaluate(() => {
        window.localStorage.removeItem("auth_token");
      });
      await page.reload();
      await expect(page.getByTestId("login-event-year")).toHaveCount(0);

      await updateEvent(activeEvent!.id, true);
      eventsById = await readEventsById();
      expect(eventsById.get(activeEvent!.id)).toMatchObject({
        showYearOnLogin: true,
      });
      expect(eventsById.get(otherEvent!.id)).toMatchObject({
        showYearOnLogin: true,
      });

      await page.reload();
      await expect(page.getByTestId("login-event-year")).toHaveText(
        String(activeEvent!.year),
      );

      await page.evaluate((token) => {
        window.localStorage.setItem("auth_token", token);
      }, attendeeToken);
      await page.reload();
      await expect(page.getByTestId("attendee-event-name")).toHaveText(
        activeEvent!.name,
      );
    } finally {
      await updateEvent(activeEvent!.id, true);
    }
  });

  test("keeps an archived attendee on their own event, not the live event", async ({
    request,
  }) => {
    const fixture = await createArchivedAttendee("scope");
    try {
      const emailStep = await request.post("/api/auth/login", {
        data: { email: fixture.email },
      });
      expect(emailStep.status()).toBe(200);
      expect(await emailStep.json()).toMatchObject({
        needsPassword: true,
        needsSetup: false,
        accountType: "event",
        event: { id: fixture.eventId, status: "archived" },
      });

      const token = await login(request, fixture.email);
      const headers = { Authorization: `Bearer ${token}` };

      const theme = await request.get("/api/events/active", { headers });
      expect(theme.status()).toBe(200);
      expect((await theme.json()).id).toBe(fixture.eventId);

      const sessions = await request.get("/api/sessions", { headers });
      expect(sessions.status()).toBe(200);
      expect(await sessions.json()).toEqual([]);
    } finally {
      await removeFixture(fixture);
    }
  });

  test("rejects an archived attendee after the event is deleted", async ({
    request,
  }) => {
    const fixture = await createArchivedAttendee("delete");
    try {
      const attendeeToken = await login(request, fixture.email);
      const adminToken = await login(request, TEST_ADMIN_EMAIL);

      const deleted = await request.delete(
        `/api/admin/events/${fixture.eventId}`,
        {
          headers: { Authorization: `Bearer ${adminToken}` },
        },
      );
      expect(deleted.status()).toBe(200);

      const oldSession = await request.get("/api/auth/me", {
        headers: { Authorization: `Bearer ${attendeeToken}` },
      });
      expect(oldSession.status()).toBe(401);

      const oldLogin = await request.post("/api/auth/login", {
        data: { email: fixture.email, password: TEST_PASSWORD },
      });
      expect(oldLogin.status()).toBe(401);

      const activation = await request.post("/api/auth/request-activation", {
        data: { email: fixture.email },
      });
      expect(activation.status()).toBe(404);
      expect(await activation.json()).toEqual({
        code: "INVALID_EMAIL",
        message: "This email is not registered for an event.",
      });

      const tokenCount = await withDatabase(async (client) => {
        const result = await client.query<{ count: string }>(
          "SELECT COUNT(*)::text AS count FROM password_reset_tokens WHERE email = $1",
          [fixture.email],
        );
        return result.rows[0].count;
      });
      expect(tokenCount).toBe("0");
    } finally {
      await removeFixture(fixture);
    }
  });
});
