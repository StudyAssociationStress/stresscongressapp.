import { test, expect } from "@playwright/test";
import { Client } from "pg";
import {
  TEST_ATTENDEE_EMAIL,
  TEST_OTHER_EVENT_ID,
  TEST_PASSWORD,
} from "./global-setup";

async function login(
  request: import("@playwright/test").APIRequestContext,
): Promise<string> {
  const response = await request.post("/api/auth/login", {
    data: { email: TEST_ATTENDEE_EMAIL, password: TEST_PASSWORD },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).token as string;
}

test.describe("saved attendee agenda", () => {
  test("loads only the active event sessions and makes save/unsave idempotent", async ({
    request,
  }) => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const activeEvent = await client.query<{ id: string }>(
      "SELECT id FROM events WHERE status = 'published' ORDER BY year DESC LIMIT 1",
    );
    expect(activeEvent.rows[0]).toBeTruthy();
    const activeEventId = activeEvent.rows[0].id;
    const activeSessionId = `e2e-session-active-${Date.now()}`;
    const otherSessionId = `e2e-session-other-${Date.now()}`;
    await client.query(
      `INSERT INTO sessions
        (id, title, description, start_time, end_time, location, track, day, event_id)
       VALUES
        ($1, 'Active event session', 'For saved agenda testing',
         NOW() + INTERVAL '1 hour', NOW() + INTERVAL '2 hours',
         'Main room', 'Research', 1, $3),
        ($2, 'Other event session', 'Must stay isolated',
         NOW() + INTERVAL '1 hour', NOW() + INTERVAL '2 hours',
         'Other room', 'Research', 1, $4)`,
      [activeSessionId, otherSessionId, activeEventId, TEST_OTHER_EVENT_ID],
    );

    try {
      const token = await login(request);
      const headers = { Authorization: `Bearer ${token}` };
      const sessions = await request.get("/api/sessions", { headers });
      expect(sessions.status()).toBe(200);
      const sessionIds = (await sessions.json()).map(
        (session: { id: string }) => session.id,
      );
      expect(sessionIds).toContain(activeSessionId);
      expect(sessionIds).not.toContain(otherSessionId);

      const firstSave = await request.post("/api/saved-sessions", {
        headers,
        data: { sessionId: activeSessionId },
      });
      const secondSave = await request.post("/api/saved-sessions", {
        headers,
        data: { sessionId: activeSessionId },
      });
      expect(firstSave.status()).toBe(200);
      expect(secondSave.status()).toBe(200);

      const saved = await request.get("/api/saved-sessions", { headers });
      expect(saved.status()).toBe(200);
      expect(await saved.json()).toEqual([activeSessionId]);

      const crossEventSave = await request.post("/api/saved-sessions", {
        headers,
        data: { sessionId: otherSessionId },
      });
      expect(crossEventSave.status()).toBe(404);

      const firstDelete = await request.delete(
        `/api/saved-sessions/${activeSessionId}`,
        { headers },
      );
      const secondDelete = await request.delete(
        `/api/saved-sessions/${activeSessionId}`,
        { headers },
      );
      expect(firstDelete.status()).toBe(200);
      expect(secondDelete.status()).toBe(200);
      expect(
        await (await request.get("/api/saved-sessions", { headers })).json(),
      ).toEqual([]);
    } finally {
      await client.query(
        "DELETE FROM saved_sessions WHERE session_id IN ($1, $2)",
        [activeSessionId, otherSessionId],
      );
      await client.query("DELETE FROM sessions WHERE id IN ($1, $2)", [
        activeSessionId,
        otherSessionId,
      ]);
      await client.end();
    }
  });
});
