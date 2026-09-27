import { test, expect, APIRequestContext, Page } from "@playwright/test";
import { WEB_PREVIEW_URL } from "./web-preview";
import {
  TEST_ADMIN_EMAIL,
  TEST_ATTENDEE_EMAIL,
  TEST_PASSWORD,
} from "./global-setup";

async function loginAs(
  request: APIRequestContext,
  email: string,
): Promise<string> {
  const response = await request.post("/api/auth/login", {
    data: { email, password: TEST_PASSWORD },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).token as string;
}

test.describe("event schedule hours", () => {
  let adminToken: string;
  let selectedEventId: string;
  let otherEventId: string;

  test.beforeAll(async ({ request }) => {
    adminToken = await loginAs(request, TEST_ADMIN_EMAIL);
    const headers = { Authorization: `Bearer ${adminToken}` };

    const selected = await request.post("/api/admin/events", {
      headers,
      data: {
        name: `Schedule Hours Selected ${Date.now()}`,
        year: 2197,
        logoUrl: "https://example.test/wide-logo.png",
      },
    });
    expect(selected.status()).toBe(200);
    selectedEventId = (await selected.json()).id;

    const other = await request.post("/api/admin/events", {
      headers,
      data: {
        name: `Schedule Hours Other ${Date.now()}`,
        year: 2196,
        scheduleStart: null,
        scheduleEnd: null,
      },
    });
    expect(other.status()).toBe(200);
    otherEventId = (await other.json()).id;
  });

  test.afterAll(async ({ request }) => {
    const headers = { Authorization: `Bearer ${adminToken}` };
    for (const id of [selectedEventId, otherEventId]) {
      if (id) await request.delete(`/api/admin/events/${id}`, { headers });
    }
  });

  test("saves and reloads valid hours without leaking them to another event", async ({
    request,
  }) => {
    const headers = { Authorization: `Bearer ${adminToken}` };
    const update = await request.put(`/api/admin/events/${selectedEventId}`, {
      headers,
      data: { scheduleStart: "09:30", scheduleEnd: "18:45" },
    });
    expect(update.status()).toBe(200);
    await expect(update.json()).resolves.toMatchObject({
      id: selectedEventId,
      scheduleStart: "09:30",
      scheduleEnd: "18:45",
    });

    const events = await request.get("/api/admin/events", { headers });
    expect(events.status()).toBe(200);
    const byId = new Map(
      (await events.json()).map((event: { id: string }) => [event.id, event]),
    );
    expect(byId.get(selectedEventId)).toMatchObject({
      scheduleStart: "09:30",
      scheduleEnd: "18:45",
    });
    expect(byId.get(otherEventId)).toMatchObject({
      scheduleStart: null,
      scheduleEnd: null,
    });
  });

  test("allows both hours to be cleared for announcement fallback", async ({
    request,
  }) => {
    const response = await request.put(`/api/admin/events/${selectedEventId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { scheduleStart: null, scheduleEnd: null },
    });
    expect(response.status()).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      scheduleStart: null,
      scheduleEnd: null,
    });
  });

  for (const [label, data] of [
    ["missing end", { scheduleStart: "09:00", scheduleEnd: null }],
    ["invalid start", { scheduleStart: "9:00", scheduleEnd: "17:00" }],
    ["invalid end", { scheduleStart: "09:00", scheduleEnd: "25:00" }],
    ["reversed hours", { scheduleStart: "18:00", scheduleEnd: "09:00" }],
    ["equal hours", { scheduleStart: "09:00", scheduleEnd: "09:00" }],
  ] as const) {
    test(`rejects ${label}`, async ({ request }) => {
      const response = await request.put(
        `/api/admin/events/${selectedEventId}`,
        {
          headers: { Authorization: `Bearer ${adminToken}` },
          data,
        },
      );
      expect(response.status()).toBe(400);
    });
  }
});

const attendeeTheme = {
  id: "device-check-event",
  name: "Device Check Congress",
  year: 2026,
  displayDate: "August 22, 2026",
  startDate: "2026-08-22",
  endDate: "2026-08-23",
  scheduleStart: "09:30",
  scheduleEnd: "18:45",
  location: "Device Check Venue",
  logoUrl:
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='80'%3E%3Crect width='320' height='80' fill='blue'/%3E%3C/svg%3E",
  primaryColor: "#0c0057",
  accentColor: "#f78f1e",
  gradientStart: "#0c0057",
  gradientEnd: "#1a0a7a",
};

async function mockTheme(
  page: Page,
  schedule: { start: string | null; end: string | null },
) {
  await page.route("**/api/events/active**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...attendeeTheme,
        scheduleStart: schedule.start,
        scheduleEnd: schedule.end,
      }),
    });
  });
}

test.describe("attendee display on device-sized web layouts", () => {
  test("keeps the wide logo proportional on the login screen", async ({
    page,
  }) => {
    await mockTheme(page, { start: null, end: null });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(WEB_PREVIEW_URL);
    const logo = page.getByTestId("event-logo");
    await expect(logo).toBeVisible();
    const box = await logo.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThan(box!.height);
  });

  test("shows configured hours, announcement fallback, and wide logo on attendee home", async ({
    page,
    request,
  }) => {
    const attendeeToken = await loginAs(request, TEST_ATTENDEE_EMAIL);
    await page.addInitScript((token) => {
      window.localStorage.setItem("auth_token", token);
    }, attendeeToken);
    await mockTheme(page, { start: "09:30", end: "18:45" });
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(WEB_PREVIEW_URL);
    await expect(
      page.getByText("09:30 – 18:45", { exact: true }),
    ).toBeVisible();
    const logo = page.getByTestId("event-logo");
    await expect(logo).toBeVisible();
    const box = await logo.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThan(box!.height);

    await page.route("**/api/events/active**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...attendeeTheme,
          scheduleStart: null,
          scheduleEnd: null,
        }),
      });
    });
    await page.reload();
    await expect(
      page.getByText("Schedule to be announced", { exact: true }),
    ).toBeVisible();
  });

  test("opens the attendee QR pass from the persistent quick-access button", async ({
    page,
    request,
  }) => {
    const attendeeToken = await loginAs(request, TEST_ATTENDEE_EMAIL);
    await page.addInitScript((token) => {
      window.localStorage.setItem("auth_token", token);
    }, attendeeToken);
    await mockTheme(page, { start: "09:30", end: "18:45" });
    await page.goto(WEB_PREVIEW_URL);

    const quickQrButton = page.getByTestId("button-quick-qr");
    await expect(quickQrButton).toBeVisible();
    await quickQrButton.click();
    await expect(page.getByTestId("quick-qr-modal")).toBeVisible();
    await expect(
      page.getByText("Show this to staff for check-in", { exact: true }),
    ).toBeVisible();

    await page.getByTestId("button-close-quick-qr").click();
    await expect(page.getByTestId("quick-qr-modal")).toHaveCount(0);
  });
});

const imageFramingFixtures = [
  { label: "portrait", width: 90, height: 360 },
  { label: "square", width: 240, height: 240 },
  { label: "landscape", width: 360, height: 90 },
] as const;

function createLogoDataUri(
  width: number,
  height: number,
  color: string,
): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${color}"/><circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 4}" fill="white"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

async function expectImageAspectRatio(
  page: Page,
  testId: string,
  expectedRatio: number,
): Promise<void> {
  const image = page.getByTestId(testId);
  await expect(image).toBeVisible();
  await expect
    .poll(async () => {
      const bounds = await image.boundingBox();
      return bounds && bounds.height > 0 ? bounds.width / bounds.height : 0;
    })
    .toBeCloseTo(expectedRatio, 1);
}

for (const fixture of imageFramingFixtures) {
  test(`keeps ${fixture.label} event images proportional on login and attendee home`, async ({
    page,
    request,
  }) => {
    const expectedRatio = fixture.width / fixture.height;
    let activeEvent = {
      ...attendeeTheme,
      name: `Framing ${fixture.label} Event`,
      logoUrl: createLogoDataUri(fixture.width, fixture.height, "#2563EB"),
      logoShape: "square",
      logoZoom: 130,
      logoOffsetX: 14,
      logoOffsetY: -10,
      lastPublishedAt: "2026-09-24T10:00:00.000Z",
    };

    await page.route("**/api/events/active**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(activeEvent),
      });
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(WEB_PREVIEW_URL);
    await expect(page.getByTestId("login-event-name")).toHaveText(
      activeEvent.name,
    );
    await expectImageAspectRatio(page, "event-logo", expectedRatio);

    await page.setViewportSize({ width: 1024, height: 900 });
    await expectImageAspectRatio(page, "event-logo", expectedRatio);

    const attendeeToken = await loginAs(request, TEST_ATTENDEE_EMAIL);
    await page.evaluate((token) => {
      window.localStorage.setItem("auth_token", token);
    }, attendeeToken);
    await page.reload();
    await expect(page.getByTestId("attendee-event-name")).toHaveText(
      activeEvent.name,
    );
    await expectImageAspectRatio(page, "event-logo", expectedRatio);

    await page.setViewportSize({ width: 390, height: 844 });
    await expectImageAspectRatio(page, "event-logo", expectedRatio);
  });
}
