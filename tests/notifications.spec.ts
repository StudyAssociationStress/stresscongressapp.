/**
 * End-to-end API tests: staff publishes notification → attendee sees it.
 *
 * Also verifies that the adminWriteRateLimit middleware does not block
 * legitimate staff actions in the development environment.
 */
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { sendExpoPushNotifications } from "../server/routes";
import { storage } from "../server/storage";
import {
  TEST_ADMIN_EMAIL,
  TEST_STAFF_EMAIL,
  TEST_ATTENDEE_EMAIL,
  TEST_PASSWORD,
} from "./global-setup";
import { WEB_PREVIEW_URL } from "./web-preview";
import { createNotificationTapQueue } from "../client/lib/notificationTapQueue";
import {
  registerPushToken,
  type PushNotificationsModule,
} from "../client/lib/push-registration";

const PUBLISH_UPDATES_PATH =
  "/api/admin/events/e2e-active-event/publish-updates";

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

function isPublishUpdatesResponse(
  response: import("@playwright/test").Response,
): boolean {
  return (
    response.url().includes(PUBLISH_UPDATES_PATH) &&
    response.request().method() === "POST"
  );
}

async function waitForWebPreview(
  request: import("@playwright/test").APIRequestContext,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await request.get(`${WEB_PREVIEW_URL}/status`);
        return response.status();
      },
      {
        message: "Expo web preview did not become ready",
        timeout: 60_000,
        intervals: [250, 500, 1_000, 2_000],
      },
    )
    .toBe(200);
}

async function loginAs(
  request: import("@playwright/test").APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const res = await request.post("/api/auth/login", {
    data: { email, password },
  });
  expect(res.status(), `Login failed for ${email}`).toBe(200);
  const body = await res.json();
  expect(body.token, "Expected a JWT token in login response").toBeTruthy();
  return body.token as string;
}

