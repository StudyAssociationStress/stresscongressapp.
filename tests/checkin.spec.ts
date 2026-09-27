/**
 * End-to-end API tests: staff login → QR check-in flow.
 *
 * These tests verify that the 7-day JWT and the check-in endpoint work
 * correctly together after the recent security changes.
 */
import { test, expect } from "@playwright/test";
import { Client } from "pg";
import {
  TEST_STAFF_EMAIL,
  TEST_ADMIN_EMAIL,
  TEST_EVENT_ADMIN_EMAIL,
  TEST_ATTENDEE_EMAIL,
  TEST_ATTENDEE_QR,
  TEST_OTHER_EVENT_ID,
  TEST_OTHER_ATTENDEE_EMAIL,
  TEST_OTHER_ATTENDEE_QR,
  TEST_PASSWORD,
} from "./global-setup";

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

test.describe("QR check-in flow", () => {
  test("staff can log in and receive a valid JWT", async ({ request }) => {
    const res = await request.post("/api/auth/login", {
      data: { email: TEST_STAFF_EMAIL, password: TEST_PASSWORD },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body.token).toBeTruthy();
    expect(body.user.role).toBe("staff");

    // Validate the token actually works on an authenticated endpoint
    const me = await request.get("/api/auth/me", {
      headers: { Authorization: `Bearer ${body.token}` },
    });
    expect(me.status()).toBe(200);
    const meBody = await me.json();
    expect(meBody.role).toBe("staff");
  });

  test("authenticated staff can check in an attendee via QR code", async ({
    request,
  }) => {
    const token = await loginAs(request, TEST_STAFF_EMAIL, TEST_PASSWORD);

    const res = await request.post("/api/check-in", {
      headers: { Authorization: `Bearer ${token}` },
      data: { qrCodeValue: TEST_ATTENDEE_QR },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.user.name).toBeTruthy();
  });

  test("scanning the same QR code a second time reports already-checked-in", async ({
    request,
  }) => {
    const token = await loginAs(request, TEST_STAFF_EMAIL, TEST_PASSWORD);

    // First scan (may already be checked in from previous test — that is fine)
    await request.post("/api/check-in", {
      headers: { Authorization: `Bearer ${token}` },
      data: { qrCodeValue: TEST_ATTENDEE_QR },
    });

    // Second scan must return alreadyCheckedIn
    const res = await request.post("/api/check-in", {
      headers: { Authorization: `Bearer ${token}` },
      data: { qrCodeValue: TEST_ATTENDEE_QR },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.alreadyCheckedIn).toBe(true);
    expect(body.success).toBe(false);
  });

  test("check-in is rejected without a token (401)", async ({ request }) => {
    const res = await request.post("/api/check-in", {
      data: { qrCodeValue: TEST_ATTENDEE_QR },
    });
    expect(res.status()).toBe(401);
  });

  test("check-in with an unknown QR code returns 404", async ({ request }) => {
    const token = await loginAs(request, TEST_STAFF_EMAIL, TEST_PASSWORD);

    const res = await request.post("/api/check-in", {
      headers: { Authorization: `Bearer ${token}` },
      data: { qrCodeValue: "SC2026-DOES-NOT-EXIST" },
    });
    expect(res.status()).toBe(404);
  });

  test("attendee login succeeds and QR code value is present in profile", async ({
    request,
  }) => {
    const token = await loginAs(request, TEST_ATTENDEE_EMAIL, TEST_PASSWORD);

    const me = await request.get("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(me.status()).toBe(200);
    const body = await me.json();
    expect(body.qrCodeValue).toBe(TEST_ATTENDEE_QR);
  });

  test("attendees cannot enumerate registrants or recent check-ins", async ({
    request,
  }) => {
    const token = await loginAs(request, TEST_ATTENDEE_EMAIL, TEST_PASSWORD);
    const headers = { Authorization: `Bearer ${token}` };

    const attendees = await request.get("/api/attendees", { headers });
    expect(attendees.status()).toBe(403);

    const recentCheckIns = await request.get("/api/recent-checkins", {
      headers,
    });
    expect(recentCheckIns.status()).toBe(403);
  });

  test("staff cannot scan or search an attendee from a different event year", async ({
    request,
  }) => {
    const token = await loginAs(request, TEST_STAFF_EMAIL, TEST_PASSWORD);

    const scan = await request.post(
      `/api/check-in?eventId=${TEST_OTHER_EVENT_ID}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        data: { qrCodeValue: TEST_OTHER_ATTENDEE_QR },
      },
    );
    expect(scan.status()).toBe(400);

    const search = await request.get(
      `/api/attendees/search?q=Other&eventId=${TEST_OTHER_EVENT_ID}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(search.status()).toBe(200);
    expect(await search.json()).toEqual([]);
  });

  test("an admin managing another event only sees that event's attendees", async ({
    request,
  }) => {
    const token = await loginAs(request, TEST_ADMIN_EMAIL, TEST_PASSWORD);

    const response = await request.get(
      `/api/attendees?eventId=${TEST_OTHER_EVENT_ID}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    expect(response.status()).toBe(200);
    const attendees = await response.json();

    expect(
      attendees.some(
        (attendee: { email: string }) =>
          attendee.email === TEST_OTHER_ATTENDEE_EMAIL,
      ),
    ).toBe(true);
    expect(
      attendees.some(
        (attendee: { email: string }) => attendee.email === TEST_ATTENDEE_EMAIL,
      ),
    ).toBe(false);
  });

  test("attendance views exclude event admins while account management keeps them", async ({
    request,
  }) => {
    const eventId = "e2e-active-event";
    const staffToken = await loginAs(request, TEST_STAFF_EMAIL, TEST_PASSWORD);
    const adminToken = await loginAs(request, TEST_ADMIN_EMAIL, TEST_PASSWORD);
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    let eventAdmin:
      | { id: string; checked_in: boolean; checked_in_at: Date | null }
      | undefined;

    await client.connect();
    try {
      const eventAdminResult = await client.query<{
        id: string;
        checked_in: boolean;
        checked_in_at: Date | null;
      }>(
        `SELECT id, checked_in, checked_in_at
         FROM users
         WHERE email = $1 AND event_id = $2 AND role = 'admin'`,
        [TEST_EVENT_ADMIN_EMAIL, eventId],
      );
      eventAdmin = eventAdminResult.rows[0];
      expect(
        eventAdmin,
        "Expected the event-scoped admin fixture",
      ).toBeTruthy();

      await client.query(
        `UPDATE users SET checked_in = true, checked_in_at = NOW() WHERE id = $1`,
        [eventAdmin!.id],
      );

      const staffHeaders = { Authorization: `Bearer ${staffToken}` };
      const rosterResponse = await request.get(
        `/api/attendees?eventId=${eventId}`,
        { headers: staffHeaders },
      );
      expect(rosterResponse.status()).toBe(200);
      const roster = await rosterResponse.json();
      expect(
        roster.every((user: { role: string }) => user.role !== "admin"),
      ).toBe(true);
      expect(
        roster.some(
          (user: { email: string }) => user.email === TEST_ATTENDEE_EMAIL,
        ),
      ).toBe(true);

      const searchResponse = await request.get(
        `/api/attendees/search?q=E2E%20Event%20Admin&eventId=${eventId}`,
        { headers: staffHeaders },
      );
      expect(searchResponse.status()).toBe(200);
      expect(await searchResponse.json()).toEqual([]);

      const recentResponse = await request.get(
        `/api/recent-checkins?eventId=${eventId}`,
        { headers: staffHeaders },
      );
      expect(recentResponse.status()).toBe(200);
      const recentCheckIns = await recentResponse.json();
      expect(
        recentCheckIns.some(
          (user: { email: string }) => user.email === TEST_EVENT_ADMIN_EMAIL,
        ),
      ).toBe(false);

      const statsResponse = await request.get(`/api/stats?eventId=${eventId}`, {
        headers: staffHeaders,
      });
      expect(statsResponse.status()).toBe(200);
      const stats = await statsResponse.json();
      const expectedStats = await client.query<{
        total_registered: number;
        checked_in: number;
      }>(
        `SELECT
           count(*) FILTER (WHERE role <> 'admin')::int AS total_registered,
           count(*) FILTER (WHERE role <> 'admin' AND checked_in = true)::int AS checked_in
         FROM users
         WHERE event_id = $1`,
        [eventId],
      );
      expect(stats.totalRegistered).toBe(
        expectedStats.rows[0].total_registered,
      );
      expect(stats.checkedIn).toBe(expectedStats.rows[0].checked_in);

      const adminUsersResponse = await request.get(
        `/api/admin/users?eventId=${eventId}`,
        { headers: { Authorization: `Bearer ${adminToken}` } },
      );
      expect(adminUsersResponse.status()).toBe(200);
      const adminUsers = await adminUsersResponse.json();
      expect(
        adminUsers.some(
          (user: { email: string }) => user.email === TEST_EVENT_ADMIN_EMAIL,
        ),
      ).toBe(true);

      const manualCheckInResponse = await request.post(
        `/api/manual-check-in?eventId=${eventId}`,
        {
          headers: staffHeaders,
          data: { userId: eventAdmin!.id },
        },
      );
      expect(manualCheckInResponse.status()).toBe(404);

      const qrCheckInResponse = await request.post(
        `/api/check-in?eventId=${eventId}`,
        {
          headers: staffHeaders,
          data: { qrCodeValue: "SC2026-E2E-EVENTADMIN001" },
        },
      );
      expect(qrCheckInResponse.status()).toBe(404);
    } finally {
      if (eventAdmin) {
        await client.query(
          `UPDATE users SET checked_in = $2, checked_in_at = $3 WHERE id = $1`,
          [eventAdmin.id, eventAdmin.checked_in, eventAdmin.checked_in_at],
        );
      }
      await client.end();
    }
  });

  test("an administrator can complete QR, manual, and case-study check-in", async ({
    request,
  }) => {
    const token = await loginAs(request, TEST_ADMIN_EMAIL, TEST_PASSWORD);
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    const suffix = `${Date.now().toString(36)}-${process.pid}`;
    const attendeeId = `e2e-admin-checkin-attendee-${suffix}`;
    const caseStudyId = `e2e-admin-checkin-case-${suffix}`;
    const attendeeQr = `SC-E2E-ADMIN-CHECKIN-${suffix}`;
    let activeEventId = "";

    await client.connect();
    try {
      const activeEvent = await client.query<{ id: string }>(
        "SELECT id FROM events WHERE status = 'published' ORDER BY year DESC LIMIT 1",
      );
      activeEventId = activeEvent.rows[0]?.id ?? "";
      expect(activeEventId).toBeTruthy();

      await client.query(
        `INSERT INTO users (id, email, name, role, qr_code_value, event_id)
         VALUES ($1, $2, 'E2E Admin Check-in Attendee', 'attendee', $3, $4)`,
        [
          attendeeId,
          `e2e-admin-checkin-${suffix}@stress2026.test`,
          attendeeQr,
          activeEventId,
        ],
      );
      await client.query(
        `INSERT INTO case_studies (
           id, case_id, company, title, type, duration, event_id
         ) VALUES ($1, $2, 'E2E Test Company', 'Admin check-in case',
                   'Long Case', '60 minutes', $3)`,
        [caseStudyId, `ADMIN-CHECKIN-${suffix}`, activeEventId],
      );
      await client.query(
        `INSERT INTO user_case_studies (user_id, case_study_id)
         VALUES ($1, $2)`,
        [attendeeId, caseStudyId],
      );

      const headers = { Authorization: `Bearer ${token}` };
      const qrCheckIn = await request.post(
        `/api/check-in?eventId=${activeEventId}`,
        { headers, data: { qrCodeValue: attendeeQr } },
      );
      expect(qrCheckIn.status()).toBe(200);
      expect(await qrCheckIn.json()).toMatchObject({ success: true });

      const checkOut = await request.post(
        `/api/check-out?eventId=${activeEventId}`,
        { headers, data: { userId: attendeeId } },
      );
      expect(checkOut.status()).toBe(200);
      expect(await checkOut.json()).toMatchObject({ success: true });

      const manualCheckIn = await request.post(
        `/api/manual-check-in?eventId=${activeEventId}`,
        { headers, data: { userId: attendeeId } },
      );
      expect(manualCheckIn.status()).toBe(200);
      expect(await manualCheckIn.json()).toMatchObject({ success: true });

      const caseStudyCheckIn = await request.post(
        `/api/case-studies/${caseStudyId}/check-in?eventId=${activeEventId}`,
        { headers, data: { qrCodeValue: attendeeQr } },
      );
      expect(caseStudyCheckIn.status()).toBe(200);
      expect(await caseStudyCheckIn.json()).toMatchObject({
        success: true,
        user: { id: attendeeId },
      });
    } finally {
      await client.query(
        "DELETE FROM user_case_studies WHERE case_study_id = $1",
        [caseStudyId],
      );
      await client.query("DELETE FROM case_studies WHERE id = $1", [
        caseStudyId,
      ]);
      await client.query("DELETE FROM users WHERE id = $1", [attendeeId]);
      await client.end();
    }
  });

  test("uses one event attendee QR for conference and assigned case studies", async ({
    request,
  }) => {
    const token = await loginAs(request, TEST_ADMIN_EMAIL, TEST_PASSWORD);
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    const suffix = `${Date.now().toString(36)}-${process.pid}`;
    const attendeeId = `e2e-unified-qr-attendee-${suffix}`;
    const attendeeQr = `SC-E2E-UNIFIED-${suffix}`;
    const caseStudyAId = `e2e-unified-qr-a-${suffix}`;
    const caseStudyBId = `e2e-unified-qr-b-${suffix}`;
    const caseStudyCId = `e2e-unified-qr-c-${suffix}`;
    let activeEventId = "";

    await client.connect();
    try {
      const activeEvent = await client.query<{ id: string }>(
        "SELECT id FROM events WHERE status = 'published' ORDER BY year DESC LIMIT 1",
      );
      activeEventId = activeEvent.rows[0]?.id ?? "";
      expect(activeEventId).toBeTruthy();

      await client.query(
        `INSERT INTO users (id, email, name, role, qr_code_value, event_id)
         VALUES ($1, $2, 'Unified QR Attendee', 'attendee', $3, $4)`,
        [
          attendeeId,
          `e2e-unified-qr-${suffix}@stress2026.test`,
          attendeeQr,
          activeEventId,
        ],
      );
      await client.query(
        `INSERT INTO case_studies
           (id, case_id, company, title, type, duration, event_id)
         VALUES
           ($1, $3, 'Unified QR Company', 'Unified Case A', 'Long Case', '60 minutes', $5),
           ($2, $4, 'Unified QR Company', 'Unified Case B', 'Long Case', '60 minutes', $5),
           ($6, $7, 'Unified QR Company', 'Unified Case C', 'Long Case', '60 minutes', $5)`,
        [
          caseStudyAId,
          caseStudyBId,
          `UNIFIED-A-${suffix}`,
          `UNIFIED-B-${suffix}`,
          activeEventId,
          caseStudyCId,
          `UNIFIED-C-${suffix}`,
        ],
      );
      await client.query(
        `INSERT INTO user_case_studies (user_id, case_study_id)
         VALUES ($1, $2), ($1, $3)`,
        [attendeeId, caseStudyAId, caseStudyCId],
      );

      const headers = { Authorization: `Bearer ${token}` };
      const conferenceScan = await request.post(
        `/api/check-in?eventId=${activeEventId}`,
        { headers, data: { qrCodeValue: attendeeQr } },
      );
      expect(conferenceScan.status()).toBe(200);
      expect(await conferenceScan.json()).toMatchObject({
        success: true,
        user: { name: "Unified QR Attendee", email: expect.any(String) },
      });

      const wrongCaseStudyScan = await request.post(
        `/api/case-studies/${caseStudyBId}/check-in?eventId=${activeEventId}`,
        { headers, data: { qrCodeValue: attendeeQr } },
      );
      expect(wrongCaseStudyScan.status()).toBe(200);
      expect(await wrongCaseStudyScan.json()).toMatchObject({
        success: false,
        notAssigned: true,
        message: "Unified QR Attendee is not assigned to Unified Case B",
      });
      const untouchedAssignments = await client.query<{
        case_study_id: string;
        checked_in: boolean;
      }>(
        `SELECT case_study_id, checked_in
         FROM user_case_studies
         WHERE user_id = $1
         ORDER BY case_study_id`,
        [attendeeId],
      );
      expect(untouchedAssignments.rows).toEqual([
        { case_study_id: caseStudyAId, checked_in: false },
        { case_study_id: caseStudyCId, checked_in: false },
      ]);

      const correctCaseStudyScan = await request.post(
        `/api/case-studies/${caseStudyAId}/check-in?eventId=${activeEventId}`,
        { headers, data: { qrCodeValue: attendeeQr } },
      );
      expect(correctCaseStudyScan.status()).toBe(200);
      expect(await correctCaseStudyScan.json()).toMatchObject({
        success: true,
        user: { id: attendeeId },
      });

      const duplicateCaseStudyScan = await request.post(
        `/api/case-studies/${caseStudyAId}/check-in?eventId=${activeEventId}`,
        { headers, data: { qrCodeValue: attendeeQr } },
      );
      expect(duplicateCaseStudyScan.status()).toBe(200);
      expect(await duplicateCaseStudyScan.json()).toMatchObject({
        success: false,
        alreadyCheckedIn: true,
      });

      const obsoleteQrValues = [
        `SC-UCS-${suffix}`,
        `SC2026-UCS:${attendeeId}:${caseStudyAId}`,
        `SC-${activeEventId.slice(0, 8)}-CS-${caseStudyAId}`,
        "not-a-qr-code",
        `unknown-${suffix}`,
        "SC2026-E2E-ADMIN001",
        "SC2026-E2E-STAFF001",
        TEST_OTHER_ATTENDEE_QR,
      ];
      for (const obsoleteQrValue of obsoleteQrValues) {
        const response = await request.post(
          `/api/check-in?eventId=${activeEventId}`,
          { headers, data: { qrCodeValue: obsoleteQrValue } },
        );
        expect(response.status(), obsoleteQrValue).toBe(404);
        expect((await response.json()).user).toBeUndefined();
      }

      const finalAssignments = await client.query<{
        case_study_id: string;
        checked_in: boolean;
      }>(
        `SELECT case_study_id, checked_in
         FROM user_case_studies
         WHERE user_id = $1
         ORDER BY case_study_id`,
        [attendeeId],
      );
      expect(finalAssignments.rows).toEqual([
        { case_study_id: caseStudyAId, checked_in: true },
        { case_study_id: caseStudyCId, checked_in: false },
      ]);
    } finally {
      await client.query("DELETE FROM user_case_studies WHERE user_id = $1", [
        attendeeId,
      ]);
      await client.query(
        "DELETE FROM case_studies WHERE id = ANY($1::varchar[])",
        [[caseStudyAId, caseStudyBId, caseStudyCId]],
      );
      await client.query("DELETE FROM users WHERE id = $1", [attendeeId]);
      await client.end();
    }
  });

  test("allows only one simultaneous manual check-in and check-out", async ({
    request,
  }) => {
    const token = await loginAs(request, TEST_ADMIN_EMAIL, TEST_PASSWORD);
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    const suffix = `${Date.now().toString(36)}-${process.pid}`;
    const attendeeId = `e2e-atomic-checkin-${suffix}`;
    let activeEventId = "";

    await client.connect();
    try {
      const activeEvent = await client.query<{ id: string }>(
        "SELECT id FROM events WHERE status = 'published' ORDER BY year DESC LIMIT 1",
      );
      activeEventId = activeEvent.rows[0]?.id ?? "";
      expect(activeEventId).toBeTruthy();

      await client.query(
        `INSERT INTO users (id, email, name, role, qr_code_value, event_id)
         VALUES ($1, $2, 'Atomic Check-in Attendee', 'attendee', $3, $4)`,
        [
          attendeeId,
          `e2e-atomic-checkin-${suffix}@stress2026.test`,
          `SC-E2E-ATOMIC-${suffix}`,
          activeEventId,
        ],
      );

      const headers = { Authorization: `Bearer ${token}` };
      const checkIns = await Promise.all([
        request.post(`/api/manual-check-in?eventId=${activeEventId}`, {
          headers,
          data: { userId: attendeeId },
        }),
        request.post(`/api/manual-check-in?eventId=${activeEventId}`, {
          headers,
          data: { userId: attendeeId },
        }),
      ]);
      expect(
        checkIns.filter((response) => response.status() === 200),
      ).toHaveLength(1);
      expect(
        checkIns.filter((response) => [400, 409].includes(response.status())),
      ).toHaveLength(1);

      const checkOuts = await Promise.all([
        request.post(`/api/check-out?eventId=${activeEventId}`, {
          headers,
          data: { userId: attendeeId },
        }),
        request.post(`/api/check-out?eventId=${activeEventId}`, {
          headers,
          data: { userId: attendeeId },
        }),
      ]);
      expect(
        checkOuts.filter((response) => response.status() === 200),
      ).toHaveLength(1);
      expect(
        checkOuts.filter((response) => [400, 409].includes(response.status())),
      ).toHaveLength(1);
    } finally {
      await client.query("DELETE FROM users WHERE id = $1", [attendeeId]);
      await client.end();
    }
  });
});
