import { defineConfig } from "@playwright/test";

// Runs only fake-mailer and pure formatting checks. The normal Playwright
// setup modifies the shared event database and must not run for these checks.
export default defineConfig({
  testDir: "./tests",
  testMatch: "auth-activation-security.spec.ts",
  grep: /outbox (worker|claim contention|delivery|does not)|fake mailers may exercise|escapes markup-like|formats human-friendly/,
  workers: 1,
  reporter: "list",
});