test.describe("Notification publish flow", () => {
  test("removes permanently invalid device and legacy tokens but keeps retryable failures", async () => {
    const userId = randomUUID();
    const email = `push-cleanup-${userId}@example.test`;
    const qrCodeValue = `push-cleanup-${userId}`;
    const invalidDeviceId = `invalid-${userId}`;
    const retryableDeviceId = `retryable-${userId}`;
    const invalidSessionId = randomUUID();
    const retryableSessionId = randomUUID();
    const invalidToken = `ExponentPushToken[invalid-${userId}]`;
    const retryableToken = `ExponentPushToken[retryable-${userId}]`;

    const eventId = await withDatabase(async (client) => {
      const eventResult = await client.query<{ eventId: string }>(
        `SELECT event_id AS "eventId"
         FROM users
         WHERE email = $1 AND role = 'attendee'
         LIMIT 1`,
        [TEST_ATTENDEE_EMAIL],
      );
      const fixtureEventId = eventResult.rows[0]?.eventId;
      expect(fixtureEventId).toBeTruthy();
      if (!fixtureEventId) throw new Error("Expected a test attendee event.");

      await client.query(
        `INSERT INTO users
           (id, email, name, role, qr_code_value, event_id, push_token)
         VALUES ($1, $2, 'Push cleanup test', 'attendee', $3, $4, $5)`,
        [userId, email, qrCodeValue, fixtureEventId, invalidToken],
      );
      await client.query(
        `INSERT INTO auth_sessions (id, user_id, device_id)
         VALUES ($1, $2, $3), ($4, $2, $5)`,
        [
          invalidSessionId,
          userId,
          invalidDeviceId,
          retryableSessionId,
          retryableDeviceId,
        ],
      );
      await client.query(
        `INSERT INTO notification_devices (user_id, device_id, push_token)
         VALUES ($1, $2, $3), ($1, $4, $5)`,
        [
          userId,
          invalidDeviceId,
          invalidToken,
          retryableDeviceId,
          retryableToken,
        ],
      );

      return fixtureEventId;
    });

    try {
      const selectedBefore = (
        await storage.getAttendeePushTokens(eventId, "attendee")
      ).filter((entry) => entry.userId === userId);
      expect(selectedBefore.map((entry) => entry.token).sort()).toEqual(
        [invalidToken, retryableToken].sort(),
      );

      const delivery = await sendExpoPushNotifications(
        selectedBefore,
        "Cleanup test",
        "Test invalid-token cleanup.",
        {},
        {
          sendBatch: async (messages) => ({
            ok: true,
            status: 200,
            tickets: messages.map((message) =>
              message.to === invalidToken
                ? {
                    status: "error",
                    details: { error: "DeviceNotRegistered" },
                  }
                : {
                    status: "error",
                    details: { error: "MessageRateExceeded" },
                  },
            ),
          }),
        },
      );
      expect(delivery).toEqual({ attempted: 2, sent: 0, failed: 2 });

      const selectedAfter = (
        await storage.getAttendeePushTokens(eventId, "attendee")
      ).filter((entry) => entry.userId === userId);
      expect(selectedAfter.map((entry) => entry.token)).toEqual([
        retryableToken,
      ]);

      const stored = await withDatabase(async (client) => {
        const userResult = await client.query<{ legacyToken: string | null }>(
          `SELECT push_token AS "legacyToken" FROM users WHERE id = $1`,
          [userId],
        );
        const deviceResult = await client.query<{
          deviceId: string;
          token: string | null;
        }>(
          `SELECT device_id AS "deviceId", push_token AS token
           FROM notification_devices
           WHERE user_id = $1`,
          [userId],
        );
        return {
          legacyToken: userResult.rows[0]?.legacyToken,
          deviceTokens: Object.fromEntries(
            deviceResult.rows.map((row) => [row.deviceId, row.token]),
          ),
        };
      });
      expect(stored.legacyToken).toBeNull();
      expect(stored.deviceTokens[invalidDeviceId]).toBeNull();
      expect(stored.deviceTokens[retryableDeviceId]).toBe(retryableToken);
    } finally {
      await withDatabase(async (client) => {
        await client.query("DELETE FROM users WHERE id = $1", [userId]);
      });
    }
  });

  test("publishes live updates silently by default or notifies when opted in", async ({
    request,
  }) => {
    const adminToken = await loginAs(request, TEST_ADMIN_EMAIL, TEST_PASSWORD);
    const adminHeaders = { Authorization: `Bearer ${adminToken}` };
    const eventsResponse = await request.get("/api/admin/events", {
      headers: adminHeaders,
    });
    expect(eventsResponse.status()).toBe(200);
    const events = (await eventsResponse.json()) as {
      id: string;
      status: string;
    }[];
    const eventId = events.find((event) => event.status === "published")?.id;
    expect(eventId).toBeTruthy();

    const silent = await request.post(
      `/api/admin/events/${eventId}/publish-updates`,
      {
        headers: adminHeaders,
        data: { notifyAudience: false },
      },
    );
    expect(silent.status()).toBe(200);
    expect(await silent.json()).toMatchObject({
      notificationsSent: false,
      notificationOutcome: "skipped",
      notificationId: null,
      pushAttempted: 0,
      pushCount: 0,
      pushFailed: 0,
    });

    const notified = await request.post(
      `/api/admin/events/${eventId}/publish-updates`,
      {
        headers: adminHeaders,
        data: { notifyAudience: true },
      },
    );
    expect(notified.status()).toBe(200);
    const notifiedBody = await notified.json();
    expect(notifiedBody).toMatchObject({
      notificationsSent: true,
      notificationOutcome: "sent",
      pushAttempted: 0,
      pushCount: 0,
      pushFailed: 0,
    });
    expect(notifiedBody.notificationId).toBeTruthy();

    const auditRows = await withDatabase(async (client) => {
      const result = await client.query<{ metadata: string }>(
        `SELECT metadata
         FROM admin_audit_log
         WHERE action = 'publish_event_updates'
           AND target_id = $1
         ORDER BY created_at DESC
         LIMIT 2`,
        [eventId],
      );
      return result.rows.map((row) => JSON.parse(row.metadata));
    });
    expect(auditRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventId,
          notifyAudience: false,
          notificationOutcome: "skipped",
          notificationId: null,
          pushAttempted: 0,
        }),
        expect.objectContaining({
          eventId,
          notifyAudience: true,
          notificationOutcome: "sent",
          notificationId: notifiedBody.notificationId,
          pushAttempted: 0,
        }),
      ]),
    );
  });

  test("lets an admin choose silent or notified publishing in the web flow", async ({
    page,
    request,
  }) => {
    const adminToken = await loginAs(request, TEST_ADMIN_EMAIL, TEST_PASSWORD);
    await page.addInitScript((token) => {
      window.localStorage.setItem("auth_token", token);
    }, adminToken);
    await waitForWebPreview(request);
    await page.goto(WEB_PREVIEW_URL, { waitUntil: "domcontentloaded" });

    const publishButton = page.getByTestId(
      "button-publish-updates-event-e2e-active-event",
    );
    await expect(publishButton).toBeVisible();
    await publishButton.click();

    await expect(
      page.getByText("Notify staff and attendees", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Publish Silently", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Current choice: Publish Silently", { exact: true }),
    ).toBeVisible();

    const [silentResponse] = await Promise.all([
      page.waitForResponse(isPublishUpdatesResponse),
      page.getByTestId("button-confirm-publish-updates").click(),
    ]);
    expect(silentResponse.status()).toBe(200);
    expect(silentResponse.request().postDataJSON()).toEqual({
      notifyAudience: false,
    });
    await expect(
      page.getByText("Staff and attendee notifications were skipped.", {
        exact: false,
      }),
    ).toBeVisible();
    await page.getByTestId("button-close-publish-updates-result").click();

    await publishButton.click();
    const notifySwitch = page.getByTestId("switch-notify-publish-updates");
    await expect(notifySwitch).toBeVisible();
    await notifySwitch.click();
    await expect(
      page.getByText("Publish & Notify", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Current choice: Publish & Notify", { exact: true }),
    ).toBeVisible();

    const [notifiedResponse] = await Promise.all([
      page.waitForResponse(isPublishUpdatesResponse),
      page.getByTestId("button-confirm-publish-updates").click(),
    ]);
    expect(notifiedResponse.status()).toBe(200);
    expect(notifiedResponse.request().postDataJSON()).toEqual({
      notifyAudience: true,
    });
    await expect(
      page.getByText("A notification was sent to staff and attendees.", {
        exact: false,
      }),
    ).toBeVisible();
  });

  test("keeps the publish context and shows the server error when publishing is rejected", async ({
    page,
    request,
  }) => {
    const adminToken = await loginAs(request, TEST_ADMIN_EMAIL, TEST_PASSWORD);
    await page.addInitScript((token) => {
      window.localStorage.setItem("auth_token", token);
    }, adminToken);
    await page.route(`**${PUBLISH_UPDATES_PATH}`, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          message: "Live-update publishing is temporarily unavailable.",
        }),
      }),
    );

    await waitForWebPreview(request);
    await page.goto(WEB_PREVIEW_URL, { waitUntil: "domcontentloaded" });

    const publishButton = page.getByTestId(
      "button-publish-updates-event-e2e-active-event",
    );
    await expect(publishButton).toBeVisible();
    await publishButton.click();
    await expect(
      page.getByText("Current choice: Publish Silently", { exact: true }),
    ).toBeVisible();

    const [failedResponse] = await Promise.all([
      page.waitForResponse(isPublishUpdatesResponse),
      page.getByTestId("button-confirm-publish-updates").click(),
    ]);
    expect(failedResponse.status()).toBe(503);
    expect(failedResponse.request().postDataJSON()).toEqual({
      notifyAudience: false,
    });

    await expect(
      page.getByText("Publish Live Updates?", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Publish the latest changes for "E2E Active Event".', {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Live-update publishing is temporarily unavailable.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Updates Published", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("button-close-publish-updates-result"),
    ).toHaveCount(0);
  });

  test("notification taps wait for authenticated navigation before opening history", () => {
    const queue = createNotificationTapQueue();

    queue.remember({
      notification: {
        request: {
          content: {
            data: { screen: "Notifications", eventId: "another-event" },
          },
        },
      },
    });

    expect(queue.consumeIfReady(false)).toBe(false);
    expect(queue.consumeIfReady(true)).toBe(true);
    expect(queue.consumeIfReady(true)).toBe(false);
  });

  test("a listener and cold-start lookup open history once for the same tap", () => {
    const queue = createNotificationTapQueue();
    const listenerResponse = {
      actionIdentifier: "expo.notifications.actions.DEFAULT",
      notification: {
        request: {
          identifier: "notification-tap-1",
          content: {
            data: { screen: "Notifications", eventId: "another-event" },
          },
        },
      },
    };
    const coldStartResponse = {
      ...listenerResponse,
      notification: {
        ...listenerResponse.notification,
        request: {
          ...listenerResponse.notification.request,
          content: {
            ...listenerResponse.notification.request.content,
          },
        },
      },
    };

    queue.remember(listenerResponse);
    queue.remember(coldStartResponse);
    expect(queue.consumeIfReady(false)).toBe(false);
    expect(queue.consumeIfReady(true)).toBe(true);
    expect(queue.consumeIfReady(true)).toBe(false);
  });

  test("distinct notification taps remain queued until authenticated navigation is ready", () => {
    const queue = createNotificationTapQueue();
    const firstResponse = {
      actionIdentifier: "expo.notifications.actions.DEFAULT",
      notification: {
        request: {
          identifier: "notification-tap-1",
          content: { data: { screen: "Notifications" } },
        },
      },
    };
    const secondResponse = {
      ...firstResponse,
      notification: {
        ...firstResponse.notification,
        request: {
          ...firstResponse.notification.request,
          identifier: "notification-tap-2",
        },
      },
    };
    const duplicateFirstResponse = {
      ...firstResponse,
      notification: {
        ...firstResponse.notification,
        request: {
          ...firstResponse.notification.request,
          content: { data: { screen: "Notifications", duplicate: true } },
        },
      },
    };

    queue.remember(firstResponse);
    queue.remember(secondResponse);
    queue.remember(duplicateFirstResponse);

    expect(queue.consumeAllIfReady(false)).toBe(0);
    expect(queue.consumeAllIfReady(true)).toBe(2);
    expect(queue.consumeAllIfReady(true)).toBe(0);
  });

  test("notification preferences require authentication", async ({
    request,
  }) => {
    const res = await request.get(
      "/api/users/notification-preferences?deviceId=test-device",
    );
    expect(res.status()).toBe(401);
  });

  test("notification preferences persist per device", async ({ request }) => {
    const token = await loginAs(request, TEST_ATTENDEE_EMAIL, TEST_PASSWORD);
    const headers = { Authorization: `Bearer ${token}` };
    const deviceId = `e2e-device-${Date.now()}`;
    const save = await request.put("/api/users/notification-preferences", {
      headers,
      data: {
        deviceId,
        pushEnabled: false,
        sessionAlerts: true,
      },
    });
    expect(save.status()).toBe(200);
    const load = await request.get(
      `/api/users/notification-preferences?deviceId=${deviceId}`,
      { headers },
    );
    expect(load.status()).toBe(200);
    expect(await load.json()).toMatchObject({
      pushEnabled: false,
      sessionAlerts: true,
    });

    const update = await request.put("/api/users/notification-preferences", {
      headers,
      data: {
        deviceId,
        pushEnabled: true,
        sessionAlerts: false,
      },
    });
    expect(update.status()).toBe(200);

    const updatedLoad = await request.get(
      `/api/users/notification-preferences?deviceId=${deviceId}`,
      { headers },
    );
    expect(updatedLoad.status()).toBe(200);
    expect(await updatedLoad.json()).toMatchObject({
      pushEnabled: true,
      sessionAlerts: false,
    });
  });

  test("countdown notifications are retired from creation and attendee history", async ({
    request,
  }) => {
    const staffToken = await loginAs(request, TEST_STAFF_EMAIL, TEST_PASSWORD);
    const staffHeaders = { Authorization: `Bearer ${staffToken}` };
    const rejected = await request.post("/api/notifications", {
      headers: staffHeaders,
      data: {
        title: "Legacy countdown",
        message: "This must not be created",
        type: "event_reminder",
        targetRole: "attendee",
      },
    });
    expect(rejected.status()).toBe(400);

    const legacyNotificationId = `legacy-countdown-${Date.now()}`;
    await withDatabase(async (client) => {
      const result = await client.query<{ eventId: string }>(
        `SELECT event_id AS "eventId"
         FROM users
         WHERE email = $1 AND role = 'attendee'
         LIMIT 1`,
        [TEST_ATTENDEE_EMAIL],
      );
      const eventId = result.rows[0]?.eventId;
      expect(eventId).toBeTruthy();
      await client.query(
        `INSERT INTO notifications
          (id, title, message, type, target_role, event_id)
         VALUES ($1, $2, $3, 'event_reminder', 'attendee', $4)`,
        [
          legacyNotificationId,
          "Legacy countdown",
          "This must stay hidden",
          eventId,
        ],
      );
    });

    try {
      const attendeeToken = await loginAs(
        request,
        TEST_ATTENDEE_EMAIL,
        TEST_PASSWORD,
      );
      const response = await request.get("/api/notifications", {
        headers: { Authorization: `Bearer ${attendeeToken}` },
      });
      expect(response.status()).toBe(200);
      expect(
        (await response.json()).some(
          (notification: { id: string }) =>
            notification.id === legacyNotificationId,
        ),
      ).toBe(false);
    } finally {
      await withDatabase(async (client) => {
        await client.query(
          "DELETE FROM user_notifications WHERE notification_id = $1",
          [legacyNotificationId],
        );
        await client.query("DELETE FROM notifications WHERE id = $1", [
          legacyNotificationId,
        ]);
      });
    }
  });

  test("staff can publish a notification and it appears for the attendee", async ({
    request,
  }) => {
    const staffToken = await loginAs(request, TEST_STAFF_EMAIL, TEST_PASSWORD);

    // Unique title to find this notification among any existing ones
    const uniqueTitle = `E2E Test Notification ${Date.now()}`;

    // Staff publishes the notification
    const pubRes = await request.post("/api/notifications", {
      headers: { Authorization: `Bearer ${staffToken}` },
      data: {
        title: uniqueTitle,
        message: "This is an automated e2e test notification.",
        type: "announcement",
        targetRole: null, // targets everyone
      },
    });
    expect(pubRes.status()).toBe(200);
    const pubBody = await pubRes.json();
    expect(pubBody.id).toBeTruthy();
    expect(pubBody.title).toBe(uniqueTitle);

    // Attendee fetches their notification list and should see the new one
    const attendeeToken = await loginAs(
      request,
      TEST_ATTENDEE_EMAIL,
      TEST_PASSWORD,
    );

    const listRes = await request.get("/api/notifications", {
      headers: { Authorization: `Bearer ${attendeeToken}` },
    });
    expect(listRes.status()).toBe(200);
    const notifications: { title: string }[] = await listRes.json();

    const found = notifications.some((n) => n.title === uniqueTitle);
    expect(
      found,
      `Expected to find notification titled "${uniqueTitle}" in attendee's list`,
    ).toBe(true);
  });

  test("staff-only notification is not visible to an attendee", async ({
    request,
  }) => {
    const staffToken = await loginAs(request, TEST_STAFF_EMAIL, TEST_PASSWORD);

    const uniqueTitle = `E2E Staff-Only Notif ${Date.now()}`;

    const pubRes = await request.post("/api/notifications", {
      headers: { Authorization: `Bearer ${staffToken}` },
      data: {
        title: uniqueTitle,
        message: "This should only reach staff.",
        type: "reminder",
        targetRole: "staff",
      },
    });
    expect(pubRes.status()).toBe(200);

    // Attendee should NOT see this notification
    const attendeeToken = await loginAs(
      request,
      TEST_ATTENDEE_EMAIL,
      TEST_PASSWORD,
    );
    const listRes = await request.get("/api/notifications", {
      headers: { Authorization: `Bearer ${attendeeToken}` },
    });
    expect(listRes.status()).toBe(200);
    const notifications: { title: string }[] = await listRes.json();

    const found = notifications.some((n) => n.title === uniqueTitle);
    expect(
      found,
      "Staff-only notification should not appear in attendee list",
    ).toBe(false);
  });

  test("attendee-only notification is visible to an attendee", async ({
    request,
  }) => {
    const staffToken = await loginAs(request, TEST_STAFF_EMAIL, TEST_PASSWORD);

    const uniqueTitle = `E2E Attendee-Only Notif ${Date.now()}`;

    await request.post("/api/notifications", {
      headers: { Authorization: `Bearer ${staffToken}` },
      data: {
        title: uniqueTitle,
        message: "This should reach attendees only.",
        type: "announcement",
        targetRole: "attendee",
      },
    });

    const attendeeToken = await loginAs(
      request,
      TEST_ATTENDEE_EMAIL,
      TEST_PASSWORD,
    );
    const listRes = await request.get("/api/notifications", {
      headers: { Authorization: `Bearer ${attendeeToken}` },
    });
    const notifications: { title: string }[] = await listRes.json();

    const found = notifications.some((n) => n.title === uniqueTitle);
    expect(
      found,
      "Attendee-only notification should appear in attendee list",
    ).toBe(true);
  });

  test("publishing a notification without a token is rejected (401)", async ({
    request,
  }) => {
    const res = await request.post("/api/notifications", {
      data: {
        title: "Unauthorized Notif",
        message: "Should be blocked.",
        type: "announcement",
      },
    });
    expect(res.status()).toBe(401);
  });

  test("an attendee cannot publish a notification (403)", async ({
    request,
  }) => {
    const attendeeToken = await loginAs(
      request,
      TEST_ATTENDEE_EMAIL,
      TEST_PASSWORD,
    );

    const res = await request.post("/api/notifications", {
      headers: { Authorization: `Bearer ${attendeeToken}` },
      data: {
        title: "Attendee Trying to Publish",
        message: "Should be forbidden.",
        type: "announcement",
      },
    });
    expect(res.status()).toBe(403);
  });

  test("attendee can mark all notifications read and dismiss one", async ({
    request,
  }) => {
    const staffToken = await loginAs(request, TEST_STAFF_EMAIL, TEST_PASSWORD);
    const attendeeToken = await loginAs(
      request,
      TEST_ATTENDEE_EMAIL,
      TEST_PASSWORD,
    );
    const title = `E2E Read All ${Date.now()}`;
    const publish = await request.post("/api/notifications", {
      headers: { Authorization: `Bearer ${staffToken}` },
      data: {
        title,
        message: "Read all and dismiss test.",
        type: "announcement",
      },
    });
    expect(publish.status()).toBe(200);
    const notification = await publish.json();

    const readAll = await request.post("/api/notifications/read-all", {
      headers: { Authorization: `Bearer ${attendeeToken}` },
    });
    expect(readAll.status()).toBe(200);

    const afterReadAll = await request.get("/api/notifications", {
      headers: { Authorization: `Bearer ${attendeeToken}` },
    });
    const readNotifications = await afterReadAll.json();
    expect(
      readNotifications.find(
        (item: { id: string }) => item.id === notification.id,
      )?.read,
    ).toBe(true);

    const dismiss = await request.delete(
      `/api/notifications/${notification.id}`,
      {
        headers: { Authorization: `Bearer ${attendeeToken}` },
      },
    );
    expect(dismiss.status()).toBe(200);

    const afterDismiss = await request.get("/api/notifications", {
      headers: { Authorization: `Bearer ${attendeeToken}` },
    });
    expect(
      (await afterDismiss.json()).some(
        (item: { id: string }) => item.id === notification.id,
      ),
    ).toBe(false);
  });

  test("concurrent notification reads create one receipt", async ({
    request,
  }) => {
    const staffToken = await loginAs(request, TEST_STAFF_EMAIL, TEST_PASSWORD);
    const attendeeToken = await loginAs(
      request,
      TEST_ATTENDEE_EMAIL,
      TEST_PASSWORD,
    );
    const title = `E2E Concurrent Read ${Date.now()}`;
    const publish = await request.post("/api/notifications", {
      headers: { Authorization: `Bearer ${staffToken}` },
      data: {
        title,
        message: "Concurrent read receipt test.",
        type: "announcement",
      },
    });
    expect(publish.status()).toBe(200);
    const notification = await publish.json();

    await Promise.all(
      Array.from({ length: 8 }, () =>
        request.post(`/api/notifications/${notification.id}/read`, {
          headers: { Authorization: `Bearer ${attendeeToken}` },
        }),
      ),
    );

    const receiptCount = await withDatabase(async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM user_notifications
         WHERE user_id = (
           SELECT id FROM users WHERE lower(email) = lower($1)
         )
           AND notification_id = $2`,
        [TEST_ATTENDEE_EMAIL, notification.id],
      );
      return Number(result.rows[0]?.count || 0);
    });
    expect(receiptCount).toBe(1);
  });

  test("attendee history remains available when push registration fails", async ({
    request,
  }) => {
    const attendeeLogin = await request.post("/api/auth/login", {
      data: {
        email: TEST_ATTENDEE_EMAIL,
        password: TEST_PASSWORD,
        deviceId: `push-failure-${Date.now()}`,
      },
    });
    expect(attendeeLogin.status()).toBe(200);
    const attendeeBody = await attendeeLogin.json();

    const nativeNotifications: PushNotificationsModule = {
      getPermissionsAsync: async () => ({ status: "granted" }),
      requestPermissionsAsync: async () => ({ status: "granted" }),
      getExpoPushTokenAsync: async () => ({
        data: "ExponentPushToken[never-exposed]",
      }),
    };
    const warnings: string[] = [];

    const registered = await registerPushToken(attendeeBody.token, {
      isSupported: true,
      loadNotifications: async () => nativeNotifications,
      getDeviceId: async () => "push-registration-failure-device",
      getApiUrl: () => "https://push-endpoint.test",
      fetchWithTimeout: async () => {
        throw new Error("simulated push endpoint failure");
      },
      warn: (message) => warnings.push(message),
    });

    expect(registered).toBe(false);
    expect(warnings).toEqual([
      "[Push] Token registration unavailable; continuing without push.",
    ]);

    const history = await request.get("/api/notifications", {
      headers: { Authorization: `Bearer ${attendeeBody.token}` },
    });
    expect(history.status()).toBe(200);
  });
});
