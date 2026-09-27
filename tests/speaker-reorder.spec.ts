import { test, expect } from "@playwright/test";
import {
  TEST_ADMIN_EMAIL,
  TEST_ATTENDEE_EMAIL,
  TEST_PASSWORD,
} from "./global-setup";

async function login(
  request: import("@playwright/test").APIRequestContext,
  email: string,
): Promise<string> {
  const response = await request.post("/api/auth/login", {
    data: { email, password: TEST_PASSWORD },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.token).toBeTruthy();
  return body.token as string;
}

test.describe("speaker ordering", () => {
  let adminToken: string;
  let attendeeToken: string;
  let eventId: string;
  let otherEventId: string;
  const speakerIds: string[] = [];
  let otherSpeakerId: string;

  test.beforeAll(async ({ request }) => {
    adminToken = await login(request, TEST_ADMIN_EMAIL);
    attendeeToken = await login(request, TEST_ATTENDEE_EMAIL);

    const eventsResponse = await request.get("/api/admin/events", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(eventsResponse.status()).toBe(200);
    const events = await eventsResponse.json();
    eventId = events.find(
      (event: { status: string }) => event.status === "published",
    )?.id;
    expect(eventId).toBeTruthy();

    const otherEventResponse = await request.post("/api/admin/events", {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { name: `Speaker Order Isolation ${Date.now()}`, year: 2199 },
    });
    expect(otherEventResponse.status()).toBe(200);
    otherEventId = (await otherEventResponse.json()).id;

    for (const name of ["Order Speaker Alpha", "Order Speaker Beta"]) {
      const response = await request.post(
        `/api/admin/speakers?eventId=${eventId}`,
        {
          headers: { Authorization: `Bearer ${adminToken}` },
          data: { name, eventId },
        },
      );
      expect(response.status()).toBe(200);
      speakerIds.push((await response.json()).id);
    }

    const otherSpeakerResponse = await request.post(
      `/api/admin/speakers?eventId=${otherEventId}`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { name: "Other Event Speaker", eventId: otherEventId },
      },
    );
    expect(otherSpeakerResponse.status()).toBe(200);
    otherSpeakerId = (await otherSpeakerResponse.json()).id;
  });

  test.afterAll(async ({ request }) => {
    for (const id of [...speakerIds, otherSpeakerId]) {
      if (!id) continue;
      const event = speakerIds.includes(id) ? eventId : otherEventId;
      await request.delete(`/api/admin/speakers/${id}?eventId=${event}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
    }
    if (otherEventId) {
      await request.delete(`/api/admin/events/${otherEventId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
    }
  });

  test("saves event-scoped order and exposes it publicly", async ({
    request,
  }) => {
    const speakersResponse = await request.get(
      `/api/admin/speakers?eventId=${eventId}`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
      },
    );
    expect(speakersResponse.status()).toBe(200);
    const allSpeakers = (await speakersResponse.json()) as {
      id: string;
      sortOrder: number;
    }[];
    const remainingSpeakers = allSpeakers
      .filter((speaker) => !speakerIds.includes(speaker.id))
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const response = await request.put(
      `/api/admin/speakers/reorder?eventId=${eventId}`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: {
          items: [
            { id: speakerIds[1], sortOrder: 0 },
            { id: speakerIds[0], sortOrder: 1 },
            ...remainingSpeakers.map((speaker, index) => ({
              id: speaker.id,
              sortOrder: index + 2,
            })),
          ],
        },
      },
    );
    expect(response.status()).toBe(200);

    const publicResponse = await request.get("/api/speakers", {
      headers: { Authorization: `Bearer ${attendeeToken}` },
    });
    expect(publicResponse.status()).toBe(200);
    const publicSpeakers = await publicResponse.json();
    const orderedNames = publicSpeakers
      .filter((speaker: { id: string }) => speakerIds.includes(speaker.id))
      .map((speaker: { name: string }) => speaker.name);
    expect(orderedNames).toEqual(["Order Speaker Beta", "Order Speaker Alpha"]);
  });

  test("rejects incomplete or cross-event reorder payloads", async ({
    request,
  }) => {
    const response = await request.put(
      `/api/admin/speakers/reorder?eventId=${eventId}`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: {
          items: [
            { id: speakerIds[0], sortOrder: 0 },
            { id: otherSpeakerId, sortOrder: 1 },
          ],
        },
      },
    );
    expect(response.status()).toBe(400);

    const otherResponse = await request.get(
      `/api/admin/speakers?eventId=${otherEventId}`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
      },
    );
    expect(otherResponse.status()).toBe(200);
    const otherSpeakers = await otherResponse.json();
    expect(
      otherSpeakers.find(
        (speaker: { id: string }) => speaker.id === otherSpeakerId,
      ).sortOrder,
    ).toBe(0);
  });
});
