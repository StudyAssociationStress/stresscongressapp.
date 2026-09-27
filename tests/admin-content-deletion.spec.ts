import { test, expect, Page, APIRequestContext } from "@playwright/test";
import { TEST_ADMIN_EMAIL, TEST_PASSWORD } from "./global-setup";
import { WEB_PREVIEW_URL } from "./web-preview";

async function loginAsAdmin(request: APIRequestContext): Promise<string> {
  const response = await request.post("/api/auth/login", {
    data: { email: TEST_ADMIN_EMAIL, password: TEST_PASSWORD },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).token as string;
}

async function openAdminScreen(page: Page, label: string) {
  const menuItem = page.getByText(label, { exact: true });
  if (!(await menuItem.isVisible().catch(() => false))) {
    await page.getByTestId("button-open-drawer").first().click({ force: true });
  }
  await menuItem.evaluate((element) => (element as HTMLElement).click());
}

async function deleteWithConfirmation(
  page: Page,
  buttonTestId: string,
  shouldConfirm: boolean,
) {
  await page.evaluate((result) => {
    (window as any).__e2eConfirmResult = result;
  }, shouldConfirm);
  await page.getByTestId(buttonTestId).click({ force: true });
  expect(
    await page.evaluate(() => (window as any).__e2eConfirmCalls),
  ).toBeGreaterThan(0);
}

test.describe("admin single-item deletion", () => {
  let adminToken: string;
  let eventId: string;
  const speakerIds: string[] = [];
  const companyIds: string[] = [];
  const timetableIds: string[] = [];

  test.beforeAll(async ({ request }) => {
    adminToken = await loginAsAdmin(request);
    const headers = { Authorization: `Bearer ${adminToken}` };
    const eventResponse = await request.post("/api/admin/events", {
      headers,
      data: { name: `Content Deletion ${Date.now()}`, year: 2198 },
    });
    expect(eventResponse.status()).toBe(200);
    eventId = (await eventResponse.json()).id;

    for (const name of [
      "Delete Speaker Cancel",
      "Delete Speaker Success",
      "Delete Speaker Failure",
    ]) {
      const response = await request.post(
        `/api/admin/speakers?eventId=${eventId}`,
        {
          headers,
          data: { name, eventId },
        },
      );
      expect(response.status()).toBe(200);
      speakerIds.push((await response.json()).id);
    }

    for (const name of [
      "Delete Company Cancel",
      "Delete Company Success",
      "Delete Company Failure",
    ]) {
      const response = await request.post("/api/admin/companies", {
        headers,
        data: { name, category: "Junior Partner", eventId },
      });
      expect(response.status()).toBe(200);
      companyIds.push((await response.json()).id);
    }

    const timetableResponse = await request.get(
      `/api/admin/timetable?eventId=${eventId}`,
      { headers },
    );
    expect(timetableResponse.status()).toBe(200);
    const timetableItems = await timetableResponse.json();
    expect(timetableItems.length).toBeGreaterThanOrEqual(3);
    timetableIds.push(
      ...timetableItems.slice(0, 3).map((item: { id: string }) => item.id),
    );
  });

  test.afterAll(async ({ request }) => {
    const headers = { Authorization: `Bearer ${adminToken}` };
    if (eventId) {
      await request.delete(`/api/admin/events/${eventId}`, { headers });
    }
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((token) => {
      window.localStorage.setItem("auth_token", token);
      (window as any).__e2eConfirmResult = false;
      (window as any).__e2eConfirmCalls = 0;
      (window as any).__e2eAlerts = [];
      window.confirm = () => {
        (window as any).__e2eConfirmCalls += 1;
        return (window as any).__e2eConfirmResult;
      };
      window.alert = (message?: string) => {
        (window as any).__e2eAlerts.push(String(message ?? ""));
      };
    }, adminToken);
    await page.goto(WEB_PREVIEW_URL);
    await page.getByTestId("button-open-drawer").click({ force: true });
    await page.getByTestId("button-switch-event").click();
    await page.getByTestId(`button-select-event-${eventId}`).click();
  });

  test("confirms single-item deletes, cancellation, event scope, and failures", async ({
    page,
  }) => {
    await openAdminScreen(page, "Manage Speakers");
    await expect(
      page.getByText("Delete Speaker Cancel", { exact: true }),
    ).toBeVisible();

    await deleteWithConfirmation(
      page,
      `button-delete-speaker-${speakerIds[0]}`,
      false,
    );
    await expect(
      page.getByText("Delete Speaker Cancel", { exact: true }),
    ).toBeVisible();

    const speakerDeleteResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/admin/speakers/${speakerIds[1]}`) &&
        response.request().method() === "DELETE",
    );
    await deleteWithConfirmation(
      page,
      `button-delete-speaker-${speakerIds[1]}`,
      true,
    );
    const speakerResponse = await speakerDeleteResponse;
    expect(new URL(speakerResponse.url()).searchParams.get("eventId")).toBe(
      eventId,
    );
    await expect(
      page.getByText("Delete Speaker Success", { exact: true }),
    ).toHaveCount(0);

    await page.route(
      `**/api/admin/speakers/${speakerIds[2]}?eventId=${eventId}`,
      (route) => route.fulfill({ status: 500, body: "Speaker delete failed" }),
    );
    await deleteWithConfirmation(
      page,
      `button-delete-speaker-${speakerIds[2]}`,
      true,
    );
    await expect(
      page.getByText("Delete Speaker Failure", { exact: true }),
    ).toBeVisible();
    await page.unroute(
      `**/api/admin/speakers/${speakerIds[2]}?eventId=${eventId}`,
    );
    await openAdminScreen(page, "Manage Companies");
    await expect(
      page.getByText("Delete Company Cancel", { exact: true }),
    ).toBeVisible();

    await deleteWithConfirmation(
      page,
      "button-delete-company-" + companyIds[0],
      false,
    );
    await expect(
      page.getByText("Delete Company Cancel", { exact: true }),
    ).toBeVisible();

    const companyDeleteResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/admin/companies/${companyIds[1]}`) &&
        response.request().method() === "DELETE",
    );
    await deleteWithConfirmation(
      page,
      "button-delete-company-" + companyIds[1],
      true,
    );
    const companyResponse = await companyDeleteResponse;
    expect(new URL(companyResponse.url()).searchParams.get("eventId")).toBe(
      eventId,
    );
    await expect(
      page.getByText("Delete Company Success", { exact: true }),
    ).toHaveCount(0);

    await page.route(
      `**/api/admin/companies/${companyIds[2]}?eventId=${eventId}`,
      (route) => route.fulfill({ status: 500, body: "Company delete failed" }),
    );
    await deleteWithConfirmation(
      page,
      "button-delete-company-" + companyIds[2],
      true,
    );
    await expect(
      page.getByText("Delete Company Failure", { exact: true }),
    ).toBeVisible();
    await page.unroute(
      `**/api/admin/companies/${companyIds[2]}?eventId=${eventId}`,
    );
    await openAdminScreen(page, "Manage Timetable");
    const slotNames = [
      "Template slot — Registration",
      "Template slot — Opening session",
      "Template slot — Break",
    ];
    await expect(page.getByText(slotNames[0], { exact: true })).toBeVisible();

    await deleteWithConfirmation(
      page,
      `button-delete-slot-${timetableIds[0]}`,
      false,
    );
    await expect(page.getByText(slotNames[0], { exact: true })).toBeVisible();

    const timetableDeleteResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/admin/timetable/${timetableIds[1]}`) &&
        response.request().method() === "DELETE",
    );
    await deleteWithConfirmation(
      page,
      `button-delete-slot-${timetableIds[1]}`,
      true,
    );
    const timetableResponse = await timetableDeleteResponse;
    expect(new URL(timetableResponse.url()).searchParams.get("eventId")).toBe(
      eventId,
    );
    await expect(page.getByText(slotNames[1], { exact: true })).toHaveCount(0);

    await page.route(
      `**/api/admin/timetable/${timetableIds[2]}?eventId=${eventId}`,
      (route) =>
        route.fulfill({ status: 500, body: "Timetable delete failed" }),
    );
    await deleteWithConfirmation(
      page,
      `button-delete-slot-${timetableIds[2]}`,
      true,
    );
    await expect(page.getByText(slotNames[2], { exact: true })).toBeVisible();
    await page.unroute(
      `**/api/admin/timetable/${timetableIds[2]}?eventId=${eventId}`,
    );
  });
});
