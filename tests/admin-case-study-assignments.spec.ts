import { test, expect } from "@playwright/test";
import { Client } from "pg";
import { WEB_PREVIEW_URL } from "./web-preview";
import {
  TEST_ADMIN_EMAIL,
  TEST_ATTENDEE_EMAIL,
  TEST_PASSWORD,
  TEST_STAFF_EMAIL,
} from "./global-setup";

type Fixture = {
  eventId: string;
  otherEventId: string;
  attendeeIds: string[];
  otherAttendeeId: string;
  caseStudyIds: {
    draft: string;
    concurrent: string;
    capacity: string;
    bulk: string;
    other: string;
  };
};

let client: Client | undefined;
let fixture: Fixture;

async function loginAsAdmin(
  request: import("@playwright/test").APIRequestContext,
): Promise<string> {
  const response = await request.post("/api/auth/login", {
    data: { email: TEST_ADMIN_EMAIL, password: TEST_PASSWORD },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.token).toBeTruthy();
  return body.token as string;
}

async function loginAsStaff(
  request: import("@playwright/test").APIRequestContext,
): Promise<string> {
  const response = await request.post("/api/auth/login", {
    data: { email: TEST_STAFF_EMAIL, password: TEST_PASSWORD },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.token).toBeTruthy();
  return body.token as string;
}

async function assignmentCount(caseStudyId: string): Promise<number> {
  const result = await client!.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM user_case_studies WHERE case_study_id = $1",
    [caseStudyId],
  );
  return Number(result.rows[0].count);
}

test.describe("admin case-study assignment isolation and capacity", () => {
  test.beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    const suffix = `${Date.now().toString(36)}-${process.pid}`;
    const eventId = `e2e-case-study-${suffix}`;
    const otherEventId = `e2e-case-study-other-${suffix}`;
    const attendeeIds = Array.from(
      { length: 152 },
      (_, index) => `e2e-case-study-attendee-${suffix}-${index}`,
    );
    const otherAttendeeId = `e2e-case-study-other-attendee-${suffix}`;
    const caseStudyIds = {
      draft: `e2e-case-study-draft-${suffix}`,
      concurrent: `e2e-case-study-concurrent-${suffix}`,
      capacity: `e2e-case-study-capacity-${suffix}`,
      bulk: `e2e-case-study-bulk-${suffix}`,
      other: `e2e-case-study-other-case-${suffix}`,
    };
    fixture = {
      eventId,
      otherEventId,
      attendeeIds,
      otherAttendeeId,
      caseStudyIds,
    };

    await client.query(
      `INSERT INTO events (id, name, year, status)
       VALUES ($1, 'E2E Draft Case-Study Event', 2198, 'draft'),
              ($2, 'E2E Other Case-Study Event', 2199, 'draft')`,
      [eventId, otherEventId],
    );

    const allUserIds = [...attendeeIds, otherAttendeeId];
    await client.query(
      `INSERT INTO users (id, email, name, role, qr_code_value, event_id)
       SELECT * FROM UNNEST(
         $1::varchar[],
         $2::text[],
         $3::text[],
         $4::text[],
         $5::text[],
         $6::text[]
       )`,
      [
        allUserIds,
        [
          ...attendeeIds.map(
            (_, index) => `e2e-case-study-${suffix}-${index}@stress2026.test`,
          ),
          `e2e-case-study-other-${suffix}@stress2026.test`,
        ],
        [
          ...attendeeIds.map((_, index) => `E2E Case Study Attendee ${index}`),
          "E2E Other Event Attendee",
        ],
        allUserIds.map(() => "attendee"),
        allUserIds.map((id) => `SC-E2E-${id}`),
        [...attendeeIds.map(() => eventId), otherEventId],
      ],
    );

    const caseStudies = [
      [caseStudyIds.draft, "DRAFT", "Draft case", eventId],
      [caseStudyIds.concurrent, "CONCURRENT", "Concurrent case", eventId],
      [caseStudyIds.capacity, "CAPACITY", "Capacity case", eventId],
      [caseStudyIds.bulk, "BULK", "Bulk case", eventId],
      [caseStudyIds.other, "OTHER", "Other event case", otherEventId],
    ];
    await client.query(
      `INSERT INTO case_studies (
         id, case_id, company, title, type, duration, event_id
       )
       SELECT
         item.id,
         item.case_id,
         'E2E Test Company',
         item.title,
         'Long Case',
         '60 minutes',
         item.event_id
       FROM UNNEST($1::varchar[], $2::text[], $3::text[], $4::text[])
         AS item(id, case_id, title, event_id)`,
      [
        caseStudies.map(([id]) => id),
        caseStudies.map(([, caseId]) => caseId),
        caseStudies.map(([, , title]) => title),
        caseStudies.map(([, , , scopedEventId]) => scopedEventId),
      ],
    );
  });

  test.beforeEach(async () => {
    await client!.query(
      "DELETE FROM user_case_studies WHERE case_study_id = ANY($1::varchar[])",
      [Object.values(fixture.caseStudyIds)],
    );
  });

  test.afterAll(async () => {
    if (!client) return;

    try {
      await client.query(
        "DELETE FROM user_case_studies WHERE case_study_id = ANY($1::varchar[])",
        [Object.values(fixture.caseStudyIds)],
      );
      await client.query(
        "DELETE FROM case_studies WHERE id = ANY($1::varchar[])",
        [Object.values(fixture.caseStudyIds)],
      );
      await client.query("DELETE FROM users WHERE id = ANY($1::varchar[])", [
        [...fixture.attendeeIds, fixture.otherAttendeeId],
      ]);
      await client.query("DELETE FROM events WHERE id = ANY($1::varchar[])", [
        [fixture.eventId, fixture.otherEventId],
      ]);
    } finally {
      await client.end();
    }
  });

  test("staff manual check-in never creates a new case-study assignment", async ({
    request,
  }) => {
    const adminToken = await loginAsAdmin(request);
    const staffToken = await loginAsStaff(request);
    const activeEventResult = await client!.query<{ id: string }>(
      "SELECT id FROM events WHERE status = 'published' ORDER BY year DESC LIMIT 1",
    );
    const activeEventId = activeEventResult.rows[0]?.id;
    expect(activeEventId).toBeTruthy();

    const assignedUserResult = await client!.query<{ id: string }>(
      "SELECT id FROM users WHERE email = $1",
      [TEST_ATTENDEE_EMAIL],
    );
    const assignedAttendee = assignedUserResult.rows[0]?.id;
    expect(assignedAttendee).toBeTruthy();

    const suffix = `${Date.now().toString(36)}-${process.pid}`;
    const caseStudyId = `e2e-staff-manual-check-in-${suffix}`;
    const unassignedAttendee = `e2e-staff-unassigned-${suffix}`;
    await client!.query(
      `INSERT INTO case_studies (
         id, case_id, company, title, type, duration, event_id
       ) VALUES ($1, $2, 'E2E Test Company', 'Staff check-in case',
                 'Long Case', '60 minutes', $3)`,
      [caseStudyId, `STAFF-${suffix}`, activeEventId],
    );
    await client!.query(
      `INSERT INTO users (
         id, email, name, role, qr_code_value, event_id
       ) VALUES ($1, $2, 'E2E Unassigned Attendee', 'attendee', $3, $4)`,
      [
        unassignedAttendee,
        `${unassignedAttendee}@stress2026.test`,
        `SC-E2E-${unassignedAttendee}`,
        activeEventId,
      ],
    );

    try {
      const assignment = await request.post(
        `/api/admin/case-studies/${caseStudyId}/assign?eventId=${activeEventId}`,
        {
          headers: { Authorization: `Bearer ${adminToken}` },
          data: { userId: assignedAttendee },
        },
      );
      expect(assignment.status()).toBe(200);

      const checkIn = await request.post(
        `/api/case-studies/${caseStudyId}/manual-check-in?eventId=${activeEventId}`,
        {
          headers: { Authorization: `Bearer ${staffToken}` },
          data: { userId: assignedAttendee },
        },
      );
      expect(checkIn.status()).toBe(200);
      expect(await checkIn.json()).toMatchObject({
        success: true,
        user: { id: assignedAttendee },
      });

      const rejectedAdd = await request.post(
        `/api/case-studies/${caseStudyId}/manual-check-in?eventId=${activeEventId}`,
        {
          headers: { Authorization: `Bearer ${staffToken}` },
          data: { userId: unassignedAttendee },
        },
      );
      expect(rejectedAdd.status()).toBe(200);
      expect(await rejectedAdd.json()).toMatchObject({
        success: false,
        notAssigned: true,
      });
      expect(await assignmentCount(caseStudyId)).toBe(1);

      const rows = await client!.query<{
        checked_in: boolean;
      }>(
        "SELECT checked_in FROM user_case_studies WHERE case_study_id = $1 AND user_id = $2",
        [caseStudyId, assignedAttendee],
      );
      expect(rows.rows).toEqual([{ checked_in: true }]);
    } finally {
      await client!.query(
        "DELETE FROM user_case_studies WHERE case_study_id = $1",
        [caseStudyId],
      );
      await client!.query("DELETE FROM case_studies WHERE id = $1", [
        caseStudyId,
      ]);
      await client!.query("DELETE FROM users WHERE id = $1", [
        unassignedAttendee,
      ]);
    }
  });

  test("an admin can view and change assignments for a selected draft event", async ({
    request,
  }) => {
    const token = await loginAsAdmin(request);
    const headers = { Authorization: `Bearer ${token}` };
    const draftCase = fixture.caseStudyIds.draft;
    const newAttendeeEmail = `new-attendee-${Date.now()}@stress2026.test`;
    const createResponse = await request.post("/api/admin/users", {
      headers,
      data: {
        name: "Newly Added Case Study Attendee",
        email: newAttendeeEmail,
        role: "attendee",
        eventId: fixture.eventId,
      },
    });
    expect([200, 201]).toContain(createResponse.status());
    const createdUser = await createResponse.json();
    expect(createdUser.eventInvitationSent).toBe(false);
    expect(createdUser.eventInvitationDeferred).toBe(true);
    const attendeeId = createdUser.id as string;

    try {
      const usersResponse = await request.get(
        `/api/admin/users?eventId=${fixture.eventId}`,
        { headers },
      );
      expect(usersResponse.status()).toBe(200);
      expect(await usersResponse.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: attendeeId,
            name: "Newly Added Case Study Attendee",
          }),
        ]),
      );

      const optionsResponse = await request.get(
        `/api/admin/users/${attendeeId}/case-studies?eventId=${fixture.eventId}`,
        { headers },
      );
      expect(optionsResponse.status()).toBe(200);
      expect(await optionsResponse.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: draftCase, assigned: false }),
        ]),
      );

      const attendeesListResponse = await request.get(
        `/api/admin/attendees?eventId=${fixture.eventId}`,
        { headers },
      );
      expect(attendeesListResponse.status()).toBe(200);
      const attendeesList = await attendeesListResponse.json();
      expect(attendeesList).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: attendeeId,
            name: "Newly Added Case Study Attendee",
            email: newAttendeeEmail,
          }),
        ]),
      );
      expect(attendeesList).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: fixture.otherAttendeeId }),
        ]),
      );

      const assignResponse = await request.post(
        `/api/admin/users/${attendeeId}/case-studies/bulk-assign?eventId=${fixture.eventId}`,
        { headers, data: { caseStudyIds: [draftCase] } },
      );
      expect(assignResponse.status()).toBe(200);
      expect(await assignResponse.json()).toMatchObject({
        created: 1,
        skipped: 0,
        failed: 0,
      });

      const attendeesResponse = await request.get(
        `/api/admin/case-studies/${draftCase}/attendees?eventId=${fixture.eventId}`,
        { headers },
      );
      expect(attendeesResponse.status()).toBe(200);
      expect(await attendeesResponse.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: attendeeId,
            name: "Newly Added Case Study Attendee",
            email: newAttendeeEmail,
          }),
        ]),
      );
    } finally {
      const removeResponse = await request.delete(
        `/api/admin/users/${attendeeId}?eventId=${fixture.eventId}`,
        { headers },
      );
      expect(removeResponse.status()).toBe(200);
    }
  });

  test("admin dialogs assign multiple cases and keep the selected event isolated", async ({
    request,
    page,
  }) => {
    const token = await loginAsAdmin(request);
    await page.addInitScript((authToken) => {
      window.localStorage.setItem("auth_token", authToken);
    }, token);
    await page.route("**/api/notifications**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      }),
    );
    // The backend's root is the Expo Go landing page; Metro serves the
    // browser bundle used by this smoke test on its own web port.
    await page.goto(WEB_PREVIEW_URL);

    const dismissNotification = page.getByRole("button", {
      name: "Dismiss notification",
    });
    if (await dismissNotification.count()) {
      await dismissNotification.first().click({ force: true });
      await expect(dismissNotification).toHaveCount(0);
    }
    await page.getByTestId("button-open-drawer").click({ force: true });
    const switchEvent = page.getByTestId("button-switch-event");
    await expect(switchEvent).toBeVisible();
    await switchEvent.click();
    await page.getByTestId(`button-select-event-${fixture.eventId}`).click();

    await page.getByText("Manage Users", { exact: true }).click();
    await expect(
      page.getByText("E2E Case Study Attendee 0", { exact: true }),
    ).toBeVisible();

    const userAssignButton = page.getByTestId(
      `button-assign-case-studies-user-${fixture.attendeeIds[0]}`,
    );
    await userAssignButton.click();
    await expect(
      page.getByText("Assign Case Studies", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByTestId(`button-user-case-study-${fixture.caseStudyIds.other}`),
    ).toHaveCount(0);
    await page
      .getByTestId(`button-user-case-study-${fixture.caseStudyIds.draft}`)
      .click();
    await page
      .getByTestId(`button-user-case-study-${fixture.caseStudyIds.concurrent}`)
      .click();

    const assignmentResponse = page.waitForResponse(
      (response) =>
        response
          .url()
          .includes(
            `/api/admin/users/${fixture.attendeeIds[0]}/case-studies/bulk-assign`,
          ) && response.request().method() === "POST",
    );
    await page.getByTestId("button-assign-user-case-studies").click();
    expect(await (await assignmentResponse).json()).toMatchObject({
      created: 2,
      skipped: 0,
      failed: 0,
    });
    expect(await assignmentCount(fixture.caseStudyIds.draft)).toBe(1);
    expect(await assignmentCount(fixture.caseStudyIds.concurrent)).toBe(1);

    await page.getByTestId("button-open-drawer").last().click({ force: true });
    await page.getByText("Manage Case Studies", { exact: true }).click();
    await expect(
      page.getByTestId(`button-edit-cs-${fixture.caseStudyIds.draft}`),
    ).toBeVisible();
    await expect(
      page.getByText("Other event case", { exact: true }),
    ).toHaveCount(0);
    await page
      .getByTestId(`button-cs-attendees-${fixture.caseStudyIds.draft}`)
      .click();
    await expect(
      page.getByText("E2E Case Study Attendee 0", { exact: true }).last(),
    ).toBeVisible();
    await expect(
      page
        .getByTestId(`button-assign-${fixture.attendeeIds[1]}`)
        .getByText("E2E Case Study Attendee 1", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("E2E Other Event Attendee", { exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page
      .getByTestId(`button-edit-cs-${fixture.caseStudyIds.draft}`)
      .click();
    const fixtureAttendeeEmail = `e2e-case-study-${fixture.eventId.replace(
      "e2e-case-study-",
      "",
    )}-0@stress2026.test`;
    await page
      .getByTestId("input-case-study-attendee-emails")
      .fill(`${fixtureAttendeeEmail}\nmissing-ui@stress2026.test`);

    const emailAssignmentResponse = page.waitForResponse(
      (response) =>
        response
          .url()
          .includes(
            `/api/admin/case-studies/${fixture.caseStudyIds.draft}/bulk-assign-emails`,
          ) && response.request().method() === "POST",
    );
    await page.getByTestId("button-save-cs").click();
    expect(await (await emailAssignmentResponse).json()).toMatchObject({
      created: 0,
      skipped: 1,
      missing: 1,
      missingEmails: ["missing-ui@stress2026.test"],
    });
  });

  test("missing, invalid, and mismatched event context cannot expose or alter assignments", async ({
    request,
  }) => {
    const token = await loginAsAdmin(request);
    const headers = { Authorization: `Bearer ${token}` };
    const draftCase = fixture.caseStudyIds.draft;

    const missingContextView = await request.get(
      `/api/admin/case-studies/${draftCase}/attendees`,
      { headers },
    );
    expect(missingContextView.status()).toBe(400);

    const missingContextAssign = await request.post(
      `/api/admin/case-studies/${draftCase}/assign`,
      { headers, data: { userId: fixture.attendeeIds[0] } },
    );
    expect(missingContextAssign.status()).toBe(400);

    const invalidContextView = await request.get(
      `/api/admin/case-studies/${draftCase}/attendees?eventId=not-a-real-event`,
      { headers },
    );
    expect(invalidContextView.status()).toBe(400);

    const invalidContextAssign = await request.post(
      `/api/admin/case-studies/${draftCase}/assign?eventId=not-a-real-event`,
      { headers, data: { userId: fixture.attendeeIds[0] } },
    );
    expect(invalidContextAssign.status()).toBe(400);

    const mismatchedContextView = await request.get(
      `/api/admin/case-studies/${fixture.caseStudyIds.other}/attendees?eventId=${fixture.eventId}`,
      { headers },
    );
    expect(mismatchedContextView.status()).toBe(404);

    const mismatchedContextAssign = await request.post(
      `/api/admin/case-studies/${fixture.caseStudyIds.other}/assign?eventId=${fixture.eventId}`,
      { headers, data: { userId: fixture.otherAttendeeId } },
    );
    expect(mismatchedContextAssign.status()).toBe(404);

    expect(await assignmentCount(draftCase)).toBe(0);
    expect(await assignmentCount(fixture.caseStudyIds.other)).toBe(0);
  });

  test("concurrent assignments for one attendee create exactly one row", async ({
    request,
  }) => {
    const token = await loginAsAdmin(request);
    const headers = { Authorization: `Bearer ${token}` };
    const path = `/api/admin/case-studies/${fixture.caseStudyIds.concurrent}/assign?eventId=${fixture.eventId}`;

    const responses = await Promise.all(
      [0, 1].map(() =>
        request.post(path, {
          headers,
          data: { userId: fixture.attendeeIds[1] },
        }),
      ),
    );

    expect(responses.map((response) => response.status()).sort()).toEqual([
      200, 409,
    ]);
    expect(await assignmentCount(fixture.caseStudyIds.concurrent)).toBe(1);
  });

  test("concurrent requests at capacity stop after the 150th assignment", async ({
    request,
  }) => {
    await client!.query(
      `INSERT INTO user_case_studies (user_id, case_study_id)
       SELECT
         attendee_id,
         $2
       FROM UNNEST($1::varchar[]) AS attendee_id`,
      [fixture.attendeeIds.slice(0, 149), fixture.caseStudyIds.capacity],
    );
    expect(await assignmentCount(fixture.caseStudyIds.capacity)).toBe(149);

    const token = await loginAsAdmin(request);
    const headers = { Authorization: `Bearer ${token}` };
    const path = `/api/admin/case-studies/${fixture.caseStudyIds.capacity}/assign?eventId=${fixture.eventId}`;
    const responses = await Promise.all(
      fixture.attendeeIds
        .slice(149, 151)
        .map((userId) => request.post(path, { headers, data: { userId } })),
    );

    expect(responses.map((response) => response.status()).sort()).toEqual([
      200, 409,
    ]);
    const fullResponse = responses.find(
      (response) => response.status() === 409,
    );
    expect(fullResponse).toBeDefined();
    expect(await fullResponse!.json()).toEqual({
      message: "Case study is full. Choose another case study.",
    });
    expect(await assignmentCount(fixture.caseStudyIds.capacity)).toBe(150);
  });

  test("bulk assignment reports created, skipped, and failed attendees separately", async ({
    request,
  }) => {
    const bulkCase = fixture.caseStudyIds.bulk;
    await client!.query(
      `INSERT INTO user_case_studies (user_id, case_study_id)
       VALUES ($1, $2)`,
      [fixture.attendeeIds[4], bulkCase],
    );

    const token = await loginAsAdmin(request);
    const response = await request.post(
      `/api/admin/case-studies/${bulkCase}/bulk-assign?eventId=${fixture.eventId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          userIds: [
            fixture.attendeeIds[5],
            fixture.attendeeIds[4],
            fixture.otherAttendeeId,
            "missing-e2e-case-study-attendee",
          ],
        },
      },
    );

    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({
      created: 1,
      skipped: 1,
      failed: 2,
      results: expect.arrayContaining([
        expect.objectContaining({
          userId: fixture.attendeeIds[5],
          status: "created",
        }),
        expect.objectContaining({
          userId: fixture.attendeeIds[4],
          status: "skipped",
        }),
        expect.objectContaining({
          userId: fixture.otherAttendeeId,
          status: "error",
        }),
        expect.objectContaining({
          userId: "missing-e2e-case-study-attendee",
          status: "error",
        }),
      ]),
    });
  });
});
