import { test, expect } from "@playwright/test";

test.describe("production failure signals", () => {
  test("separates process liveness from database/migration readiness", async ({
    request,
  }) => {
    const live = await request.get("/health");
    expect(live.status()).toBe(200);
    expect((await live.json()).status).toBe("ok");

    const ready = await request.get("/health/ready");
    expect(ready.status()).toBe(200);
    await expect(ready.json()).resolves.toMatchObject({
      status: "ready",
      database: "ok",
      migrations: "ok",
    });
  });

  test("returns a correlation id without echoing response bodies in headers", async ({
    request,
  }) => {
    const response = await request.get("/api/events/active");
    expect(response.headers()["x-request-id"]).toBeTruthy();
    expect(response.headers()["x-request-id"]).not.toContain("token");
    expect(response.headers()["x-request-id"]).not.toContain("qr");
  });

  test("accepts a redacted client error and returns a safe reference id", async ({
    request,
  }) => {
    const response = await request.post("/api/client-errors", {
      data: {
        platform: "android",
        appVersion: "1.0.0",
        buildVersion: "7",
        osVersion: "15",
        message: "Synthetic release diagnostics check",
        stack: "synthetic stack",
        componentStack: "synthetic component stack",
      },
    });

    expect(response.status()).toBe(202);
    const body = await response.json();
    expect(body.clientErrorId).toMatch(/^ERR-[A-Z0-9]+$/);
    expect(body.stack).toBeUndefined();
    expect(body.componentStack).toBeUndefined();
  });
});
