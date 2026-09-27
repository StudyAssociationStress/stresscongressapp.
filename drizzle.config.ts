import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  // The application owns this migration ledger; Drizzle must not remove it
  // while syncing the application schema.
  tablesFilter: ["!_schema_migrations"],
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
