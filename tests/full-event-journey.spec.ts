import { test, expect, type APIRequestContext } from "@playwright/test";
import { TEST_ADMIN_EMAIL, TEST_PASSWORD } from "./global-setup";

type UserResponse = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "staff" | "attendee";
  qrCodeValue?: string;
  checkedIn?: boolean;
};

type AuthResponse = {
  token: string;
  user: UserResponse;
};

async function loginAs(
  request: APIRequestContext,
  email: string,
  eventId?: string,
): Promise<AuthResponse> {
  const response = await request.post("/api/auth/login", {
    data: {
      email,
      password: TEST_PASSWORD,
      ...(eventId ? { eventId } : {}),
    },
  });
  expect(response.status(), `Login failed for ${email}`).toBe(200);
  const body = (await response.json()) as AuthResponse;
  expect(body.token).toBeTruthy();
  expect(body.user.email).toBe(email);
  return body;
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function createEventUser(
  request: APIRequestContext,
  adminToken: string,
  eventId: string,
  user: { name: string; email: string; role: "staff" | "attendee" },
): Promise<UserResponse> {
  const created = await request.post(`/api/admin/users?eventId=${eventId}`, {
    headers: authHeaders(adminToken),
    data: user,
  });
  expect(created.status(), `Could not create ${user.role}`).toBe(201);
  const createdUser = (await created.json()) as UserResponse;
  expect(createdUser.qrCodeValue).toBeUndefined();

  const password = await request.put(
    `/api/admin/users/${createdUser.id}?eventId=${eventId}`,
    {
      headers: authHeaders(adminToken),
      data: { password: TEST_PASSWORD },
    },
  );
  expect(password.status(), `Could not set ${user.role} password`).toBe(200);
  return createdUser;
}

async function readAuditActions(
  request: APIRequestContext,
  adminToken: string,
  eventId: string,
): Promise<Set<string>> {
  const response = await request.get(
    `/api/admin/audit-log?eventId=${eventId}&pageSize=200`,
    { headers: authHeaders(adminToken) },
  );
  expect(response.status()).toBe(200);
  const body = await response.json();
  const entries = Array.isArray(body) ? body : body.entries || [];
  return new Set(entries.map((entry: { action: string }) => entry.action));
}

test.describe("full event journey", () => {
  test("admin creates an event and staff runs a complete attendee day", async ({
    request,
  }) => {
    test.setTimeout(120_000);

    const admin = await loginAs(request, TEST_ADMIN_EMAIL);
    const adminHeaders = authHeaders(admin.token);
    const suffix = `${Date.now().toString(36)}-${process.pid}`;
    let eventId: string | undefined;

    try {
      const createdEvent = await request.post("/api/admin/events", {
        headers: adminHeaders,
        data: {
          name: `E2E Full Journey ${suffix}`,
          year: 2300,
          location: "E2E Test Venue",
        },
      });
      expect(createdEvent.status()).toBe(200);
      const event = await createdEvent.json();
      eventId = event.id as string;
      expect(event).toMatchObject({
        name: `E2E Full Journey ${suffix}`,
        status: "draft",
      });

      const staff = await createEventUser(request, admin.token, eventId, {
        name: "Full Journey Staff",
        email: `full-journey-staff-${suffix}@stress2026.test`,
        role: "staff",
      });
      const attendeeA = await createEventUser(request, admin.token, eventId, {
        name: "Full Journey Attendee A",
        email: `full-journey-attendee-a-${suffix}@stress2026.test`,
        role: "attendee",
      });
      const attendeeB = await createEventUser(request, admin.token, eventId, {
        name: "Full Journey Attendee B",
        email: `full-journey-attendee-b-${suffix}@stress2026.test`,
        role: "attendee",
      });

      const usersBeforePublish = await request.get(
        `/api/admin/users?eventId=${eventId}`,
        { headers: adminHeaders },
      );
      expect(usersBeforePublish.status()).toBe(200);
      const eventUsers = (await usersBeforePublish.json()) as UserResponse[];
      expect(
        eventUsers.filter((user) =>
          [staff.email, attendeeA.email, attendeeB.email].includes(user.email),
        ),
      ).toHaveLength(3);
      expect(eventUsers.every((user) => user.qrCodeValue === undefined)).toBe(
        true,
      );

      const caseStudyResponse = await request.post(
        `/api/admin/case-studies?eventId=${eventId}`,
        {
          headers: adminHeaders,
          data: {
            caseId: `FULL-JOURNEY-${suffix}`,
            company: "E2E Test Company",
            title: "Full Journey Case",
            type: "Long Case",
            duration: "60 minutes",
          },
        },
      );
      expect(caseStudyResponse.status()).toBe(200);
      const caseStudy = await caseStudyResponse.json();

      const assignment = await request.post(
        `/api/admin/users/${attendeeA.id}/case-studies/bulk-assign?eventId=${eventId}`,
        {
          headers: adminHeaders,
          data: { caseStudyIds: [caseStudy.id] },
        },
      );
      expect(assignment.status()).toBe(200);
      expect(await assignment.json()).toMatchObject({
        created: 1,
        skipped: 0,
        failed: 0,
      });

      const published = await request.post(
        `/api/admin/events/${eventId}/publish`,
        {
          headers: adminHeaders,
          data: { confirmStarterTimetable: true },
        },
      );
      expect(published.status()).toBe(200);
      expect((await published.json()).status).toBe("published");

      const staffLogin = await loginAs(request, staff.email, eventId);
      expect(staffLogin.user.role).toBe("staff");
      const staffEvent = await request.get("/api/events/active", {
        headers: authHeaders(staffLogin.token),
      });
      expect(staffEvent.status()).toBe(200);
      expect((await staffEvent.json()).id).toBe(eventId);

      const attendeeALogin = await loginAs(request, attendeeA.email, eventId);
      const attendeeBLogin = await loginAs(request, attendeeB.email, eventId);
      expect(attendeeALogin.user.role).toBe("attendee");
      expect(attendeeBLogin.user.role).toBe("attendee");
      expect(attendeeALogin.user.qrCodeValue).toBeTruthy();
      expect(attendeeBLogin.user.qrCodeValue).toBeTruthy();
      expect(attendeeALogin.user.qrCodeValue).not.toBe(
        attendeeBLogin.user.qrCodeValue,
      );

      const attendeeMe = await request.get("/api/auth/me", {
        headers: authHeaders(attendeeALogin.token),
      });
      expect(attendeeMe.status()).toBe(200);
      expect(await attendeeMe.json()).toMatchObject({
        id: attendeeA.id,
        role: "attendee",
        qrCodeValue: attendeeALogin.user.qrCodeValue,
      });

      const attendeeAQr = attendeeALogin.user.qrCodeValue as string;
      const attendeeBQr = attendeeBLogin.user.qrCodeValue as string;

      const firstScan = await request.post(`/api/check-in?eventId=${eventId}`, {
        headers: authHeaders(staffLogin.token),
        data: { qrCodeValue: attendeeAQr },
      });
      expect(firstScan.status()).toBe(200);
      expect(await firstScan.json()).toMatchObject({
        success: true,
        user: { email: attendeeA.email },
      });

      const duplicateScan = await request.post(
        `/api/check-in?eventId=${eventId}`,
        {
          headers: authHeaders(staffLogin.token),
          data: { qrCodeValue: attendeeAQr },
        },
      );
      expect(duplicateScan.status()).toBe(200);
      expect(await duplicateScan.json()).toMatchObject({
        success: false,
        alreadyCheckedIn: true,
      });

      const secondScan = await request.post(
        `/api/check-in?eventId=${eventId}`,
        {
          headers: authHeaders(staffLogin.token),
          data: { qrCodeValue: attendeeBQr },
        },
      );
      expect(secondScan.status()).toBe(200);
      expect(await secondScan.json()).toMatchObject({ success: true });

      const checkOut = await request.post(`/api/check-out?eventId=${eventId}`, {
        headers: authHeaders(staffLogin.token),
        data: { userId: attendeeB.id },
      });
      expect(checkOut.status()).toBe(200);
      expect(await checkOut.json()).toMatchObject({ success: true });

      const manualCheckIn = await request.post(
        `/api/manual-check-in?eventId=${eventId}`,
        {
          headers: authHeaders(staffLogin.token),
          data: { userId: attendeeB.id },
        },
      );
      expect(manualCheckIn.status()).toBe(200);
      expect(await manualCheckIn.json()).toMatchObject({ success: true });

      const caseStudyScan = await request.post(
        `/api/case-studies/${caseStudy.id}/check-in?eventId=${eventId}`,
        {
          headers: authHeaders(staffLogin.token),
          data: { qrCodeValue: attendeeAQr },
        },
      );
      expect(caseStudyScan.status()).toBe(200);
      expect(await caseStudyScan.json()).toMatchObject({
        success: true,
        user: { id: attendeeA.id },
      });

      const unassignedCaseStudyScan = await request.post(
        `/api/case-studies/${caseStudy.id}/check-in?eventId=${eventId}`,
        {
          headers: authHeaders(staffLogin.token),
          data: { qrCodeValue: attendeeBQr },
        },
      );
      expect(unassignedCaseStudyScan.status()).toBe(200);
      expect(await unassignedCaseStudyScan.json()).toMatchObject({
        success: false,
        notAssigned: true,
      });

      const caseStudyAttendees = await request.get(
        `/api/case-studies/${caseStudy.id}/attendees?eventId=${eventId}`,
        { headers: authHeaders(staffLogin.token) },
      );
      expect(caseStudyAttendees.status()).toBe(200);
      expect(await caseStudyAttendees.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: attendeeA.id,
            checkedIn: true,
          }),
        ]),
      );

      const notification = await request.post(
        `/api/notifications?eventId=${eventId}`,
        {
          headers: authHeaders(staffLogin.token),
          data: {
            title: "Full journey announcement",
            message: "The next session begins soon.",
            type: "announcement",
            targetRole: "all",
          },
        },
      );
      expect(notification.status()).toBe(200);
      const notificationBody = await notification.json();
      expect(notificationBody.id).toBeTruthy();

      const attendeeNotifications = await request.get(
        `/api/notifications?eventId=${eventId}`,
        { headers: authHeaders(attendeeALogin.token) },
      );
      expect(attendeeNotifications.status()).toBe(200);
      expect(await attendeeNotifications.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: notificationBody.id,
            title: "Full journey announcement",
          }),
        ]),
      );

      const markedRead = await request.post(
        `/api/notifications/${notificationBody.id}/read?eventId=${eventId}`,
        { headers: authHeaders(attendeeALogin.token) },
      );
      expect(markedRead.status()).toBe(200);

      const attendeeCannotListUsers = await request.get(
        `/api/attendees?eventId=${eventId}`,
        { headers: authHeaders(attendeeALogin.token) },
      );
      expect(attendeeCannotListUsers.status()).toBe(403);

      const attendeeCannotScan = await request.post(
        `/api/check-in?eventId=${eventId}`,
        {
          headers: authHeaders(attendeeALogin.token),
          data: { qrCodeValue: attendeeBQr },
        },
      );
      expect(attendeeCannotScan.status()).toBe(403);

      const auditActions = await readAuditActions(
        request,
        admin.token,
        eventId,
      );
      for (const action of [
        "create_user",
        "assign_user_case_studies",
        "publish_event",
        "staff_qr_scan",
        "staff_check_out",
        "manual_check_in",
        "case_study_qr_check_in",
        "publish_notification",
      ]) {
        expect(auditActions, `Missing audit action: ${action}`).toContain(
          action,
        );
      }

      const loggedOut = await request.post("/api/auth/logout", {
        headers: authHeaders(attendeeBLogin.token),
      });
      expect(loggedOut.status()).toBe(204);
      const afterLogout = await request.get("/api/auth/me", {
        headers: authHeaders(attendeeBLogin.token),
      });
      expect(afterLogout.status()).toBe(401);
    } finally {
      if (eventId) {
        const cleanup = await request.delete(`/api/admin/events/${eventId}`, {
          headers: adminHeaders,
        });
        expect(
          [200, 404],
          "The disposable event should be removed after the journey",
        ).toContain(cleanup.status());
      }
    }
  });
});
