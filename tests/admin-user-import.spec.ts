import { test, expect } from "@playwright/test";
import { Client } from "pg";
import {
  TEST_ADMIN_EMAIL,
  TEST_OTHER_EVENT_ID,
  TEST_PASSWORD,
} from "./global-setup";

async function loginAsAdmin(
  request: import("@playwright/test").APIRequestContext,
): Promise<string> {
  const response = await request.post("/api/auth/login", {
    data: { email: TEST_ADMIN_EMAIL, password: TEST_PASSWORD },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.token).toBeTruthy();
  return body.token as string;
}

async function markEventPreviouslyLive(eventId: string, hasBeenLive: boolean) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `UPDATE events
       SET last_published_at = $2
       WHERE id = $1`,
      [eventId, hasBeenLive ? new Date() : null],
    );
  } finally {
    await client.end();
  }
}

test.describe("event-scoped admin user creation and import", () => {
  test("explains same-year role conflicts and saves a one-letter tagline", async ({
    request,
  }) => {
    const token = await loginAsAdmin(request);
    const headers = { Authorization: `Bearer ${token}` };
    const suffix = Date.now().toString(36);
    const email = `same-year-role-${suffix}@stress2026.test`;
    let createdUser: { id: string; eventId: string } | undefined;
    let createdEvent: { id: string } | undefined;

    try {
      const eventResponse = await request.post("/api/admin/events", {
        headers,
        data: {
          name: `Validation Test Event ${suffix}`,
          year: 2400,
        },
      });
      expect(eventResponse.status()).toBe(200);
      const event = (await eventResponse.json()) as { id: string };
      createdEvent = event;

      const staffResponse = await request.post("/api/admin/users", {
        headers,
        data: {
          name: "Same Year Staff",
          email,
          role: "staff",
          eventId: event.id,
        },
      });
      expect(staffResponse.status()).toBe(201);
      createdUser = await staffResponse.json();

      const attendeeResponse = await request.post("/api/admin/users", {
        headers,
        data: {
          name: "Same Year Attendee",
          email,
          role: "attendee",
          eventId: event.id,
        },
      });
      expect(attendeeResponse.status()).toBe(409);
      expect(await attendeeResponse.json()).toMatchObject({
        message: expect.stringContaining(
          "already registered as a staff for Validation Test Event",
        ),
      });

      const appearanceResponse = await request.put(
        `/api/admin/events/${event.id}`,
        {
          headers,
          data: {
            // Inline image data can be longer than the old 5,000-character
            // validation limit while still being a valid uploaded image.
            logoUrl: `data:image/jpeg;base64,${"a".repeat(6_000)}`,
            tagline: "X",
          },
        },
      );
      expect(appearanceResponse.status()).toBe(200);
      expect((await appearanceResponse.json()).tagline).toBe("X");
    } finally {
      if (createdUser) {
        await request.delete(
          `/api/admin/users/${createdUser.id}?eventId=${createdUser.eventId}`,
          { headers },
        );
      }
      if (createdEvent) {
        await request.delete(`/api/admin/events/${createdEvent.id}`, {
          headers,
        });
      }
    }
  });

  test("single attendee creation uses the selected event without exposing QR values", async ({
    request,
  }) => {
    const token = await loginAsAdmin(request);
    const headers = { Authorization: `Bearer ${token}` };
    const suffix = Date.now().toString(36);
    const firstEmail = `same-name-a-${suffix}@stress2026.test`;
    const secondEmail = `same-name-b-${suffix}@stress2026.test`;

    const firstResponse = await request.post("/api/admin/users", {
      headers,
      data: {
        name: "Same Name Attendee",
        email: firstEmail,
        role: "attendee",
        eventId: TEST_OTHER_EVENT_ID,
      },
    });
    expect(firstResponse.status()).toBe(201);
    const first = await firstResponse.json();

    const secondResponse = await request.post("/api/admin/users", {
      headers,
      data: {
        name: "Same Name Attendee",
        email: secondEmail,
        role: "attendee",
        eventId: TEST_OTHER_EVENT_ID,
      },
    });
    expect(secondResponse.status()).toBe(201);
    const second = await secondResponse.json();

    expect(first.eventId).toBe(TEST_OTHER_EVENT_ID);
    expect(second.eventId).toBe(TEST_OTHER_EVENT_ID);
    expect(first.qrCodeValue).toBeUndefined();
    expect(second.qrCodeValue).toBeUndefined();
    expect(first.eventInvitationSent).toBe(false);
    expect(second.eventInvitationSent).toBe(false);
    expect(first.eventInvitationDeferred).toBe(true);
    expect(second.eventInvitationDeferred).toBe(true);

    const eventUsersResponse = await request.get(
      `/api/admin/users?eventId=${TEST_OTHER_EVENT_ID}`,
      { headers },
    );
    expect(eventUsersResponse.status()).toBe(200);
    const eventUsers = await eventUsersResponse.json();
    expect(
      eventUsers.some((user: { email: string }) => user.email === firstEmail),
    ).toBe(true);
    expect(
      eventUsers.some((user: { email: string }) => user.email === secondEmail),
    ).toBe(true);

    const firstLogin = await request.post("/api/auth/login", {
      data: { email: firstEmail },
    });
    // New attendees cannot sign in while their event is still under construction.
    expect(firstLogin.status()).toBe(403);
    expect(await firstLogin.json()).toMatchObject({
      code: "EVENT_NOT_LIVE",
      message:
        "This event is still under construction. Sign-in will be available after it has been live.",
    });
    const activation = await request.post("/api/auth/request-activation", {
      data: { email: firstEmail, eventId: TEST_OTHER_EVENT_ID },
    });
    expect(activation.status()).toBe(403);
    expect(await activation.json()).toMatchObject({ code: "EVENT_NOT_LIVE" });

    const passwordResponse = await request.put(
      `/api/admin/users/${first.id}?eventId=${TEST_OTHER_EVENT_ID}`,
      { headers, data: { password: TEST_PASSWORD } },
    );
    expect(passwordResponse.status()).toBe(200);
    const passwordLogin = await request.post("/api/auth/login", {
      data: {
        email: firstEmail,
        password: TEST_PASSWORD,
        eventId: TEST_OTHER_EVENT_ID,
      },
    });
    expect(passwordLogin.status()).toBe(403);
    expect((await passwordLogin.json()).code).toBe("EVENT_NOT_LIVE");
  });

  test("turns simultaneous duplicate invitations into one creation and conflicts", async ({
    request,
  }) => {
    const token = await loginAsAdmin(request);
    const headers = { Authorization: `Bearer ${token}` };
    const suffix = Date.now().toString(36);
    const email = `concurrent-invitation-${suffix}@stress2026.test`;
    let createdUser: { id: string; eventId: string } | undefined;

    try {
      const responses = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          request.post("/api/admin/users", {
            headers,
            data: {
              name: `Concurrent Invite ${index}`,
              email,
              role: "staff",
              eventId: TEST_OTHER_EVENT_ID,
            },
          }),
        ),
      );

      const statuses = responses.map((response) => response.status());
      expect(statuses.filter((status) => status === 201)).toHaveLength(1);
      expect(statuses.filter((status) => status === 409)).toHaveLength(7);

      for (const response of responses) {
        if (response.status() === 201) {
          createdUser = await response.json();
        } else {
          await expect(response.json()).resolves.toMatchObject({
            message: expect.stringContaining(
              "email is already registered as a staff",
            ),
          });
        }
      }

      const usersResponse = await request.get(
        `/api/admin/users?eventId=${TEST_OTHER_EVENT_ID}`,
        { headers },
      );
      expect(usersResponse.status()).toBe(200);
      const users = await usersResponse.json();
      expect(
        users.filter((user: { email: string }) => user.email === email),
      ).toHaveLength(1);
    } finally {
      if (createdUser) {
        await request.delete(
          `/api/admin/users/${createdUser.id}?eventId=${createdUser.eventId}`,
          { headers },
        );
      }
    }
  });

  test("bulk import reports every row and applies event-year overrides safely", async ({
    request,
  }) => {
    const token = await loginAsAdmin(request);
    const headers = { Authorization: `Bearer ${token}` };
    const eventsResponse = await request.get("/api/admin/events", { headers });
    expect(eventsResponse.status()).toBe(200);
    const events = await eventsResponse.json();
    const selectedEvent = events.find(
      (event: { status: string; id: string }) =>
        event.status === "published" && event.id !== TEST_OTHER_EVENT_ID,
    );
    expect(
      selectedEvent,
      "Expected a published event for the default import target",
    ).toBeTruthy();

    const suffix = Date.now().toString(36);
    const overrideEmail = `override-${suffix}@stress2026.test`;
    const defaultEmail = `default-${suffix}@stress2026.test`;
    const response = await request.post("/api/admin/users/import", {
      headers,
      data: {
        eventId: selectedEvent.id,
        rows: [
          {
            name: "Override Event User",
            email: overrideEmail,
            role: "attendee",
            event_year: "2100",
          },
          { name: "Default Event User", email: defaultEmail, role: "attendee" },
          {
            name: "Duplicate In File",
            email: defaultEmail.toUpperCase(),
            role: "attendee",
          },
          { name: "Bad Email", email: "not-an-email", role: "attendee" },
          {
            name: "Bad Year",
            email: `bad-year-${suffix}@stress2026.test`,
            role: "attendee",
            event_year: "9999",
          },
          {
            name: "Bad Role",
            email: `bad-role-${suffix}@stress2026.test`,
            role: "speaker",
          },
        ],
      },
    });

    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ created: 1, skipped: 1, failed: 4 });
    expect(result.results).toHaveLength(6);
    expect(result.results.map((row: { status: string }) => row.status)).toEqual(
      ["error", "created", "skipped", "error", "error", "error"],
    );
    expect(result.results[0]).toMatchObject({
      email: overrideEmail,
      eventId: selectedEvent.id,
      eventYear: selectedEvent.year,
    });
    expect(result.results[0].message).toContain(
      "does not match the selected event",
    );
    expect(result.results[1]).toMatchObject({
      email: defaultEmail,
      eventId: selectedEvent.id,
      eventYear: selectedEvent.year,
    });
    expect(result.results[2].message).toContain("Duplicate email");
    expect(result.results[4].message).toContain(
      "No event exists for year 9999",
    );
    expect(result.results[5].message).toContain(
      "Role must be attendee, staff, or admin",
    );

    const overrideEventUsersResponse = await request.get(
      `/api/admin/users?eventId=${TEST_OTHER_EVENT_ID}`,
      { headers },
    );
    const overrideEventUsers = await overrideEventUsersResponse.json();
    expect(
      overrideEventUsers.some(
        (user: { email: string }) => user.email === overrideEmail,
      ),
    ).toBe(false);
    expect(
      overrideEventUsers.some(
        (user: { email: string }) => user.email === defaultEmail,
      ),
    ).toBe(false);

    const selectedEventUsersResponse = await request.get(
      `/api/admin/users?eventId=${selectedEvent.id}`,
      { headers },
    );
    const selectedEventUsers = await selectedEventUsersResponse.json();
    const defaultUser = selectedEventUsers.find(
      (user: { email: string }) => user.email === defaultEmail,
    );
    expect(defaultUser?.eventId).toBe(selectedEvent.id);
    expect(defaultUser?.qrCodeValue).toBeUndefined();
  });

  test("validates user updates and keeps account scope immutable", async ({
    request,
  }) => {
    const token = await loginAsAdmin(request);
    const headers = { Authorization: `Bearer ${token}` };
    const suffix = Date.now().toString(36);
    const email = `update-scope-${suffix}@stress2026.test`;
    const createdResponse = await request.post("/api/admin/users", {
      headers,
      data: {
        name: "Scoped User",
        email,
        role: "attendee",
        eventId: TEST_OTHER_EVENT_ID,
      },
    });
    expect(createdResponse.status()).toBe(201);
    const created = await createdResponse.json();
    const eventsResponse = await request.get("/api/admin/events", { headers });
    const otherEvent = (await eventsResponse.json()).find(
      (event: { id: string }) => event.id !== TEST_OTHER_EVENT_ID,
    );
    expect(otherEvent).toBeTruthy();

    try {
      const invalidRole = await request.put(
        `/api/admin/users/${created.id}?eventId=${TEST_OTHER_EVENT_ID}`,
        { headers, data: { role: "owner" } },
      );
      expect(invalidRole.status()).toBe(400);

      const injectedFields = await request.put(
        `/api/admin/users/${created.id}?eventId=${TEST_OTHER_EVENT_ID}`,
        {
          headers,
          data: {
            name: "Updated Name",
            id: "another-user",
            eventId: null,
            checkedIn: true,
            passwordHash: "not-a-hash",
          },
        },
      );
      expect(injectedFields.status()).toBe(400);

      const escalation = await request.put(
        `/api/admin/users/${created.id}?eventId=${TEST_OTHER_EVENT_ID}`,
        { headers, data: { role: "admin" } },
      );
      expect(escalation.status()).toBe(400);

      const crossEvent = await request.put(
        `/api/admin/users/${created.id}?eventId=${otherEvent.id}`,
        { headers, data: { name: "Wrong Event" } },
      );
      expect(crossEvent.status()).toBe(404);
    } finally {
      await request.delete(
        `/api/admin/users/${created.id}?eventId=${TEST_OTHER_EVENT_ID}`,
        { headers },
      );
    }
  });

  test("requires an event for staff creation while protecting admin accounts", async ({
    request,
  }) => {
    const token = await loginAsAdmin(request);
    const headers = { Authorization: `Bearer ${token}` };
    const suffix = Date.now().toString(36);
    const staffEmail = `deletable-staff-${suffix}@stress2026.test`;

    const missingEvent = await request.post("/api/admin/users", {
      headers,
      data: {
        name: "Unscoped Staff",
        email: `unscoped-staff-${suffix}@stress2026.test`,
        role: "staff",
      },
    });
    expect(missingEvent.status()).toBe(400);
    expect(await missingEvent.json()).toEqual({
      message: "Select a valid event before creating a user",
    });

    const createdResponse = await request.post("/api/admin/users", {
      headers,
      data: {
        name: "Deletable Event Staff",
        email: staffEmail,
        role: "staff",
        eventId: TEST_OTHER_EVENT_ID,
      },
    });
    expect(createdResponse.status()).toBe(201);
    const created = await createdResponse.json();
    expect(created.role).toBe("staff");
    expect(created.eventId).toBe(TEST_OTHER_EVENT_ID);

    try {
      const eventsResponse = await request.get("/api/admin/events", {
        headers,
      });
      expect(eventsResponse.status()).toBe(200);
      const events = await eventsResponse.json();
      const selectedEvent = events.find(
        (event: { id: string }) => event.id === TEST_OTHER_EVENT_ID,
      );
      expect(selectedEvent).toBeTruthy();

      const deleted = await request.delete(
        `/api/admin/users/${created.id}?eventId=${selectedEvent.id}`,
        { headers },
      );
      expect(deleted.status()).toBe(200);

      const usersResponse = await request.get(
        `/api/admin/users?eventId=${selectedEvent.id}`,
        { headers },
      );
      expect(usersResponse.status()).toBe(200);
      const users = await usersResponse.json();
      const admin = users.find(
        (user: { email: string }) => user.email === TEST_ADMIN_EMAIL,
      );
      expect(admin).toBeTruthy();

      const adminDelete = await request.delete(
        `/api/admin/users/${admin.id}?eventId=${selectedEvent.id}`,
        { headers },
      );
      expect(adminDelete.status()).toBe(403);
      expect(await adminDelete.json()).toEqual({
        message: "Admin accounts cannot be deleted.",
      });
    } finally {
      await request.delete(`/api/admin/users/${created.id}`, { headers });
    }
  });

  test("allows the same staff email in separate event scopes", async ({
    request,
  }) => {
    const token = await loginAsAdmin(request);
    const headers = { Authorization: `Bearer ${token}` };
    const activeEventResponse = await request.get("/api/events/active");
    expect(activeEventResponse.status()).toBe(200);
    const activeEvent = await activeEventResponse.json();
    const suffix = Date.now().toString(36);
    const staffEmail = `multi-event-staff-${suffix}@stress2026.test`;
    const createdUsers: { id: string; eventId: string }[] = [];

    try {
      for (const eventId of [TEST_OTHER_EVENT_ID, activeEvent.id]) {
        const response = await request.post("/api/admin/users", {
          headers,
          data: {
            name: "Multi-event Staff",
            email: staffEmail,
            role: "staff",
            eventId,
          },
        });
        expect(response.status()).toBe(201);
        const user = await response.json();
        expect(user.role).toBe("staff");
        expect(user.eventId).toBe(eventId);
        createdUsers.push({ id: user.id, eventId });
      }
    } finally {
      for (const user of createdUsers) {
        await request.delete(`/api/admin/users/${user.id}`, {
          headers,
          params: { eventId: user.eventId },
        });
      }
    }
  });

  test("deleted users cannot reuse an existing authenticated session", async ({
    request,
  }) => {
    const adminToken = await loginAsAdmin(request);
    const headers = { Authorization: `Bearer ${adminToken}` };
    const eventsResponse = await request.get("/api/admin/events", { headers });
    expect(eventsResponse.status()).toBe(200);
    const events = await eventsResponse.json();
    const publishedEvent = events.find(
      (event: { status: string }) => event.status === "published",
    );
    expect(publishedEvent).toBeTruthy();

    const email = `deleted-session-${Date.now()}@stress2026.test`;
    const createdResponse = await request.post("/api/admin/users", {
      headers,
      data: {
        name: "Deleted Session Test User",
        email,
        role: "staff",
        eventId: publishedEvent.id,
      },
    });
    expect(createdResponse.status()).toBe(201);
    const created = await createdResponse.json();

    try {
      const passwordResponse = await request.put(
        `/api/admin/users/${created.id}?eventId=${publishedEvent.id}`,
        {
          headers,
          data: { password: "DeleteMe1!" },
        },
      );
      expect(passwordResponse.status()).toBe(200);

      const loginResponse = await request.post("/api/auth/login", {
        data: { email, password: "DeleteMe1!" },
      });
      expect(loginResponse.status()).toBe(200);
      const userToken = (await loginResponse.json()).token;

      const deleteResponse = await request.delete(
        `/api/admin/users/${created.id}?eventId=${publishedEvent.id}`,
        { headers },
      );
      expect(deleteResponse.status()).toBe(200);

      const staleSessionResponse = await request.get("/api/auth/me", {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      expect(staleSessionResponse.status()).toBe(401);
    } finally {
      await request.delete(`/api/admin/users/${created.id}`, { headers });
    }
  });

  test("protects the primary admin account from editing and deletion", async ({
    request,
  }) => {
    const token = await loginAsAdmin(request);
    const headers = { Authorization: `Bearer ${token}` };
    const eventsResponse = await request.get("/api/admin/events", { headers });
    expect(eventsResponse.status()).toBe(200);
    const events = await eventsResponse.json();
    const selectedEvent = events.find(
      (event: { status: string; id: string }) => event.status === "published",
    );
    expect(selectedEvent).toBeTruthy();

    const usersResponse = await request.get(
      `/api/admin/users?eventId=${selectedEvent.id}`,
      { headers },
    );
    expect(usersResponse.status()).toBe(200);
    const users = await usersResponse.json();
    const primaryAdmin = users.find(
      (user: { email: string; role: string }) =>
        user.email.toLowerCase() === "stresscongressapp@gmail.com" &&
        user.role === "admin",
    );
    test.skip(
      !primaryAdmin,
      "Primary admin account is not present in this database",
    );

    const update = await request.put(
      `/api/admin/users/${primaryAdmin.id}?eventId=${selectedEvent.id}`,
      { headers, data: { name: "Should Not Change" } },
    );
    expect(update.status()).toBe(403);
    expect(await update.json()).toEqual({
      message: "The primary admin account cannot be edited.",
    });

    const deletion = await request.delete(
      `/api/admin/users/${primaryAdmin.id}?eventId=${selectedEvent.id}`,
      { headers },
    );
    expect(deletion.status()).toBe(403);
    expect(await deletion.json()).toEqual({
      message: "Admin accounts cannot be deleted.",
    });
  });

  test("requires an event-year choice for duplicate attendee emails", async ({
    request,
  }) => {
    const token = await loginAsAdmin(request);
    const headers = { Authorization: `Bearer ${token}` };
    const suffix = Date.now().toString(36);
    const email = `duplicate-events-${suffix}@stress2026.test`;
    const activeEventsResponse = await request.get("/api/admin/events", {
      headers,
    });
    const events = await activeEventsResponse.json();
    const activeEvent = events.find(
      (event: { status: string; id: string }) => event.status === "published",
    );
    expect(activeEvent).toBeTruthy();

    const activeResponse = await request.post("/api/admin/users", {
      headers,
      data: {
        name: "Active Event Account",
        email,
        role: "attendee",
        eventId: activeEvent.id,
      },
    });
    const otherResponse = await request.post("/api/admin/users", {
      headers,
      data: {
        name: "Other Event Account",
        email,
        role: "attendee",
        eventId: TEST_OTHER_EVENT_ID,
      },
    });
    expect(activeResponse.status()).toBe(201);
    expect(otherResponse.status()).toBe(201);
    const activeUser = await activeResponse.json();
    const otherUser = await otherResponse.json();

    try {
      for (const user of [activeUser, otherUser]) {
        const passwordResponse = await request.put(
          `/api/admin/users/${user.id}?eventId=${user.eventId}`,
          { headers, data: { password: TEST_PASSWORD } },
        );
        expect(passwordResponse.status()).toBe(200);
      }
      await markEventPreviouslyLive(TEST_OTHER_EVENT_ID, true);

      const emailStep = await request.post("/api/auth/login", {
        data: { email },
      });
      expect(emailStep.status()).toBe(200);
      const emailStepBody = await emailStep.json();
      expect(emailStepBody.eventSelectionRequired).toBe(true);
      expect(emailStepBody.eventOptions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: activeEvent.id }),
          expect.objectContaining({ id: TEST_OTHER_EVENT_ID }),
        ]),
      );

      const unscopedLogin = await request.post("/api/auth/login", {
        data: { email, password: TEST_PASSWORD },
      });
      expect(unscopedLogin.status()).toBe(409);
      expect((await unscopedLogin.json()).code).toBe(
        "EVENT_SELECTION_REQUIRED",
      );

      const login = await request.post("/api/auth/login", {
        data: { email, password: TEST_PASSWORD, eventId: TEST_OTHER_EVENT_ID },
      });
      expect(login.status()).toBe(200);
      const loginBody = await login.json();
      expect(loginBody.user.name).toBe("Other Event Account");

      const selectedEvent = await request.get("/api/events/active", {
        headers: { Authorization: `Bearer ${loginBody.token}` },
      });
      expect(selectedEvent.status()).toBe(200);
      expect((await selectedEvent.json()).id).toBe(TEST_OTHER_EVENT_ID);
    } finally {
      await request.delete(`/api/admin/users/${activeUser.id}`, { headers });
      await request.delete(
        `/api/admin/users/${otherUser.id}?eventId=${TEST_OTHER_EVENT_ID}`,
        { headers },
      );
      await markEventPreviouslyLive(TEST_OTHER_EVENT_ID, false);
    }
  });

  test("uses the same failure response for unknown and known login credentials", async ({
    request,
  }) => {
    const known = await request.post("/api/auth/login", {
      data: { email: TEST_ADMIN_EMAIL, password: "WrongPass1!" },
    });
    const unknown = await request.post("/api/auth/login", {
      data: {
        email: `unknown-${Date.now().toString(36)}@stress2026.test`,
        password: "WrongPass1!",
      },
    });
    expect(known.status()).toBe(401);
    expect(unknown.status()).toBe(401);
    expect(await known.json()).toEqual({
      message: "Invalid email or password",
    });
    expect(await unknown.json()).toEqual({
      message: "Invalid email or password",
    });
  });
});
