import { test, expect } from "@playwright/test";
import { TEST_ADMIN_EMAIL, TEST_PASSWORD } from "./global-setup";

test.describe("event publication invariant", () => {
  test("keeps exactly one event live when publish requests overlap", async ({
    request,
  }) => {
    test.setTimeout(60_000);

    const login = await request.post("/api/auth/login", {
      data: { email: TEST_ADMIN_EMAIL, password: TEST_PASSWORD },
    });
    expect(login.status()).toBe(200);
    const { token } = (await login.json()) as { token: string };
    const headers = { Authorization: `Bearer ${token}` };
    const suffix = `${Date.now().toString(36)}-${process.pid}`;
    const eventIds: string[] = [];
    const attendeeUsers: { id: string; eventId: string }[] = [];

    try {
      for (const [name, year] of [
        [`Concurrent Publish A ${suffix}`, 2401],
        [`Concurrent Publish B ${suffix}`, 2402],
      ] as const) {
        const response = await request.post("/api/admin/events", {
          headers,
          data: {
            name,
            year,
            startDate: "September 9",
          },
        });
        expect(response.status()).toBe(200);
        eventIds.push(((await response.json()) as { id: string }).id);
      }

      for (const [index, eventId] of eventIds.entries()) {
        const attendeeResponse = await request.post("/api/admin/users", {
          headers,
          data: {
            email: `prepublish-${suffix}-${index}@stress2026.test`,
            name: `Pre-publish Attendee ${index}`,
            role: "attendee",
            eventId,
          },
        });
        expect(attendeeResponse.status()).toBe(200);
        const attendee = (await attendeeResponse.json()) as {
          id: string;
          eventInvitationDeferred: boolean;
        };
        attendeeUsers.push({ id: attendee.id, eventId });
        expect(attendee.eventInvitationDeferred).toBe(true);
      }

      const publishResponses = await Promise.all(
        eventIds.map((eventId) =>
          request.post(`/api/admin/events/${eventId}/publish`, {
            headers,
            data: { confirmStarterTimetable: true },
          }),
        ),
      );
      expect(publishResponses.map((response) => response.status())).toEqual([
        200, 200,
      ]);
      const publishResults = (await Promise.all(
        publishResponses.map((response) => response.json()),
      )) as {
        eventInvitation: { attempted: number };
        eventLiveEmail: { attempted: number };
      }[];
      expect(
        publishResults.map((result) => result.eventInvitation.attempted),
      ).toEqual([0, 0]);
      expect(
        publishResults.map((result) => result.eventLiveEmail.attempted),
      ).toEqual([1, 1]);

      const eventsResponse = await request.get("/api/admin/events", {
        headers,
      });
      expect(eventsResponse.status()).toBe(200);
      const events = (await eventsResponse.json()) as {
        id: string;
        status: string;
      }[];
      const liveEvents = events.filter((event) => event.status === "published");
      expect(liveEvents).toHaveLength(1);
      expect(eventIds).toContain(liveEvents[0].id);

      const activeResponse = await request.get("/api/events/active");
      expect(activeResponse.status()).toBe(200);
      expect((await activeResponse.json()).id).toBe(liveEvents[0].id);

      const prePublishAttendee = attendeeUsers.find(
        (attendee) => attendee.eventId === liveEvents[0].id,
      );
      expect(prePublishAttendee).toBeTruthy();
      const prePublishRetry = await request.post(
        `/api/admin/events/${prePublishAttendee!.eventId}/attendees/${prePublishAttendee!.id}/retry-invitation?eventId=${encodeURIComponent(prePublishAttendee!.eventId)}`,
        { headers },
      );
      expect(prePublishRetry.status()).toBe(409);

      const liveAttendeeResponse = await request.post("/api/admin/users", {
        headers,
        data: {
          email: `live-added-${suffix}@stress2026.test`,
          name: "Live Added Attendee",
          role: "attendee",
          eventId: liveEvents[0].id,
        },
      });
      expect(liveAttendeeResponse.status()).toBe(200);
      const liveAttendee = (await liveAttendeeResponse.json()) as {
        id: string;
        eventInvitationStatus: string;
      };
      attendeeUsers.push({ id: liveAttendee.id, eventId: liveEvents[0].id });
      expect(liveAttendee.eventInvitationStatus).toBe("skipped");

      const republishResponse = await request.post(
        `/api/admin/events/${liveEvents[0].id}/publish`,
        {
          headers,
          data: { confirmStarterTimetable: true },
        },
      );
      expect(republishResponse.status()).toBe(200);
      const republished = (await republishResponse.json()) as {
        eventInvitation: { attempted: number };
        eventLiveEmail: { attempted: number };
      };
      expect(republished.eventInvitation.attempted).toBe(0);
      expect(republished.eventLiveEmail.attempted).toBe(0);
    } finally {
      // Restore the shared active fixture before deleting the temporary events.
      const restore = await request.post(
        "/api/admin/events/e2e-active-event/publish",
        {
          headers,
          data: { confirmStarterTimetable: true },
        },
      );
      expect(restore.status()).toBe(200);

      for (const attendee of attendeeUsers) {
        const deletedAttendee = await request.delete(
          `/api/admin/users/${attendee.id}?eventId=${encodeURIComponent(attendee.eventId)}`,
          { headers },
        );
        expect([200, 404]).toContain(deletedAttendee.status());
      }

      for (const eventId of eventIds) {
        const deleted = await request.delete(`/api/admin/events/${eventId}`, {
          headers,
        });
        expect([200, 404]).toContain(deleted.status());
      }
    }
  });
});
