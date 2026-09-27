import type { PoolClient } from "pg";

export const RELEASE_HISTORY_RESET_CONFIRMATION = "RESET_RELEASE_HISTORY";

type Queryable = Pick<PoolClient, "query">;

export type ReleaseHistoryCounts = {
  adminAuditLog: number;
  loginEvents: number;
  passwordResetTokens: number;
  passwordHistory: number;
  gdprRequests: number;
  authSessions: number;
  notificationDevices: number;
  userPushTokens: number;
};

type ReleaseHistoryCountRow = {
  admin_audit_log: number | string;
  login_events: number | string;
  password_reset_tokens: number | string;
  password_history: number | string;
  gdpr_requests: number | string;
  auth_sessions: number | string;
  notification_devices: number | string;
  user_push_tokens: number | string;
};

export type PreservedAdministrator = {
  id: string;
  passwordVersion: number;
};

export type ReleaseHistoryResetResult = {
  before: ReleaseHistoryCounts;
  after: ReleaseHistoryCounts;
  preservedAdministrator: PreservedAdministrator;
};

const HISTORY_COUNT_QUERY = `
  SELECT
    (SELECT COUNT(*)::int FROM admin_audit_log) AS admin_audit_log,
    (SELECT COUNT(*)::int FROM login_events) AS login_events,
    (SELECT COUNT(*)::int FROM password_reset_tokens) AS password_reset_tokens,
    (SELECT COUNT(*)::int FROM password_history) AS password_history,
    (SELECT COUNT(*)::int FROM gdpr_requests) AS gdpr_requests,
    (SELECT COUNT(*)::int FROM auth_sessions) AS auth_sessions,
    (SELECT COUNT(*)::int FROM notification_devices) AS notification_devices,
    (SELECT COUNT(*)::int FROM users WHERE push_token IS NOT NULL) AS user_push_tokens
`;

function toCount(value: number | string): number {
  return typeof value === "number" ? value : Number.parseInt(value, 10);
}

export function requireReleaseHistoryConfirmation(value?: string) {
  if (value !== RELEASE_HISTORY_RESET_CONFIRMATION) {
    throw new Error(
      `Refusing to delete release history. Pass --confirm=${RELEASE_HISTORY_RESET_CONFIRMATION} immediately before execution.`,
    );
  }
}

export async function getReleaseHistoryCounts(
  client: Queryable,
): Promise<ReleaseHistoryCounts> {
  const result =
    await client.query<ReleaseHistoryCountRow>(HISTORY_COUNT_QUERY);
  const row = result.rows[0];
  if (!row) throw new Error("Unable to inventory release history.");

  return {
    adminAuditLog: toCount(row.admin_audit_log),
    loginEvents: toCount(row.login_events),
    passwordResetTokens: toCount(row.password_reset_tokens),
    passwordHistory: toCount(row.password_history),
    gdprRequests: toCount(row.gdpr_requests),
    authSessions: toCount(row.auth_sessions),
    notificationDevices: toCount(row.notification_devices),
    userPushTokens: toCount(row.user_push_tokens),
  };
}

export async function assertConfiguredAdministrator(
  client: Queryable,
  configuredAdminEmail: string,
): Promise<PreservedAdministrator> {
  const result = await client.query<{
    id: string;
    password_version: number;
  }>(
    `
      SELECT id, password_version
      FROM users
      WHERE role = 'admin'
        AND event_id IS NULL
        AND lower(trim(email)) = lower(trim($1))
      LIMIT 1
    `,
    [configuredAdminEmail],
  );
  const administrator = result.rows[0];
  if (!administrator) {
    throw new Error(
      "Refusing to reset release history because the configured global administrator is unavailable.",
    );
  }

  return {
    id: administrator.id,
    passwordVersion: administrator.password_version,
  };
}

export async function resetReleaseHistory(
  client: Queryable,
  configuredAdminEmail: string,
): Promise<ReleaseHistoryResetResult> {
  const preservedAdministrator = await assertConfiguredAdministrator(
    client,
    configuredAdminEmail,
  );
  const before = await getReleaseHistoryCounts(client);

  await client.query("DELETE FROM notification_devices");
  await client.query("DELETE FROM auth_sessions");
  await client.query("DELETE FROM password_reset_tokens");
  await client.query("DELETE FROM password_history");
  await client.query("DELETE FROM gdpr_requests");
  await client.query("DELETE FROM login_events");
  await client.query("DELETE FROM admin_audit_log");
  await client.query(
    "UPDATE users SET push_token = NULL WHERE push_token IS NOT NULL",
  );

  const after = await getReleaseHistoryCounts(client);
  if (Object.values(after).some((count) => count !== 0)) {
    throw new Error(
      "Release history reset did not remove every requested record; rolling back.",
    );
  }

  const administrator = await assertConfiguredAdministrator(
    client,
    configuredAdminEmail,
  );
  if (
    administrator.id !== preservedAdministrator.id ||
    administrator.passwordVersion !== preservedAdministrator.passwordVersion
  ) {
    throw new Error(
      "Configured administrator changed during reset; rolling back.",
    );
  }

  return { before, after, preservedAdministrator };
}
