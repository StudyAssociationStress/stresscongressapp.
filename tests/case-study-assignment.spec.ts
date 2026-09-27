import { test, expect } from "@playwright/test";
import {
  TEST_ADMIN_EMAIL,
  TEST_ATTENDEE_EMAIL,
  TEST_PASSWORD,
} from "./global-setup";

async function loginAs(
  request: import("@playwright/test").APIRequestContext,
  email: string,
) {
  const response = await request.post("/api/auth/login", {
    data: { email, password: TEST_PASSWORD },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).token as string;
}

test.describe("case study assignment workflows", () => {
  test("assigns multiple case studies from a user and reports missing emails", async ({
    request,
  }) => {
    const token = await loginAs(request, TEST_ADMIN_EMAIL);
    const headers = { Authorization: `Bearer ${token}` };
    const suffix = Date.now();
    const createdIds: string[] = [];
    const events = await (
      await request.get("/api/admin/events", { headers })
    ).json();
    const eventId = events.find(
      (event: { status: string }) => event.status === "published",
    ).id;

    try {
      for (const index of [1, 2]) {
        const response = await request.post("/api/admin/case-studies", {
          headers,
          data: {
            caseId: `e2e-assignment-${suffix}-${index}`,
            company: "E2E Assignment Company",
            title: `E2E Assignment Case ${index}`,
            type: "Short Case",
            duration: "30 min",
            eventId,
          },
        });
        expect(response.status()).toBe(200);
        createdIds.push((await response.json()).id);
      }

      const usersResponse = await request.get(
        `/api/admin/users?eventId=${eventId}`,
        { headers },
      );
      expect(usersResponse.status()).toBe(200);
      const attendee = (await usersResponse.json()).find(
        (user: { email: string }) =>
          user.email.toLowerCase() === TEST_ATTENDEE_EMAIL.toLowerCase(),
      );
      expect(attendee?.id).toBeTruthy();

      const directResponse = await request.post(
        `/api/admin/users/${attendee.id}/case-studies/bulk-assign`,
        {
          headers,
          data: { caseStudyIds: createdIds, eventId },
        },
      );
      expect(directResponse.status()).toBe(200);
      expect(await directResponse.json()).toMatchObject({
        created: 2,
        skipped: 0,
        failed: 0,
      });

      const optionsResponse = await request.get(
        `/api/admin/users/${attendee.id}/case-studies?eventId=${eventId}`,
        { headers },
      );
      expect(optionsResponse.status()).toBe(200);
      expect(
        (await optionsResponse.json()).filter(
          (caseStudy: { id: string; assigned: boolean }) =>
            createdIds.includes(caseStudy.id) && caseStudy.assigned,
        ),
      ).toHaveLength(2);

      const emailResponse = await request.post(
        `/api/admin/case-studies/${createdIds[0]}/bulk-assign-emails?eventId=${eventId}`,
        {
          headers,
          data: {
            emails: [
              TEST_ATTENDEE_EMAIL.toUpperCase(),
              "not-registered@stress2026.test",
              "not-an-email",
            ],
          },
        },
      );
      expect(emailResponse.status()).toBe(200);
      expect(await emailResponse.json()).toMatchObject({
        created: 0,
        skipped: 1,
        missing: 1,
        invalid: 1,
        missingEmails: ["not-registered@stress2026.test"],
        invalidEmails: ["not-an-email"],
      });

      const deleteResponse = await request.delete(
        `/api/admin/case-studies/${createdIds[0]}?eventId=${eventId}`,
        { headers },
      );
      expect(deleteResponse.status()).toBe(200);
      expect(
        (
          await (
            await request.get("/api/admin/case-studies", { headers })
          ).json()
        ).some((caseStudy: { id: string }) => caseStudy.id === createdIds[0]),
      ).toBe(false);

      const deletedAssignmentsResponse = await request.get(
        `/api/admin/case-studies/${createdIds[0]}/attendees?eventId=${eventId}`,
        { headers },
      );
      expect(deletedAssignmentsResponse.status()).toBe(404);
    } finally {
      await Promise.all(
        createdIds.map((id) =>
          request.delete(`/api/admin/case-studies/${id}?eventId=${eventId}`, {
            headers,
          }),
        ),
      );
    }
  });
});
