import { Pool } from "pg";
import {
  assertConfiguredAdministrator,
  getReleaseHistoryCounts,
  requireReleaseHistoryConfirmation,
  resetReleaseHistory,
} from "../server/release-history-reset";

function readFlag(name: string): string | undefined {
  const prefix = `${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix));
  return value?.slice(prefix.length);
}

async function main() {
  const configuredAdminEmail = process.env.ADMIN_EMAIL?.trim();
  if (!configuredAdminEmail) {
    throw new Error(
      "ADMIN_EMAIL must be configured before resetting release history.",
    );
  }
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL must be configured before resetting release history.",
    );
  }

  const dryRun = process.argv.includes("--dry-run");
  if (!dryRun) {
    requireReleaseHistoryConfirmation(readFlag("--confirm"));
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const administrator = await assertConfiguredAdministrator(
      client,
      configuredAdminEmail,
    );

    if (dryRun) {
      const inventory = await getReleaseHistoryCounts(client);
      await client.query("ROLLBACK");
      console.log(
        JSON.stringify(
          {
            mode: "dry-run",
            configuredAdministratorVerified: Boolean(administrator.id),
            historyRecords: inventory,
          },
          null,
          2,
        ),
      );
      return;
    }

    const reset = await resetReleaseHistory(client, configuredAdminEmail);
    await client.query("COMMIT");
    console.log(
      JSON.stringify(
        {
          mode: "completed",
          configuredAdministratorPreserved: Boolean(
            reset.preservedAdministrator.id,
          ),
          deletedRecords: reset.before,
          remainingRecords: reset.after,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Release history reset failed.",
  );
  process.exitCode = 1;
});
