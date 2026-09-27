import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import {
  assertConfiguredAdministrator,
  getReleaseHistoryCounts,
  requireReleaseHistoryConfirmation,
  resetReleaseHistory,
  RELEASE_HISTORY_RESET_CONFIRMATION,
} from "../server/release-history-reset";

test.describe("release history reset", () => {
  test("requires the exact destructive confirmation phrase", () => {
    expect(() => requireReleaseHistoryConfirmation()).toThrow(
      "Refusing to delete release history",
    );
    expect(() =>
      requireReleaseHistoryConfirmation("delete everything"),
    ).toThrow("Refusing to delete release history");
    expect(() =>
      requireReleaseHistoryConfirmation(RELEASE_HISTORY_RESET_CONFIRMATION),
    ).not.toThrow();
  });

  test("removes only historical records and preserves the global administrator", async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query("BEGIN");

    try {
      const administratorResult = await client.query<{
        id: string;
        email: string;
        name: string;
        password_version: number;
      }>(
        `
          SELECT id, email, name, password_version
          FROM users
          WHERE role = 'admin' AND event_id IS NULL
          ORDER BY created_at
          LIMIT 1
        `,
      );
      const administrator = administratorResult.rows[0];
      expect(administrator).toBeTruthy();
      if (!administrator) throw new Error("Expected a global administrator.");

      const ids = {
        audit: randomUUID(),
        session: randomUUID(),
        device: randomUUID(),
        reset: randomUUID(),
        password: randomUUID(),
        login: randomUUID(),
        gdpr: randomUUID(),
      };

      await client.query(
        `INSERT INTO auth_sessions (id, user_id, device_id) VALUES ($1, $2, $3)`,
        [ids.session, administrator.id, `test-device-${ids.session}`],
      );
      await client.query(
        `INSERT INTO notification_devices (id, user_id, device_id)
         VALUES ($1, $2, $3)`,
        [ids.device, administrator.id, `test-device-${ids.device}`],
      );
      await client.query(
        `INSERT INTO password_reset_tokens (
           id, user_id, email, code, purpose, attempts, expires_at
         ) VALUES ($1, $2, $3, $4, 'reset', 0, NOW() + INTERVAL '10 minutes')`,
        [ids.reset, administrator.id, administrator.email, "test-only-hash"],
      );
      await client.query(
        `INSERT INTO password_history (id, user_id, password_hash)
         VALUES ($1, $2, $3)`,
        [ids.password, administrator.id, "test-only-password-hash"],
      );
      await client.query(
        `INSERT INTO login_events (id, email, event_type) VALUES ($1, $2, $3)`,
        [ids.login, administrator.email, "test_reset_history"],
      );
      await client.query(
        `INSERT INTO admin_audit_log (
           id, admin_id, admin_email, action, target_type
         ) VALUES ($1, $2, $3, 'test_reset_history', 'test')`,
        [ids.audit, administrator.id, administrator.email],
      );
      await client.query(
        `INSERT INTO gdpr_requests (
           id, user_id, user_email, user_name, type, status
         ) VALUES ($1, $2, $3, $4, 'data', 'pending')`,
        [ids.gdpr, administrator.id, administrator.email, administrator.name],
      );
      await client.query("UPDATE users SET push_token = $1 WHERE id = $2", [
        "ExponentPushToken[test-only]",
        administrator.id,
      ]);

      const before = await getReleaseHistoryCounts(client);
      expect(before.authSessions).toBeGreaterThan(0);
      expect(before.gdprRequests).toBeGreaterThan(0);

      const result = await resetReleaseHistory(client, administrator.email);
      expect(result.before).toEqual(before);
      expect(result.after).toEqual({
        adminAuditLog: 0,
        loginEvents: 0,
        passwordResetTokens: 0,
        passwordHistory: 0,
        gdprRequests: 0,
        authSessions: 0,
        notificationDevices: 0,
        userPushTokens: 0,
      });
      await expect(
        assertConfiguredAdministrator(client, administrator.email),
      ).resolves.toEqual({
        id: administrator.id,
        passwordVersion: administrator.password_version,
      });

      const retained = await client.query<{
        id: string;
        password_version: number;
        push_token: string | null;
      }>("SELECT id, password_version, push_token FROM users WHERE id = $1", [
        administrator.id,
      ]);
      expect(retained.rows[0]).toEqual({
        id: administrator.id,
        password_version: administrator.password_version,
        push_token: null,
      });
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  });
});
