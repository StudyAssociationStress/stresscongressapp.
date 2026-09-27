import { test, expect, APIRequestContext, Page } from "@playwright/test";
import { TEST_ADMIN_EMAIL, TEST_PASSWORD } from "./global-setup";
import { WEB_PREVIEW_URL } from "./web-preview";

async function loginAsAdmin(request: APIRequestContext): Promise<string> {
  const response = await request.post("/api/auth/login", {
    data: { email: TEST_ADMIN_EMAIL, password: TEST_PASSWORD },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).token as string;
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

test.describe("admin appearance form", () => {
  let adminToken = "";
  let eventId = "";
  let otherEventId = "";

  test.beforeAll(async ({ request }) => {
    adminToken = await loginAsAdmin(request);
    const response = await request.post("/api/admin/events", {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        name: `Appearance Form Test ${Date.now()}`,
        year: 2500,
      },
    });
    expect(response.status()).toBe(200);
    eventId = (await response.json()).id;
  });

  test.afterAll(async ({ request }) => {
    for (const id of [otherEventId, eventId]) {
      if (!id) continue;
      const response = await request.delete(`/api/admin/events/${id}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(response.status()).toBe(200);
    }
  });

  test("rejects an overlong tagline with a tagline-specific validation error", async ({
    request,
  }) => {
    const response = await request.put(`/api/admin/events/${eventId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { tagline: "X".repeat(301) },
    });

    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: "Tagline must be 300 characters or fewer.",
      issues: {
        tagline: ["Tagline must be 300 characters or fewer."],
      },
    });
  });

  test("shows the tagline limit, caps input, and saves a one-character tagline", async ({
    page,
  }) => {
    await page.addInitScript((authToken) => {
      if (!window.localStorage.getItem("appearance_test_auth_override")) {
        window.localStorage.setItem("auth_token", authToken);
      }
    }, adminToken);
    await page.goto(WEB_PREVIEW_URL);

    const appearanceButton = page.getByTestId(
      `button-appearance-event-${eventId}`,
    );
    await expect(appearanceButton).toBeVisible();
    await appearanceButton.click();

    const taglineInput = page.getByTestId("input-appearance-tagline");
    await expect(taglineInput).toBeVisible();
    await taglineInput.fill("");
    await expect(
      page.getByText("Short text shown on the About screen (0/300)", {
        exact: true,
      }),
    ).toBeVisible();

    await taglineInput.fill("X".repeat(301));
    await expect(taglineInput).toHaveValue("X".repeat(300));
    await expect(
      page.getByText("Short text shown on the About screen (300/300)", {
        exact: true,
      }),
    ).toBeVisible();

    await taglineInput.fill("X");
    const saveResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/admin/events/${eventId}`) &&
        response.request().method() === "PUT",
    );
    await page.getByTestId("button-save-appearance").click();

    const response = await saveResponse;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toMatchObject({ tagline: "X" });

    const eventsResponse = await page.request.get("/api/admin/events", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(eventsResponse.status()).toBe(200);
    const savedEvent = (await eventsResponse.json()).find(
      (event: { id: string }) => event.id === eventId,
    );
    expect(savedEvent.tagline).toBe("X");

    const attendeeResponse = await page.request.post(
      `/api/admin/users?eventId=${eventId}`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: {
          name: "Appearance Tagline Attendee",
          email: `appearance-tagline-${Date.now()}@stress2026.test`,
          role: "attendee",
        },
      },
    );
    expect(attendeeResponse.status()).toBe(201);
    const attendee = await attendeeResponse.json();

    const passwordResponse = await page.request.put(
      `/api/admin/users/${attendee.id}?eventId=${eventId}`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { password: TEST_PASSWORD },
      },
    );
    expect(passwordResponse.status()).toBe(200);

    const publishResponse = await page.request.post(
      `/api/admin/events/${eventId}/publish`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { confirmStarterTimetable: true },
      },
    );
    expect(publishResponse.status()).toBe(200);

    await page.evaluate(() => {
      window.localStorage.setItem("appearance_test_auth_override", "true");
      window.localStorage.removeItem("auth_token");
    });
    await page.reload();
    await expect(page.getByTestId("login-event-tagline")).toHaveText("X");

    const attendeeLoginResponse = await page.request.post("/api/auth/login", {
      data: { email: attendee.email, password: TEST_PASSWORD },
    });
    expect(attendeeLoginResponse.status()).toBe(200);
    const attendeeToken = (await attendeeLoginResponse.json()).token as string;

    await page.evaluate((authToken) => {
      window.localStorage.setItem("auth_token", authToken);
    }, attendeeToken);
    await page.reload();
    await expect(page.getByTestId("attendee-event-tagline")).toHaveText("X");
  });

  test("keeps saved event image framing in sync with the preview and selected event", async ({
    page,
    request,
  }) => {
    const headers = { Authorization: `Bearer ${adminToken}` };
    const logoUrl =
      "data:image/svg+xml," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="90" viewBox="0 0 360 90"><rect width="360" height="90" fill="#2563eb"/><circle cx="180" cy="45" r="24" fill="white"/></svg>',
      );
    const otherLogoUrl =
      "data:image/svg+xml," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="360" viewBox="0 0 90 360"><rect width="90" height="360" fill="#7c3aed"/><circle cx="45" cy="180" r="24" fill="white"/></svg>',
      );

    const otherEventResponse = await request.post("/api/admin/events", {
      headers,
      data: { name: "Appearance Framing Other Event", year: 2501 },
    });
    expect(otherEventResponse.status()).toBe(200);
    otherEventId = (await otherEventResponse.json()).id;

    for (const [id, image, framing] of [
      [eventId, logoUrl, { logoZoom: 140, logoOffsetX: 18, logoOffsetY: -12 }],
      [
        otherEventId,
        otherLogoUrl,
        { logoZoom: 90, logoOffsetX: -24, logoOffsetY: 16 },
      ],
    ] as const) {
      const update = await request.put(`/api/admin/events/${id}`, {
        headers,
        data: { logoUrl: image, logoShape: "square", ...framing },
      });
      expect(update.status()).toBe(200);
    }

    await page.addInitScript((authToken) => {
      window.localStorage.setItem("auth_token", authToken);
    }, adminToken);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(WEB_PREVIEW_URL);

    const firstAppearanceButton = page.getByTestId(
      `button-appearance-event-${eventId}`,
    );
    await expect(firstAppearanceButton).toBeVisible();
    await firstAppearanceButton.click();
    await expect(page.getByText("140%", { exact: true })).toBeVisible();

    const editorImage = page.getByTestId("appearance-editor-image");
    await expect(editorImage).toBeVisible();
    await expectImageAspectRatio(page, "appearance-editor-image", 4);
    await expectImageAspectRatio(page, "appearance-preview-login-image", 4);

    await page.getByText("Home screen", { exact: true }).click();
    await expectImageAspectRatio(page, "appearance-preview-home-image", 4);
    await page.getByLabel("Zoom logo in").click();
    await expect(page.getByText("150%", { exact: true })).toBeVisible();
    const zoomedFrame = await page
      .getByTestId("appearance-editor-frame")
      .boundingBox();
    const zoomedPicture = await editorImage.boundingBox();
    expect(zoomedFrame).toBeTruthy();
    expect(zoomedPicture).toBeTruthy();
    expect(zoomedPicture!.width).toBeGreaterThan(zoomedFrame!.width);
    expect(zoomedPicture!.height).toBeGreaterThan(zoomedFrame!.height);
    await page.getByLabel("Zoom logo out").click();
    await expect(page.getByText("140%", { exact: true })).toBeVisible();
    await page.getByLabel("Zoom logo in").click();
    await expect(page.getByText("150%", { exact: true })).toBeVisible();

    const frame = await page
      .getByTestId("appearance-editor-frame")
      .boundingBox();
    expect(frame).toBeTruthy();
    await page.mouse.move(
      frame!.x + frame!.width / 2,
      frame!.y + frame!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      frame!.x + frame!.width / 2 + 24,
      frame!.y + frame!.height / 2 + 18,
      { steps: 4 },
    );
    await page.mouse.up();

    const saveResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/admin/events/${eventId}`) &&
        response.request().method() === "PUT",
    );
    await page.getByTestId("button-save-appearance").click();
    const savedResponse = await saveResponse;
    expect(savedResponse.status()).toBe(200);
    expect(savedResponse.request().postDataJSON()).toMatchObject({
      logoZoom: 150,
    });
    expect(savedResponse.request().postDataJSON().logoOffsetX).not.toBe(18);
    expect(savedResponse.request().postDataJSON().logoOffsetY).not.toBe(-12);
    const savedEventsResponse = await request.get("/api/admin/events", {
      headers,
    });
    expect(savedEventsResponse.status()).toBe(200);
    const savedEvent = (await savedEventsResponse.json()).find(
      (candidate: { id: string }) => candidate.id === eventId,
    );
    expect(savedEvent).toMatchObject({
      logoZoom: 150,
    });
    expect(savedEvent.logoOffsetX).not.toBe(18);
    expect(savedEvent.logoOffsetY).not.toBe(-12);

    await page.reload();
    await page.getByTestId(`button-appearance-event-${eventId}`).click();
    await expect(page.getByText("150%", { exact: true })).toBeVisible();
    await page.getByTestId("button-close-appearance").click();

    await page.getByTestId(`button-appearance-event-${otherEventId}`).click();
    await expect(page.getByText("90%", { exact: true })).toBeVisible();
    await expectImageAspectRatio(page, "appearance-editor-image", 0.25);
    const logoFrame = await page
      .getByTestId("appearance-editor-frame")
      .boundingBox();
    const logoPicture = await page
      .getByTestId("appearance-editor-image")
      .boundingBox();
    expect(logoFrame).toBeTruthy();
    expect(logoPicture).toBeTruthy();
    expect(logoPicture!.width).toBeLessThan(logoFrame!.width);
    expect(logoPicture!.height).toBeLessThan(logoFrame!.height);
    await page.getByLabel("Zoom logo out").click();
    await expect(page.getByText("80%", { exact: true })).toBeVisible();
    const lowZoomSave = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/admin/events/${otherEventId}`) &&
        response.request().method() === "PUT",
    );
    await page.getByTestId("button-save-appearance").click();
    const lowZoomResponse = await lowZoomSave;
    expect(lowZoomResponse.status()).toBe(200);
    expect(lowZoomResponse.request().postDataJSON()).toMatchObject({
      logoZoom: 80,
    });
  });
});
