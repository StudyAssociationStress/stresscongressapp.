import { test, expect, APIRequestContext } from "@playwright/test";
import {
  TEST_ADMIN_EMAIL,
  TEST_EVENT_ADMIN_EMAIL,
  TEST_STAFF_EMAIL,
  TEST_ATTENDEE_EMAIL,
  TEST_ATTENDEE_QR,
  TEST_OTHER_ATTENDEE_EMAIL,
  TEST_OTHER_EVENT_ID,
  TEST_PASSWORD,
} from "./global-setup";
import { AuditLogWriteError, writeAuditRecord } from "../server/audit";

async function login(
  request: APIRequestContext,
  email: string,
): Promise<string> {
  const response = await request.post("/api/auth/login", {
    data: { email, password: TEST_PASSWORD },
  });
  expect(response.status(), `Login failed for ${email}`).toBe(200);
  return (await response.json()).token as string;
}

async function waitForAudit(
  request: APIRequestContext,
  token: string,
  eventId: string,
  predicate: (entry: {
    action: string;
    metadata: string | null;
    adminEmail: string;
  }) => boolean,
) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await request.get(
      `/api/admin/audit-log?eventId=${eventId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    expect(response.status()).toBe(200);
    const body = await response.json();
    const entries = Array.isArray(body) ? body : body.entries || [];
    const found = entries.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Expected audit entry was not written");
}

test.describe("admin audit and export safety", () => {
  test("surfaces audit persistence failures without exposing database details", async () => {
    const diagnostics: unknown[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => diagnostics.push(args);
    try {
      await expect(
        writeAuditRecord(
          async () => {
            throw Object.assign(new Error("contains-email@example.com"), {
              code: "23505",
            });
          },
          { action: "delete_user", targetType: "user" },
        ),
      ).rejects.toBeInstanceOf(AuditLogWriteError);
    } finally {
      console.error = originalError;
    }

    expect(diagnostics).toHaveLength(1);
    expect(JSON.stringify(diagnostics)).toContain('"errorCode":"23505"');
    expect(JSON.stringify(diagnostics)).not.toContain(
      "contains-email@example.com",
    );
  });

  test("only admins can download bounded security, GDPR, and audit exports", async ({
    request,
  }) => {
    const staffToken = await login(request, TEST_STAFF_EMAIL);
    const attendeeToken = await login(request, TEST_ATTENDEE_EMAIL);
    const adminToken = await login(request, TEST_ADMIN_EMAIL);
    const activeEvent = await request.get("/api/events/active");
    expect(activeEvent.status()).toBe(200);
    const activeEventId = (await activeEvent.json()).id as string;
    const paths = [
      "/api/admin/security-log/export",
      "/api/admin/gdpr/export",
      `/api/admin/audit-log/export?eventId=${activeEventId}`,
    ];

    for (const token of [staffToken, attendeeToken]) {
      for (const path of paths) {
        const denied = await request.get(path, {
          headers: { Authorization: `Bearer ${token}` },
        });
        expect(denied.status(), `${path} should be admin-only`).toBe(403);
      }
    }

    for (const path of paths) {
      const exported = await request.get(path, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(exported.status(), `${path} should export for admins`).toBe(200);
      expect(exported.headers()["content-type"]).toContain("text/csv");
      const body = await exported.text();
      expect(body).not.toContain(TEST_ATTENDEE_QR);
      expect(body).not.toMatch(/password_reset_tokens|token_hash|claim_token/i);
    }
  });

  test("event-scoped admins cannot read or export another event's reports", async ({
    request,
  }) => {
    const token = await login(request, TEST_EVENT_ADMIN_EMAIL);
    const activeEvent = await request.get("/api/events/active");
    expect(activeEvent.status()).toBe(200);
    const activeEventId = (await activeEvent.json()).id as string;
    const headers = { Authorization: `Bearer ${token}` };

    const security = await request.get(
      `/api/admin/security-log?eventId=${activeEventId}`,
      { headers },
    );
    expect(security.status()).toBe(200);
    expect(JSON.stringify(await security.json())).not.toContain(
      TEST_OTHER_ATTENDEE_EMAIL,
    );

    const gdpr = await request.get(
      `/api/admin/gdpr-requests?eventId=${activeEventId}&status=all`,
      { headers },
    );
    expect(gdpr.status()).toBe(200);
    expect(JSON.stringify(await gdpr.json())).not.toContain(
      TEST_OTHER_ATTENDEE_EMAIL,
    );

    const audit = await request.get(
      `/api/admin/audit-log?eventId=${activeEventId}`,
      { headers },
    );
    expect(audit.status()).toBe(200);
    expect(JSON.stringify(await audit.json())).not.toContain(
      TEST_OTHER_EVENT_ID,
    );

    const auditScopes = await request.get("/api/admin/audit-events", {
      headers,
    });
    expect(auditScopes.status()).toBe(200);
    expect(JSON.stringify(await auditScopes.json())).not.toContain(
      TEST_OTHER_EVENT_ID,
    );

    for (const path of [
      `/api/admin/security-log?eventId=${TEST_OTHER_EVENT_ID}`,
      `/api/admin/security-log/export?eventId=${TEST_OTHER_EVENT_ID}`,
      `/api/admin/gdpr/export?eventId=${TEST_OTHER_EVENT_ID}`,
      `/api/admin/audit-log/export?eventId=${TEST_OTHER_EVENT_ID}`,
      `/api/admin/gdpr-requests?eventId=${TEST_OTHER_EVENT_ID}`,
      `/api/admin/audit-log?eventId=${TEST_OTHER_EVENT_ID}`,
    ]) {
      const response = await request.get(path, { headers });
      expect(response.status(), `${path} should be denied`).toBe(403);
    }
  });

  test("preserves a safe event snapshot after deletion", async ({
    request,
  }) => {
    const token = await login(request, TEST_ADMIN_EMAIL);
    const headers = { Authorization: `Bearer ${token}` };
    const eventName = `Audit deletion ${Date.now()}`;
    const created = await request.post("/api/admin/events", {
      headers,
      data: { name: eventName, year: 2290 },
    });
    expect(created.status()).toBe(200);
    const eventId = (await created.json()).id as string;
    const createAudit = await waitForAudit(
      request,
      token,
      eventId,
      (entry) =>
        entry.action === "create_event" &&
        entry.metadata?.includes(eventId) === true,
    );
    expect(createAudit.metadata).toContain(eventName);

    const liveDraftScopes = await request.get("/api/admin/audit-events", {
      headers,
    });
    expect(liveDraftScopes.status()).toBe(200);
    const liveDraftScope = (await liveDraftScopes.json()).find(
      (scope: { id: string; name: string; year: number; deleted: boolean }) =>
        scope.id === eventId,
    );
    expect(liveDraftScope).toMatchObject({
      id: eventId,
      name: eventName,
      year: 2290,
      deleted: false,
    });

    const scopedHistory = await request.get(
      `/api/admin/audit-log?eventId=${encodeURIComponent(eventId)}`,
      { headers },
    );
    expect(scopedHistory.status()).toBe(200);
    const scopedEntries = (await scopedHistory.json()).entries;
    expect(
      scopedEntries.some(
        (entry: { action: string; metadata: string | null }) =>
          entry.action === "create_event" &&
          entry.metadata?.includes(eventName) === true,
      ),
    ).toBe(true);
    expect(
      scopedEntries.every(
        (entry: { metadata: string | null }) =>
          entry.metadata?.includes(eventId) === true,
      ),
    ).toBe(true);

    const updated = await request.put(`/api/admin/events/${eventId}`, {
      headers,
      data: { tagline: "Retained edit history" },
    });
    expect(updated.status()).toBe(200);
    const updateAudit = await waitForAudit(
      request,
      token,
      eventId,
      (entry) =>
        entry.action === "update_event" &&
        entry.metadata?.includes("tagline") === true,
    );
    expect(updateAudit.metadata).toContain(eventName);

    const deleted = await request.delete(`/api/admin/events/${eventId}`, {
      headers,
    });
    expect(deleted.status()).toBe(200);
    const audit = await waitForAudit(
      request,
      token,
      eventId,
      (entry) =>
        entry.action === "delete_event" &&
        entry.metadata?.includes(eventId) === true,
    );
    expect(audit.metadata).toContain(eventName);
    expect(audit.adminEmail).toBe(TEST_ADMIN_EMAIL);

    const auditScopes = await request.get("/api/admin/audit-events", {
      headers,
    });
    expect(auditScopes.status()).toBe(200);
    const deletedScope = (await auditScopes.json()).find(
      (scope: { id: string; name: string; deleted: boolean }) =>
        scope.id === eventId,
    );
    expect(deletedScope).toMatchObject({
      id: eventId,
      name: eventName,
      deleted: true,
    });

    const exported = await request.get(
      `/api/admin/audit-log/export?eventId=${eventId}`,
      { headers },
    );
    expect(exported.status()).toBe(200);
    const csv = await exported.text();
    expect(csv).toContain("create_event");
    expect(csv).toContain("update_event");
    expect(csv).toContain("delete_event");
  });

  test("lists audit events newest first by creation time", async ({
    request,
  }) => {
    const token = await login(request, TEST_ADMIN_EMAIL);
    const headers = { Authorization: `Bearer ${token}` };
    const suffix = Date.now();
    const olderName = `Audit order older ${suffix}`;
    const newerName = `Audit order newer ${suffix}`;
    const createdIds: string[] = [];

    try {
      for (const name of [olderName, newerName]) {
        const response = await request.post("/api/admin/events", {
          headers,
          data: { name, year: 2031 },
        });
        expect(response.status()).toBe(200);
        createdIds.push((await response.json()).id as string);
      }

      const scopesResponse = await request.get("/api/admin/audit-events", {
        headers,
      });
      expect(scopesResponse.status()).toBe(200);
      const scopes = (await scopesResponse.json()) as {
        id: string;
        name: string;
      }[];
      const olderIndex = scopes.findIndex((scope) => scope.name === olderName);
      const newerIndex = scopes.findIndex((scope) => scope.name === newerName);

      expect(olderIndex).toBeGreaterThanOrEqual(0);
      expect(newerIndex).toBeGreaterThanOrEqual(0);
      expect(newerIndex).toBeLessThan(olderIndex);
    } finally {
      for (const eventId of createdIds) {
        const response = await request.delete(`/api/admin/events/${eventId}`, {
          headers,
        });
        expect(response.status()).toBe(200);
      }
    }
  });

  test("records staff attribution and outcomes for scan and manual check-in activity", async ({
    request,
  }) => {
    const staffToken = await login(request, TEST_STAFF_EMAIL);
    const adminToken = await login(request, TEST_ADMIN_EMAIL);
    const headers = { Authorization: `Bearer ${staffToken}` };
    const activeEvent = await request.get("/api/events/active");
    expect(activeEvent.status()).toBe(200);
    const activeEventId = (await activeEvent.json()).id as string;

    const scan = await request.post("/api/check-in", {
      headers,
      data: { qrCodeValue: `unknown-audit-${Date.now()}` },
    });
    expect(scan.status()).toBe(404);

    const manual = await request.post("/api/manual-check-in", {
      headers,
      data: { userId: "missing-audit-user" },
    });
    expect(manual.status()).toBe(404);

    const checkout = await request.post("/api/check-out", {
      headers,
      data: { userId: "missing-audit-user" },
    });
    expect(checkout.status()).toBe(404);

    const caseStudies = await request.get("/api/admin/case-studies", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(caseStudies.status()).toBe(200);
    const studies = await caseStudies.json();
    if (studies[0]?.id) {
      const caseScan = await request.post(
        `/api/case-studies/${studies[0].id}/check-in`,
        {
          headers,
          data: { qrCodeValue: `unknown-case-audit-${Date.now()}` },
        },
      );
      expect(caseScan.status()).toBe(404);
    }

    const scanAudit = await waitForAudit(
      request,
      adminToken,
      activeEventId,
      (entry) =>
        entry.action === "staff_qr_scan" &&
        entry.adminEmail === TEST_STAFF_EMAIL,
    );
    expect(scanAudit.metadata).toMatch(/failed|recorded/);
    const manualAudit = await waitForAudit(
      request,
      adminToken,
      activeEventId,
      (entry) =>
        entry.action === "manual_check_in" &&
        entry.adminEmail === TEST_STAFF_EMAIL,
    );
    expect(manualAudit.metadata).toMatch(/failed|recorded/);
    const checkoutAudit = await waitForAudit(
      request,
      adminToken,
      activeEventId,
      (entry) =>
        entry.action === "staff_check_out" &&
        entry.adminEmail === TEST_STAFF_EMAIL,
    );
    expect(checkoutAudit.metadata).toMatch(/failed|recorded/);
  });
});
