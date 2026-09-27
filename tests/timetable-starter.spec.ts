import { test, expect } from "@playwright/test";
import { TEST_ADMIN_EMAIL, TEST_PASSWORD } from "./global-setup";

async function loginAsAdmin(
  request: import("@playwright/test").APIRequestContext,
): Promise<string> {
  const response = await request.post("/api/auth/login", {
    data: { email: TEST_ADMIN_EMAIL, password: TEST_PASSWORD },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).token as string;
}

test.describe("starter timetable lifecycle", () => {
  let adminToken: string;
  let eventId: string;
  let otherEventId: string;

  test.beforeAll(async ({ request }) => {
    adminToken = await loginAsAdmin(request);
    const headers = { Authorization: `Bearer ${adminToken}` };

    const first = await request.post("/api/admin/events", {
      headers,
      data: { name: `Timetable Starter ${Date.now()}`, year: 2198 },
    });
    expect(first.status()).toBe(200);
    eventId = (await first.json()).id;

    const second = await request.post("/api/admin/events", {
      headers,
      data: { name: `Timetable Isolation ${Date.now()}`, year: 2197 },
    });
    expect(second.status()).toBe(200);
    otherEventId = (await second.json()).id;
  });

  test.afterAll(async ({ request }) => {
    const headers = { Authorization: `Bearer ${adminToken}` };
    if (eventId)
      await request.delete(`/api/admin/events/${eventId}`, { headers });
    if (otherEventId)
      await request.delete(`/api/admin/events/${otherEventId}`, { headers });
  });

  test("creates editable starter rows only for the new event", async ({
    request,
  }) => {
    const headers = { Authorization: `Bearer ${adminToken}` };
    const response = await request.get(
      `/api/admin/timetable?eventId=${eventId}`,
      { headers },
    );
    expect(response.status()).toBe(200);
    const items = await response.json();

    expect(items).toHaveLength(4);
    expect(items.map((item: { activity1: string }) => item.activity1)).toEqual([
      "Template slot — Registration",
      "Template slot — Opening session",
      "Template slot — Break",
      "Template slot — Closing",
    ]);
    expect(
      items.every((item: { eventId: string }) => item.eventId === eventId),
    ).toBe(true);

    const otherResponse = await request.get(
      `/api/admin/timetable?eventId=${otherEventId}`,
      { headers },
    );
    expect(otherResponse.status()).toBe(200);
    const otherItems = await otherResponse.json();
    expect(otherItems).toHaveLength(4);
    expect(
      otherItems.every(
        (item: { eventId: string }) => item.eventId === otherEventId,
      ),
    ).toBe(true);
    expect(otherItems.map((item: { id: string }) => item.id)).not.toEqual(
      items.map((item: { id: string }) => item.id),
    );
  });

  test("rejects an unrecognized start date when creating an event", async ({
    request,
  }) => {
    const headers = { Authorization: `Bearer ${adminToken}` };
    const response = await request.post("/api/admin/events", {
      headers,
      data: {
        name: `Invalid Start Date ${Date.now()}`,
        year: 2196,
        startDate: "not a date",
      },
    });

    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toEqual({
      message:
        "Start Date is not recognized. Use a format such as 9/9, September 9, or 2027-09-09.",
    });
  });

  test("rejects an unrecognized start date without changing the event", async ({
    request,
  }) => {
    const headers = { Authorization: `Bearer ${adminToken}` };
    const response = await request.put(`/api/admin/events/${eventId}`, {
      headers,
      data: { startDate: "not a date" },
    });

    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toEqual({
      message:
        "Start Date is not recognized. Use a format such as 9/9, September 9, or 2027-09-09.",
    });

    const eventResponse = await request.get("/api/admin/events", { headers });
    const event = (await eventResponse.json()).find(
      (candidate: { id: string }) => candidate.id === eventId,
    );
    expect(event.startDate).toBeNull();
  });

  test("accepts common start date formats and an empty date", async ({
    request,
  }) => {
    const headers = { Authorization: `Bearer ${adminToken}` };
    for (const startDate of ["9/9", "September 9", "2198-09-09", null]) {
      const response = await request.put(`/api/admin/events/${eventId}`, {
        headers,
        data: { startDate },
      });
      expect(response.status()).toBe(200);
    }
  });

  test("keeps edits, deletes, and reorder scoped to the selected event", async ({
    request,
  }) => {
    const headers = { Authorization: `Bearer ${adminToken}` };
    const initialResponse = await request.get(
      `/api/admin/timetable?eventId=${eventId}`,
      { headers },
    );
    const initialItems = await initialResponse.json();

    const editResponse = await request.put(
      `/api/admin/timetable/${initialItems[0].id}?eventId=${eventId}`,
      {
        headers,
        data: { activity1: "Published registration", time: "08:30" },
      },
    );
    expect(editResponse.status()).toBe(200);

    const reorderResponse = await request.put(
      `/api/admin/timetable/reorder?eventId=${eventId}`,
      {
        headers,
        data: {
          items: initialItems.map((item: { id: string }, index: number) => ({
            id: item.id,
            sortOrder: initialItems.length - index - 1,
          })),
        },
      },
    );
    expect(reorderResponse.status()).toBe(200);

    const deleteResponse = await request.delete(
      `/api/admin/timetable/${initialItems[1].id}?eventId=${eventId}`,
      { headers },
    );
    expect(deleteResponse.status()).toBe(200);

    const remainingResponse = await request.get(
      `/api/admin/timetable?eventId=${eventId}`,
      { headers },
    );
    const remaining = await remainingResponse.json();
    expect(remaining).toHaveLength(3);
    expect(
      remaining.some(
        (item: { activity1: string }) =>
          item.activity1 === "Published registration",
      ),
    ).toBe(true);

    const otherResponse = await request.get(
      `/api/admin/timetable?eventId=${otherEventId}`,
      { headers },
    );
    const otherItems = await otherResponse.json();
    expect(otherItems).toHaveLength(4);
    expect(
      otherItems.every(
        (item: { eventId: string }) => item.eventId === otherEventId,
      ),
    ).toBe(true);
  });

  test("can clear the starter timetable and returns an honest empty list", async ({
    request,
  }) => {
    const headers = { Authorization: `Bearer ${adminToken}` };
    const response = await request.delete(
      `/api/admin/timetable/all?eventId=${eventId}`,
      { headers },
    );
    expect(response.status()).toBe(200);

    const emptyResponse = await request.get(
      `/api/admin/timetable?eventId=${eventId}`,
      { headers },
    );
    expect(emptyResponse.status()).toBe(200);
    expect(await emptyResponse.json()).toEqual([]);
  });

  test("blocks publishing starter slots with an actionable response", async ({
    request,
  }) => {
    const headers = { Authorization: `Bearer ${adminToken}` };
    const response = await request.post(
      `/api/admin/events/${otherEventId}/publish`,
      { headers },
    );

    expect(response.status()).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "STARTER_TIMETABLE",
      message:
        "This event still contains starter timetable slots. Edit or delete them before publishing, or explicitly confirm that the template is intentional.",
      starterSlots: expect.arrayContaining([
        expect.objectContaining({ activity1: "Template slot — Registration" }),
      ]),
    });

    const eventsResponse = await request.get("/api/admin/events", { headers });
    const events = await eventsResponse.json();
    expect(
      events.find((event: { id: string }) => event.id === otherEventId).status,
    ).toBe("draft");
  });

  test("publishes starter slots only after an explicit intentional confirmation", async ({
    request,
  }) => {
    const headers = { Authorization: `Bearer ${adminToken}` };
    const response = await request.post(
      `/api/admin/events/${otherEventId}/publish`,
      {
        headers,
        data: { confirmStarterTimetable: true },
      },
    );

    expect(response.status()).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: otherEventId,
      status: "published",
    });
  });

  test("publishes normally when the timetable has no starter slots", async ({
    request,
  }) => {
    const headers = { Authorization: `Bearer ${adminToken}` };
    const response = await request.post(
      `/api/admin/events/${eventId}/publish`,
      { headers },
    );

    expect(response.status()).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: eventId,
      status: "published",
    });
  });
});
