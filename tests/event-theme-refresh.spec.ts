import { test, expect } from "@playwright/test";
import { WEB_PREVIEW_URL } from "./web-preview";

test.describe("login event theme refresh", () => {
  test("discovers a newly published event without a stored session", async ({
    page,
  }) => {
    let allowLiveEvent = false;
    let activeEventRequests = 0;
    const liveEvent = {
      id: "newly-live-event",
      name: "Newly Published Event",
      year: 2026,
      displayDate: "September 17, 2026",
      startDate: "2026-09-17",
      endDate: "2026-09-18",
      scheduleStart: null,
      scheduleEnd: null,
      location: "Test Venue",
      logoUrl: null,
      logoShape: "square",
      primaryColor: "#7C3AED",
      accentColor: "#16A34A",
      gradientStart: "#102A43",
      gradientEnd: "#243B53",
      tagline: "Now live",
      showYearOnLogin: true,
      lastPublishedAt: "2026-09-20T10:00:00.000Z",
    };

    await page.route("**/api/events/active**", async (route) => {
      activeEventRequests += 1;
      if (!allowLiveEvent) {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ message: "No active event" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(liveEvent),
      });
    });

    await page.goto(WEB_PREVIEW_URL);
    await expect(page.getByTestId("login-event-name")).toHaveText(
      "No live event",
    );
    const requestsBeforePublish = activeEventRequests;

    allowLiveEvent = true;

    await expect(page.getByTestId("login-event-name")).toHaveText(
      "Newly Published Event",
      { timeout: 20_000 },
    );
    await expect(page.getByTestId("login-event-year")).toHaveText("2026");
    await expect(page.getByTestId("login-event-tagline")).toHaveText(
      "Now live",
    );
    await expect(page.getByTestId("login-form")).toHaveCSS(
      "border-top-color",
      "rgb(124, 58, 237)",
    );
    await expect(page.getByTestId("button-continue")).toHaveCSS(
      "background-color",
      "rgb(22, 163, 74)",
    );
    await expect(page.getByTestId("login-gradient")).toHaveCSS(
      "background-image",
      /rgb\(16, 42, 67\).*rgb\(36, 59, 83\)/,
    );
    expect(activeEventRequests).toBeGreaterThan(requestsBeforePublish);
  });

  test("refreshes an already-live login after Publish Updates changes the version", async ({
    page,
  }) => {
    let showUpdatedEvent = false;
    const firstPublishedEvent = {
      id: "already-live-event",
      name: "Published Event",
      year: 2026,
      displayDate: "September 20, 2026",
      startDate: "2026-09-20",
      endDate: "2026-09-21",
      scheduleStart: null,
      scheduleEnd: null,
      location: "Original Venue",
      logoUrl: null,
      logoShape: "square",
      primaryColor: "#7C3AED",
      accentColor: "#16A34A",
      gradientStart: "#102A43",
      gradientEnd: "#243B53",
      tagline: "Original live content",
      showYearOnLogin: true,
      lastPublishedAt: "2026-09-20T10:00:00.000Z",
    };
    const updatedPublishedEvent = {
      ...firstPublishedEvent,
      name: "Updated Published Event",
      displayDate: "September 21, 2026",
      location: "Updated Venue",
      tagline: "Updated live content",
      primaryColor: "#DB2777",
      accentColor: "#0891B2",
      lastPublishedAt: "2026-09-20T10:05:00.000Z",
    };

    await page.route("**/api/events/active**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          showUpdatedEvent ? updatedPublishedEvent : firstPublishedEvent,
        ),
      });
    });

    await page.goto(WEB_PREVIEW_URL);
    await expect(page.getByTestId("login-event-name")).toHaveText(
      "Published Event",
    );
    await expect(page.getByTestId("login-event-tagline")).toHaveText(
      "Original live content",
    );

    showUpdatedEvent = true;

    await expect(page.getByTestId("login-event-name")).toHaveText(
      "Updated Published Event",
      { timeout: 20_000 },
    );
    await expect(page.getByTestId("login-event-tagline")).toHaveText(
      "Updated live content",
    );
    await expect(page.getByTestId("login-form")).toHaveCSS(
      "border-top-color",
      "rgb(219, 39, 119)",
    );
    await expect(page.getByTestId("button-continue")).toHaveCSS(
      "background-color",
      "rgb(8, 145, 178)",
    );
  });
});
