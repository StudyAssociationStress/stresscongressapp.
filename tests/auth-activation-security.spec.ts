import { test, expect } from "@playwright/test";
import { Client } from "pg";
import bcrypt from "bcryptjs";
import {
  EMAIL_HTML,
  EVENT_ATTENDEE_ADDED_HTML,
  EVENT_LIVE_HTML,
  sendEventInvitationsForEvent,
  sendEventLiveAnnouncements,
  processOneEventEmailOutboxItem,
  type ActivationMailer,
  type EventLiveMailer,
} from "../server/routes";
import {
  eventEmailRecipientIsCurrent,
  storage,
  type EventEmailOutboxItem,
} from "../server/storage";

const ACTIVATION_CODE = "123456";
const RESET_CODE = "654321";
const TEST_PASSWORD = "TestPass1!";
const GENERIC_ACTIVATION_MESSAGE =
  "If this email is registered for an unactivated account, an activation code has been sent.";

type Fixture = {
  email: string;
  code: string;
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

async function createUserAndCode(options: {
  email: string;
  code: string;
  purpose: "reset" | "activation";
  password?: string;
  expired?: boolean;
}): Promise<Fixture> {
  return withDatabase(async (client) => {
    const event = await client.query<{ id: string }>(
      "SELECT id FROM events WHERE status = 'published' ORDER BY year DESC LIMIT 1",
    );
    expect(event.rows[0]).toBeTruthy();

    const passwordHash = options.password
      ? await bcrypt.hash(options.password, 10)
      : null;
    const insertedUser = await client.query<{ id: string }>(
      `INSERT INTO users
        (id, email, name, role, qr_code_value, checked_in, password_hash, event_id)
       VALUES (gen_random_uuid(), $1, $2, 'attendee', $3, false, $4, $5)
       RETURNING id`,
      [
        options.email,
        "Activation Security Test User",
        `SC2026-AUTH-${Date.now()}-${Math.random()}`,
        passwordHash,
        event.rows[0].id,
      ],
    );
    await client.query(
      `INSERT INTO password_reset_tokens
        (id, user_id, email, code, purpose, attempts, expires_at, used)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 0,
         CASE WHEN $5 THEN NOW() - INTERVAL '1 minute'
               ELSE NOW() + INTERVAL '10 minutes' END, false)`,
      [
        insertedUser.rows[0].id,
        options.email,
        await bcrypt.hash(options.code, 10),
        options.purpose,
        options.expired ?? false,
      ],
    );
    return { email: options.email, code: options.code };
  });
}

async function removeFixture(email: string): Promise<void> {
  await withDatabase(async (client) => {
    await client.query("DELETE FROM password_reset_tokens WHERE email = $1", [
      email,
    ]);
    await client.query("DELETE FROM users WHERE email = $1", [email]);
  });
}

function uniqueEmail(label: string): string {
  return `activation-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@stress2026.test`;
}

test.describe("activation-code security guarantees", () => {
  test("outbox worker sends a validated current address through a fake mailer", async () => {
    const claim: EventEmailOutboxItem = {
      id: 987654,
      eventId: "fixture-event",
      userId: "fixture-user",
      kind: "attendee_added",
      recipientEmail: "old-address@example.com",
      recipientName: "Fixture Attendee",
      eventName: "Fixture Event",
      eventYear: 2035,
      eventStartDate: "September 9",
      attempts: 1,
      claimToken: "fixture-claim-token",
    };
    const mailed: string[] = [];
    const finalized: string[] = [];
    const outbox = {
      claimEventEmail: async () => claim,
      getValidatedEventEmailClaim: async () => ({
        ...claim,
        recipientEmail: "current-address@example.com",
      }),
      skipEventEmail: async () => {},
      completeEventEmail: async (item: EventEmailOutboxItem) => {
        finalized.push(item.claimToken);
      },
      failEventEmail: async () => {
        throw new Error("Unexpected fake-mailer failure");
      },
    };
    const mailer: ActivationMailer = {
      sendMail: async (message) => {
        mailed.push(message.to);
        return { accepted: [message.to], rejected: [] };
      },
    };

    await processOneEventEmailOutboxItem(mailer, outbox);

    expect(mailed).toEqual(["current-address@example.com"]);
    expect(finalized).toEqual(["fixture-claim-token"]);
    expect(
      eventEmailRecipientIsCurrent({
        kind: "attendee_added",
        eventId: "fixture-event",
        userEventId: "fixture-event",
        role: "attendee",
        eventStatus: "published",
        invitationSentAt: null,
      }),
    ).toBe(true);
  });

  test("fake mailers may exercise test-domain recipients without SMTP", async () => {
    const claim: EventEmailOutboxItem = {
      id: 987658,
      eventId: "fixture-event",
      userId: "fixture-user",
      kind: "event_live",
      recipientEmail: "worker@stresscongress.test",
      recipientName: "Fixture Attendee",
      eventName: "Fixture Event",
      eventYear: 2035,
      eventStartDate: null,
      attempts: 1,
      claimToken: "fixture-test-token",
    };
    const mailed: string[] = [];
    const outbox = {
      claimEventEmail: async () => claim,
      getValidatedEventEmailClaim: async () => claim,
      skipEventEmail: async () => {},
      completeEventEmail: async () => {},
      failEventEmail: async () => {},
    };
    const mailer: ActivationMailer = {
      sendMail: async (message) => {
        mailed.push(message.to);
        return { accepted: [message.to], rejected: [] };
      },
    };

    await processOneEventEmailOutboxItem(mailer, outbox);

    expect(mailed).toEqual(["worker@stresscongress.test"]);
  });

  test("outbox worker cancels archived or reassigned recipients before SMTP", async () => {
    const claim: EventEmailOutboxItem = {
      id: 987655,
      eventId: "fixture-event",
      userId: "fixture-user",
      kind: "attendee_added",
      recipientEmail: "attendee@example.com",
      recipientName: "Fixture Attendee",
      eventName: "Fixture Event",
      eventYear: 2035,
      eventStartDate: null,
      attempts: 1,
      claimToken: "fixture-claim-token",
    };
    let sends = 0;
    const outbox = {
      claimEventEmail: async () => claim,
      getValidatedEventEmailClaim: async () => null,
      skipEventEmail: async () => {},
      completeEventEmail: async () => {},
      failEventEmail: async () => {},
    };
    const mailer: ActivationMailer = {
      sendMail: async () => {
        sends++;
        return { accepted: ["attendee@example.com"], rejected: [] };
      },
    };

    await processOneEventEmailOutboxItem(mailer, outbox);

    expect(sends).toBe(0);
    expect(
      eventEmailRecipientIsCurrent({
        kind: "attendee_added",
        eventId: "fixture-event",
        userEventId: "other-event",
        role: "attendee",
        eventStatus: "published",
        invitationSentAt: null,
      }),
    ).toBe(false);
    expect(
      eventEmailRecipientIsCurrent({
        kind: "attendee_added",
        eventId: "fixture-event",
        userEventId: "fixture-event",
        role: "attendee",
        eventStatus: "archived",
        invitationSentAt: null,
      }),
    ).toBe(false);
  });

  test("outbox worker opens the SMTP circuit after a 454 using a fake mailer", async () => {
    const claim: EventEmailOutboxItem = {
      id: 987656,
      eventId: "fixture-event",
      userId: "fixture-user",
      kind: "event_live",
      recipientEmail: "attendee@example.com",
      recipientName: "Fixture Attendee",
      eventName: "Fixture Event",
      eventYear: 2035,
      eventStartDate: null,
      attempts: 1,
      claimToken: "fixture-claim-token",
    };
    const failures: boolean[] = [];
    const outbox = {
      claimEventEmail: async () => claim,
      getValidatedEventEmailClaim: async () => claim,
      skipEventEmail: async () => {},
      completeEventEmail: async () => {},
      failEventEmail: async (
        _item: EventEmailOutboxItem,
        _message: string,
        smtp454: boolean,
      ) => {
        failures.push(smtp454);
      },
    };
    const mailer: ActivationMailer = {
      sendMail: async () => {
        throw Object.assign(new Error("SMTP 454 Too many login attempts"), {
          responseCode: 454,
        });
      },
    };

    await processOneEventEmailOutboxItem(mailer, outbox);
    expect(failures).toEqual([true]);
  });

  test("outbox delivery uses the address locked immediately before SMTP", async () => {
    const claim: EventEmailOutboxItem = {
      id: 987659,
      eventId: "fixture-event",
      userId: "fixture-user",
      kind: "attendee_added",
      recipientEmail: "old@example.com",
      recipientName: "Fixture Attendee",
      eventName: "Fixture Event",
      eventYear: 2035,
      eventStartDate: null,
      attempts: 1,
      claimToken: "fixture-lock-token",
    };
    const recipients: string[] = [];
    const completed: string[] = [];
    const outbox = {
      claimEventEmail: async () => claim,
      getValidatedEventEmailClaim: async () => claim,
      withLockedEventEmailRecipient: async (
        item: EventEmailOutboxItem,
        deliver: (current: EventEmailOutboxItem) => Promise<void>,
      ) => {
        const current = { ...item, recipientEmail: "new@example.com" };
        await deliver(current);
        return current;
      },
      skipEventEmail: async () => {},
      completeEventEmail: async (item: EventEmailOutboxItem) => {
        completed.push(item.recipientEmail);
      },
      failEventEmail: async () => {},
    };
    const mailer: ActivationMailer = {
      sendMail: async (message) => {
        recipients.push(message.to);
        return { accepted: [message.to], rejected: [] };
      },
    };

    await processOneEventEmailOutboxItem(mailer, outbox);

    expect(recipients).toEqual(["new@example.com"]);
    expect(completed).toEqual(["new@example.com"]);
  });

  test("outbox does not automatically retry an indeterminate SMTP timeout", async () => {
    const claim: EventEmailOutboxItem = {
      id: 987660,
      eventId: "fixture-event",
      userId: "fixture-user",
      kind: "event_live",
      recipientEmail: "attendee@example.com",
      recipientName: "Fixture Attendee",
      eventName: "Fixture Event",
      eventYear: 2035,
      eventStartDate: null,
      attempts: 1,
      claimToken: "fixture-timeout-token",
    };
    const uncertain: boolean[] = [];
    const outbox = {
      claimEventEmail: async () => claim,
      getValidatedEventEmailClaim: async () => claim,
      skipEventEmail: async () => {},
      completeEventEmail: async () => {},
      failEventEmail: async (
        _item: EventEmailOutboxItem,
        _message: string,
        _smtp454: boolean,
        deliveryOutcomeUncertain: boolean,
      ) => {
        uncertain.push(deliveryOutcomeUncertain);
      },
    };
    const mailer: ActivationMailer = {
      sendMail: async () => {
        throw Object.assign(new Error("SMTP response timed out"), {
          code: "ETIMEDOUT",
        });
      },
    };

    await processOneEventEmailOutboxItem(mailer, outbox);

    expect(uncertain).toEqual([true]);
  });

  test("outbox claim contention sends one message and fences by claim token", async () => {
    const claim: EventEmailOutboxItem = {
      id: 987657,
      eventId: "fixture-event",
      userId: "fixture-user",
      kind: "event_live",
      recipientEmail: "attendee@example.com",
      recipientName: "Fixture Attendee",
      eventName: "Fixture Event",
      eventYear: 2035,
      eventStartDate: null,
      attempts: 1,
      claimToken: "winner-token",
    };
    let claimed = false;
    let sends = 0;
    const finalizedTokens: string[] = [];
    const outbox = {
      claimEventEmail: async () => {
        if (claimed) return null;
        claimed = true;
        return claim;
      },
      getValidatedEventEmailClaim: async (item: EventEmailOutboxItem) => item,
      skipEventEmail: async () => {},
      completeEventEmail: async (item: EventEmailOutboxItem) => {
        finalizedTokens.push(item.claimToken);
      },
      failEventEmail: async () => {},
    };
    const mailer: ActivationMailer = {
      sendMail: async (message) => {
        sends++;
        return { accepted: [message.to], rejected: [] };
      },
    };

    await Promise.all([
      processOneEventEmailOutboxItem(mailer, outbox),
      processOneEventEmailOutboxItem(mailer, outbox),
    ]);

    expect(sends).toBe(1);
    expect(finalizedTokens).toEqual(["winner-token"]);
  });

  test("escapes markup-like values in account and event-live emails", () => {
    const name = `<img src=x onerror="alert('name')">`;
    const eventName = `Stress <Congress> & "2026"`;
    const email = `attendee&alerts<test>@stress2026.test`;

    const activationEmail = EMAIL_HTML(
      name,
      ACTIVATION_CODE,
      true,
      eventName,
      email,
    );
    expect(activationEmail).toContain(
      "Hi &lt;img src=x onerror=&quot;alert(&#39;name&#39;)&quot;&gt;,",
    );
    expect(activationEmail).toContain(
      "created for Stress &lt;Congress&gt; &amp; &quot;2026&quot;",
    );
    expect(activationEmail).toContain(
      "attendee&amp;alerts&lt;test&gt;@stress2026.test",
    );
    expect(activationEmail).not.toContain("<img src=x");

    const resetEmail = EMAIL_HTML(name, RESET_CODE);
    expect(resetEmail).toContain(
      "Hi &lt;img src=x onerror=&quot;alert(&#39;name&#39;)&quot;&gt;,",
    );
    expect(resetEmail).not.toContain("<img src=x");

    const eventLiveEmail = EVENT_LIVE_HTML(name, eventName, null);
    expect(eventLiveEmail).toContain(
      '<h2 style="color:#0c0057;margin-bottom:8px;">Stress &lt;Congress&gt; &amp; &quot;2026&quot; is now live</h2>',
    );
    expect(eventLiveEmail).not.toContain("<img src=x");
    expect(eventLiveEmail).not.toContain("<Congress>");

    const attendeeAddedEmail = EVENT_ATTENDEE_ADDED_HTML(
      name,
      eventName,
      "September 9",
      2026,
    );
    expect(attendeeAddedEmail).toContain("You have been added to");
    expect(attendeeAddedEmail).toContain(
      "You have been added to Stress &lt;Congress&gt;",
    );
    expect(attendeeAddedEmail).not.toContain(ACTIVATION_CODE);
    expect(attendeeAddedEmail).not.toContain("<img src=x");
  });

  test("formats human-friendly event dates without leaking invalid dates", () => {
    const dateCases = [
      ["9/9", "September 9, 2026"],
      ["September/9", "September 9, 2026"],
      ["September 9", "September 9, 2026"],
      ["9 September 2026", "September 9, 2026"],
      ["September 9, 2026", "September 9, 2026"],
      ["2026-09-09", "September 9, 2026"],
    ] as const;

    for (const [input, expected] of dateCases) {
      const html = EVENT_LIVE_HTML("Alex", "Stress Congress", input, 2026);
      expect(html).toContain(`<strong>Event date:</strong> ${expected}`);
      expect(html).not.toContain("Invalid Date");
    }

    for (const input of [null, "", "not a date", "February 31, 2026"]) {
      const html = EVENT_LIVE_HTML("Alex", "Stress Congress", input, 2026);
      expect(html).not.toContain("<strong>Event date:</strong>");
      expect(html).not.toContain("Invalid Date");
    }
  });

  test("queues event-live emails only for event attendees and staff", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const eventId = `event-live-primary-${suffix}`;
    const otherEventId = `event-live-other-${suffix}`;
    const primaryRecipients = [
      `event-live-attendee-${suffix}@stress2026.test`,
      `event-live-staff-${suffix}@stress2026.test`,
    ];
    const excludedEmails = [
      `event-live-admin-${suffix}@stress2026.test`,
      `event-live-global-admin-${suffix}@stress2026.test`,
      `event-live-other-${suffix}@stress2026.test`,
    ];

    await withDatabase(async (client) => {
      try {
        await client.query(
          `INSERT INTO events (id, name, year, status, start_date)
           VALUES ($1, $2, $3, 'draft', $4), ($5, $6, $7, 'draft', $8)`,
          [
            eventId,
            "Primary Event",
            2026,
            "September 9",
            otherEventId,
            "Other Event",
            2027,
            "October 10",
          ],
        );

        const users = [
          [primaryRecipients[0], "Primary Attendee", "attendee", eventId],
          [primaryRecipients[1], "Primary Staff", "staff", eventId],
          [excludedEmails[0], "Primary Event Admin", "admin", eventId],
          [excludedEmails[1], "Global Admin", "admin", null],
          [excludedEmails[2], "Other Event Attendee", "attendee", otherEventId],
        ] as const;
        for (const [email, name, role, userEventId] of users) {
          await client.query(
            `INSERT INTO users (email, name, role, qr_code_value, event_id)
             VALUES ($1, $2, $3, $4, $5)`,
            [email, name, role, `QR-${suffix}-${role}-${email}`, userEventId],
          );
        }

        const messages: Parameters<EventLiveMailer["sendMail"]>[0][] = [];
        const mailer: EventLiveMailer = {
          sendMail: async (message) => {
            messages.push(message);
          },
        };
        const result = await sendEventLiveAnnouncements(
          {
            id: eventId,
            name: "Primary Event",
            year: 2026,
            startDate: "September 9",
          },
          mailer,
        );

        expect(result).toEqual({ attempted: 2, sent: 0, failed: 0 });
        expect(messages).toHaveLength(0);
        const queued = await client.query(
          `SELECT recipient_email, status FROM event_email_outbox
           WHERE event_id = $1 AND kind = 'event_live' ORDER BY recipient_email`,
          [eventId],
        );
        expect(queued.rows).toEqual(
          primaryRecipients
            .slice()
            .sort()
            .map((recipient_email) => ({ recipient_email, status: "skipped" })),
        );
      } finally {
        await client.query("DELETE FROM users WHERE email = ANY($1::text[])", [
          [...primaryRecipients, ...excludedEmails],
        ]);
        await client.query("DELETE FROM events WHERE id = ANY($1::text[])", [
          [eventId, otherEventId],
        ]);
      }
    });
  });

  test("defers invitations offline and idempotently queues them when live", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const offlineEventId = `activation-offline-${suffix}`;
    const otherEventId = `activation-other-${suffix}`;
    const offlineEmail = `activation-offline-${suffix}@stress2026.test`;
    const liveAddedEmail = `activation-live-added-${suffix}@stress2026.test`;
    const otherEmail = `activation-other-${suffix}@stress2026.test`;
    const messages: Parameters<ActivationMailer["sendMail"]>[0][] = [];
    const mailer: ActivationMailer = {
      sendMail: async (message) => {
        messages.push(message);
        return { accepted: [message.to], rejected: [] };
      },
    };

    await withDatabase(async (client) => {
      try {
        await client.query(
          `INSERT INTO events (id, name, year, status, start_date)
           VALUES ($1, $2, $3, 'draft', $4), ($5, $6, $7, 'draft', $8)`,
          [
            offlineEventId,
            "Offline Activation Event",
            2031,
            "September 9",
            otherEventId,
            "Other Activation Event",
            2032,
            "October 10",
          ],
        );
        await client.query(
          `INSERT INTO users (email, name, role, qr_code_value, event_id)
           VALUES
             ($1, 'Offline Attendee', 'attendee', $3, $4),
             ($2, 'Other Attendee', 'attendee', $5, $6)`,
          [
            offlineEmail,
            otherEmail,
            `QR-${suffix}-offline`,
            offlineEventId,
            `QR-${suffix}-other`,
            otherEventId,
          ],
        );
        await client.query(
          "UPDATE users SET activation_invitation_sent_at = now() WHERE email = $1",
          [offlineEmail],
        );

        const offlineUser = await storage.getUserByEmailAndEvent(
          offlineEmail,
          offlineEventId,
        );
        expect(offlineUser).toBeTruthy();
        const offline = await sendEventInvitationsForEvent(
          {
            id: offlineEventId,
            name: "Offline Activation Event",
            year: 2031,
            startDate: "September 9",
            status: "draft",
          },
          [offlineUser!],
          mailer,
        );
        expect(offline).toEqual({
          attempted: 0,
          sent: 0,
          failed: 0,
          deferred: 1,
        });
        expect(messages).toHaveLength(0);

        await client.query(
          "UPDATE events SET status = 'published' WHERE id = $1",
          [offlineEventId],
        );
        const liveEvent = {
          id: offlineEventId,
          name: "Offline Activation Event",
          year: 2031,
          startDate: "September 9",
          status: "published",
        };
        const liveAnnouncement = await sendEventLiveAnnouncements(liveEvent);
        expect(liveAnnouncement).toEqual({
          attempted: 1,
          sent: 0,
          failed: 0,
        });
        expect(messages).toHaveLength(0);
        const preLiveOutbox = await client.query(
          `SELECT kind, status FROM event_email_outbox
           WHERE event_id = $1
             AND user_id = (SELECT id FROM users WHERE email = $2)
           ORDER BY kind`,
          [offlineEventId, offlineEmail],
        );
        expect(preLiveOutbox.rows).toEqual([
          { kind: "event_live", status: "skipped" },
        ]);

        await client.query(
          `INSERT INTO users (email, name, role, qr_code_value, event_id)
           VALUES ($1, 'Live Added Attendee', 'attendee', $2, $3)`,
          [liveAddedEmail, `QR-${suffix}-live-added`, offlineEventId],
        );
        const liveAddedUser = await storage.getUserByEmailAndEvent(
          liveAddedEmail,
          offlineEventId,
        );
        expect(liveAddedUser).toBeTruthy();
        const live = await sendEventInvitationsForEvent(
          liveEvent,
          [liveAddedUser!],
          mailer,
        );
        expect(live).toEqual({
          attempted: 1,
          sent: 0,
          failed: 0,
          deferred: 0,
        });
        expect(messages).toHaveLength(0);
        expect(messages).toHaveLength(0);
        const outbox = await client.query(
          `SELECT status FROM event_email_outbox
           WHERE event_id = $1 AND user_id = (SELECT id FROM users WHERE email = $2)
             AND kind = 'attendee_added'`,
          [offlineEventId, liveAddedEmail],
        );
        expect(outbox.rows).toEqual([{ status: "skipped" }]);
        const activationTokens = await client.query(
          `SELECT prt.id
           FROM password_reset_tokens prt
           INNER JOIN users u ON u.id = prt.user_id
           WHERE u.email = $1 AND prt.purpose = 'activation'`,
          [offlineEmail],
        );
        expect(activationTokens.rows).toHaveLength(0);

        const repeated = await sendEventInvitationsForEvent(
          liveEvent,
          [liveAddedUser!],
          mailer,
        );
        expect(repeated).toEqual({
          attempted: 0,
          sent: 0,
          failed: 0,
          deferred: 0,
        });
        expect(messages).toHaveLength(0);

        const otherUser = await storage.getUserByEmailAndEvent(
          otherEmail,
          otherEventId,
        );
        expect(otherUser).toBeTruthy();
        const other = await sendEventInvitationsForEvent(
          {
            id: otherEventId,
            name: "Other Activation Event",
            year: 2032,
            startDate: "October 10",
            status: "draft",
          },
          [otherUser!],
          mailer,
        );
        expect(other.deferred).toBe(1);
        expect(messages).toHaveLength(0);
      } finally {
        await client.query("DELETE FROM users WHERE email = ANY($1::text[])", [
          [offlineEmail, liveAddedEmail, otherEmail],
        ]);
        await client.query("DELETE FROM events WHERE id = ANY($1::text[])", [
          [offlineEventId, otherEventId],
        ]);
      }
    });
  });

  test("completes the forgot-password flow and rejects replay or expired codes", async ({
    request,
  }) => {
    const fixture = await createUserAndCode({
      email: uniqueEmail("reset-flow"),
      code: RESET_CODE,
      purpose: "reset",
      password: TEST_PASSWORD,
    });
    const expired = await createUserAndCode({
      email: uniqueEmail("reset-expired"),
      code: RESET_CODE,
      purpose: "reset",
      password: TEST_PASSWORD,
      expired: true,
    });
    try {
      const verified = await request.post("/api/auth/verify-reset-code", {
        data: { ...fixture, purpose: "reset" },
      });
      expect(verified.status()).toBe(200);
      expect(await verified.json()).toEqual({ valid: true });

      const existingSession = await request.post("/api/auth/login", {
        data: { email: fixture.email, password: TEST_PASSWORD },
      });
      expect(existingSession.status()).toBe(200);
      const oldToken = (await existingSession.json()).token;

      const reset = await request.post("/api/auth/reset-password", {
        data: { ...fixture, newPassword: "ResetPass2!" },
      });
      expect(reset.status()).toBe(200);
      expect(await reset.json()).toEqual({ passwordChanged: true });

      const rejected = await request.get("/api/auth/me", {
        headers: { Authorization: `Bearer ${oldToken}` },
      });
      expect(rejected.status()).toBe(401);
      expect((await rejected.json()).code).toBe("PASSWORD_CHANGED");

      const login = await request.post("/api/auth/login", {
        data: { email: fixture.email, password: "ResetPass2!" },
      });
      expect(login.status()).toBe(200);
      expect((await login.json()).user.email).toBe(fixture.email);

      const replay = await request.post("/api/auth/verify-reset-code", {
        data: { ...fixture, purpose: "reset" },
      });
      expect(replay.status()).toBe(400);
      expect((await replay.json()).message).toContain(
        "Invalid or expired code",
      );

      const expiredResponse = await request.post(
        "/api/auth/verify-reset-code",
        {
          data: { ...expired, purpose: "reset" },
        },
      );
      expect(expiredResponse.status()).toBe(400);
      expect((await expiredResponse.json()).message).toContain(
        "Invalid or expired code",
      );
    } finally {
      await removeFixture(fixture.email);
      await removeFixture(expired.email);
    }
  });

  test("does not accept a reset code for a different account", async ({
    request,
  }) => {
    const owner = await createUserAndCode({
      email: uniqueEmail("code-owner"),
      code: RESET_CODE,
      purpose: "reset",
      password: TEST_PASSWORD,
    });
    const otherAccount = await createUserAndCode({
      email: uniqueEmail("other-account"),
      code: "111222",
      purpose: "reset",
      password: TEST_PASSWORD,
    });
    try {
      await withDatabase(async (client) => {
        await client.query(
          "DELETE FROM password_reset_tokens WHERE email = $1",
          [otherAccount.email],
        );
      });

      const verify = await request.post("/api/auth/verify-reset-code", {
        data: { email: otherAccount.email, code: owner.code, purpose: "reset" },
      });
      expect(verify.status()).toBe(400);

      const reset = await request.post("/api/auth/reset-password", {
        data: {
          email: otherAccount.email,
          code: owner.code,
          newPassword: "ShouldNotWork1!",
        },
      });
      expect(reset.status()).toBe(400);

      const unchangedLogin = await request.post("/api/auth/login", {
        data: { email: otherAccount.email, password: TEST_PASSWORD },
      });
      expect(unchangedLogin.status()).toBe(200);
    } finally {
      await removeFixture(owner.email);
      await removeFixture(otherAccount.email);
    }
  });

  test("rejects a reset code after the account email changes", async ({
    request,
  }) => {
    const fixture = await createUserAndCode({
      email: uniqueEmail("email-before-change"),
      code: RESET_CODE,
      purpose: "reset",
      password: TEST_PASSWORD,
    });
    const changedEmail = uniqueEmail("email-after-change");
    try {
      await withDatabase(async (client) => {
        await client.query("UPDATE users SET email = $1 WHERE email = $2", [
          changedEmail,
          fixture.email,
        ]);
      });

      const verify = await request.post("/api/auth/verify-reset-code", {
        data: { email: changedEmail, code: fixture.code, purpose: "reset" },
      });
      expect(verify.status()).toBe(400);

      const reset = await request.post("/api/auth/reset-password", {
        data: {
          email: changedEmail,
          code: fixture.code,
          newPassword: "ShouldNotWork1!",
        },
      });
      expect(reset.status()).toBe(400);
    } finally {
      await removeFixture(changedEmail);
    }
  });

  test("cannot reuse an activation code after password creation", async ({
    request,
  }) => {
    const fixture = await createUserAndCode({
      email: uniqueEmail("replay"),
      code: ACTIVATION_CODE,
      purpose: "activation",
    });
    try {
      const first = await request.post("/api/auth/set-password", {
        data: { ...fixture, newPassword: TEST_PASSWORD },
      });
      expect(first.status()).toBe(200);

      const reused = await request.post("/api/auth/verify-reset-code", {
        data: fixture,
      });
      expect(reused.status()).toBe(400);
      expect((await reused.json()).message).toContain(
        "Invalid or expired code",
      );
    } finally {
      await removeFixture(fixture.email);
    }
  });

  test("rejects the current password during reset without consuming the code", async ({
    request,
  }) => {
    const fixture = await createUserAndCode({
      email: uniqueEmail("password-reuse"),
      code: RESET_CODE,
      purpose: "reset",
      password: TEST_PASSWORD,
    });
    try {
      const reused = await request.post("/api/auth/reset-password", {
        data: { ...fixture, newPassword: TEST_PASSWORD },
      });
      expect(reused.status()).toBe(400);
      expect((await reused.json()).message).toBe(
        "You cannot reuse a previous password. Please choose a different password.",
      );

      const tokenState = await withDatabase(async (client) => {
        const result = await client.query<{ used: boolean }>(
          "SELECT used FROM password_reset_tokens WHERE email = $1",
          [fixture.email],
        );
        return result.rows[0];
      });
      expect(tokenState.used).toBe(false);

      const changed = await request.post("/api/auth/reset-password", {
        data: { ...fixture, newPassword: "ResetPass2!" },
      });
      expect(changed.status()).toBe(200);
      expect(await changed.json()).toEqual({ passwordChanged: true });
    } finally {
      await removeFixture(fixture.email);
    }
  });

  test("rejects a previous password during an authenticated password change", async ({
    request,
  }) => {
    const fixture = await createUserAndCode({
      email: uniqueEmail("authenticated-reuse"),
      code: RESET_CODE,
      purpose: "reset",
      password: TEST_PASSWORD,
    });
    try {
      const login = await request.post("/api/auth/login", {
        data: { email: fixture.email, password: TEST_PASSWORD },
      });
      expect(login.status()).toBe(200);
      const token = (await login.json()).token;

      const changed = await request.post("/api/auth/change-password", {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          currentPassword: TEST_PASSWORD,
          newPassword: "ChangedPass2!",
        },
      });
      expect(changed.status()).toBe(200);
      expect(await changed.json()).toEqual({ passwordChanged: true });

      const refreshedLogin = await request.post("/api/auth/login", {
        data: { email: fixture.email, password: "ChangedPass2!" },
      });
      expect(refreshedLogin.status()).toBe(200);
      const refreshedToken = (await refreshedLogin.json()).token;

      const reused = await request.post("/api/auth/change-password", {
        headers: { Authorization: `Bearer ${refreshedToken}` },
        data: {
          currentPassword: "ChangedPass2!",
          newPassword: TEST_PASSWORD,
        },
      });
      expect(reused.status()).toBe(400);
      expect((await reused.json()).message).toBe(
        "You cannot reuse a previous password. Please choose a different password.",
      );
    } finally {
      await removeFixture(fixture.email);
    }
  });

  test("keeps activation and password-reset codes on separate flows", async ({
    request,
  }) => {
    const uninitialized = await createUserAndCode({
      email: uniqueEmail("reset-as-activation"),
      code: RESET_CODE,
      purpose: "reset",
    });
    const initialized = await createUserAndCode({
      email: uniqueEmail("activation-as-reset"),
      code: ACTIVATION_CODE,
      purpose: "activation",
      password: TEST_PASSWORD,
    });
    try {
      const resetUsedForActivation = await request.post(
        "/api/auth/set-password",
        {
          data: { ...uninitialized, newPassword: "AnotherPass1!" },
        },
      );
      expect(resetUsedForActivation.status()).toBe(400);

      const activationUsedForReset = await request.post(
        "/api/auth/reset-password",
        {
          data: { ...initialized, newPassword: "ChangedPass1!" },
        },
      );
      expect(activationUsedForReset.status()).toBe(400);
    } finally {
      await removeFixture(uninitialized.email);
      await removeFixture(initialized.email);
    }
  });

  test("invalidates an activation code after five failed attempts", async ({
    request,
  }) => {
    const fixture = await createUserAndCode({
      email: uniqueEmail("bruteforce"),
      code: ACTIVATION_CODE,
      purpose: "activation",
    });
    try {
      const responses = await Promise.all(
        Array.from({ length: 10 }, () =>
          request.post("/api/auth/verify-reset-code", {
            data: { email: fixture.email, code: "000000" },
          }),
        ),
      );
      for (const response of responses) {
        expect(response.status()).toBe(400);
        await expect(response.json()).resolves.toEqual({
          message: "Invalid or expired code. Please request a new one.",
        });
      }

      const correctAfterFailures = await request.post(
        "/api/auth/verify-reset-code",
        {
          data: fixture,
        },
      );
      expect(correctAfterFailures.status()).toBe(400);
      await expect(correctAfterFailures.json()).resolves.toEqual({
        message: "Invalid or expired code. Please request a new one.",
      });

      await withDatabase(async (client) => {
        const result = await client.query<{ attempts: number; used: boolean }>(
          "SELECT attempts, used FROM password_reset_tokens WHERE email = $1",
          [fixture.email],
        );
        expect(result.rows[0]).toMatchObject({ attempts: 5, used: false });
      });
    } finally {
      await removeFixture(fixture.email);
    }
  });

  test("limits concurrent password-reset guesses to five attempts", async ({
    request,
  }) => {
    const fixture = await createUserAndCode({
      email: uniqueEmail("reset-bruteforce"),
      code: RESET_CODE,
      purpose: "reset",
      password: TEST_PASSWORD,
    });
    try {
      const responses = await Promise.all(
        Array.from({ length: 10 }, () =>
          request.post("/api/auth/verify-reset-code", {
            data: {
              email: fixture.email,
              code: "000000",
              purpose: "reset",
            },
          }),
        ),
      );
      for (const response of responses) {
        expect(response.status()).toBe(400);
        await expect(response.json()).resolves.toEqual({
          message: "Invalid or expired code. Please request a new one.",
        });
      }

      const correctAfterFailures = await request.post(
        "/api/auth/verify-reset-code",
        {
          data: { ...fixture, purpose: "reset" },
        },
      );
      expect(correctAfterFailures.status()).toBe(400);
      await expect(correctAfterFailures.json()).resolves.toEqual({
        message: "Invalid or expired code. Please request a new one.",
      });

      await withDatabase(async (client) => {
        const result = await client.query<{ attempts: number; used: boolean }>(
          "SELECT attempts, used FROM password_reset_tokens WHERE email = $1",
          [fixture.email],
        );
        expect(result.rows[0]).toMatchObject({ attempts: 5, used: false });
      });
    } finally {
      await removeFixture(fixture.email);
    }
  });

  test("rejects activation requests for unknown emails", async ({
    request,
  }) => {
    const fixture = await createUserAndCode({
      email: uniqueEmail("known"),
      code: ACTIVATION_CODE,
      purpose: "activation",
    });
    try {
      const known = await request.post("/api/auth/request-activation", {
        data: { email: fixture.email },
      });
      const unknown = await request.post("/api/auth/request-activation", {
        data: { email: uniqueEmail("unknown") },
      });

      expect(known.status()).toBe(200);
      expect(unknown.status()).toBe(404);
      expect(await known.json()).toEqual({
        message: GENERIC_ACTIVATION_MESSAGE,
      });
      expect(await unknown.json()).toEqual({
        code: "INVALID_EMAIL",
        message: "This email is not registered for an event.",
      });
    } finally {
      await removeFixture(fixture.email);
    }
  });

  test("creates a fresh activation token for an uninitialized invited account", async ({
    request,
  }) => {
    const fixture = await createUserAndCode({
      email: uniqueEmail("delivery"),
      code: ACTIVATION_CODE,
      purpose: "activation",
    });
    try {
      await withDatabase(async (client) => {
        await client.query(
          "DELETE FROM password_reset_tokens WHERE email = $1",
          [fixture.email],
        );
      });

      const response = await request.post("/api/auth/request-activation", {
        data: { email: `${fixture.email}.` },
      });
      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual({
        message: GENERIC_ACTIVATION_MESSAGE,
      });

      await withDatabase(async (client) => {
        const result = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
           FROM password_reset_tokens
           WHERE email = $1 AND purpose = 'activation' AND used = false`,
          [fixture.email],
        );
        expect(result.rows[0].count).toBe("1");
      });
    } finally {
      await removeFixture(fixture.email);
    }
  });

  test("blocks a password-reset resend during the 30-second cooldown", async ({
    request,
  }) => {
    const fixture = await createUserAndCode({
      email: uniqueEmail("resend-cooldown"),
      code: RESET_CODE,
      purpose: "reset",
      password: TEST_PASSWORD,
    });
    try {
      const resend = await request.post("/api/auth/forgot-password", {
        data: { email: fixture.email },
      });
      expect(resend.status()).toBe(429);
      const body = await resend.json();
      expect(body).toMatchObject({
        code: "RESEND_COOLDOWN",
      });
      expect(body.retryAfterSeconds).toBeGreaterThan(0);
      expect(body.retryAfterSeconds).toBeLessThanOrEqual(30);
    } finally {
      await removeFixture(fixture.email);
    }
  });
});
