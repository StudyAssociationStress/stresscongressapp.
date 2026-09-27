import { test, expect } from "@playwright/test";
import { WEB_PREVIEW_URL } from "./web-preview";

const EVENT = {
  id: "activation-flow-event",
  name: "Activation Flow Event",
  year: 2026,
  displayDate: "September 22, 2026",
  startDate: "2026-09-22",
  endDate: null,
  scheduleStart: null,
  scheduleEnd: null,
  location: "Test Venue",
  logoUrl: null,
  logoShape: "square",
  primaryColor: "#7C3AED",
  accentColor: "#16A34A",
  gradientStart: "#102A43",
  gradientEnd: "#243B53",
  tagline: "A test event",
  showYearOnLogin: true,
  lastPublishedAt: "2026-09-21T08:00:00.000Z",
};

test.describe("activation password setup flow", () => {
  test("verifies the code before showing password requirements", async ({
    page,
  }) => {
    let verificationAttempts = 0;
    let setPasswordAttempts = 0;
    let setPasswordPayload: Record<string, unknown> | undefined;

    await page.addInitScript(() => {
      if (!window.sessionStorage.getItem("activation-test-initialized")) {
        window.localStorage.clear();
        window.sessionStorage.setItem("activation-test-initialized", "true");
      }
    });

    await page.route("**/api/auth/me", async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ message: "Not signed in" }),
      });
    });
    await page.route("**/api/events/active**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(EVENT),
      });
    });
    await page.route("**/api/notifications", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });
    await page.route("**/api/auth/login", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          needsSetup: true,
          event: {
            id: EVENT.id,
            name: EVENT.name,
            year: EVENT.year,
            status: "published",
            needsSetup: true,
            showYearOnLogin: true,
          },
        }),
      });
    });
    await page.route("**/api/auth/request-activation", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message:
            "If this email is registered for an unactivated account, an activation code has been sent.",
        }),
      });
    });
    await page.route("**/api/auth/verify-reset-code", async (route) => {
      verificationAttempts += 1;
      const request = route.request().postDataJSON() as {
        purpose?: string;
        code?: string;
      };
      if (verificationAttempts === 1) {
        expect(request.purpose).toBe("activation");
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            code: "INVALID_CODE",
            message: "Invalid or expired code",
          }),
        });
        return;
      }
      if (verificationAttempts === 2) {
        await route.abort("internetdisconnected");
        return;
      }
      expect(request).toMatchObject({
        purpose: "activation",
        code: "123456",
        eventId: EVENT.id,
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ valid: true }),
      });
    });
    await page.route("**/api/auth/set-password", async (route) => {
      setPasswordAttempts += 1;
      if (setPasswordAttempts === 1) {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            message: "Invalid or expired code. Please request a new one.",
          }),
        });
        return;
      }
      if (setPasswordAttempts === 2) {
        await route.abort("internetdisconnected");
        return;
      }
      setPasswordPayload = route.request().postDataJSON() as Record<
        string,
        unknown
      >;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          token: "test-session-token",
          user: {
            id: "activation-flow-user",
            email: "invited@example.test",
            name: "Invited User",
            role: "attendee",
            qrCodeValue: "activation-flow-qr",
            checkedIn: false,
            photoUrl: null,
          },
        }),
      });
    });

    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto(WEB_PREVIEW_URL);
    await page.getByTestId("input-email").fill("invited@example.test");
    await page.getByTestId("button-continue").click();

    await expect(page.getByTestId("input-activation-code")).toBeVisible();
    await expect(page.getByTestId("activation-heading")).toHaveText(
      "Step 1 of 2: Verify activation code",
    );
    await expect(page.getByTestId("activation-step-indicator")).toHaveAttribute(
      "aria-label",
      "Account setup, step 1 of 2",
    );
    const stepIndicator = page.getByTestId("activation-step-indicator");
    await expect(stepIndicator.getByText("Verify code")).toBeVisible();
    await expect(stepIndicator.getByText("Create password")).toBeVisible();
    const codeLayout = await page.evaluate(() => ({
      innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(codeLayout.documentWidth).toBeLessThanOrEqual(codeLayout.innerWidth);
    const codeHeading = page.getByTestId("activation-heading");
    const codeHeadingBox = await codeHeading.boundingBox();
    const codeIndicatorBox = await stepIndicator.boundingBox();
    expect(codeHeadingBox).not.toBeNull();
    expect(codeIndicatorBox).not.toBeNull();
    expect(codeIndicatorBox!.y + codeIndicatorBox!.height).toBeLessThanOrEqual(
      codeHeadingBox!.y,
    );
    for (const label of ["Verify code", "Create password"]) {
      const labelBox = await stepIndicator.getByText(label).boundingBox();
      expect(labelBox).not.toBeNull();
      expect(labelBox!.height).toBeLessThanOrEqual(28);
    }
    for (const control of [
      page.getByTestId("input-activation-code"),
      page.getByTestId("button-verify-activation"),
      page.getByTestId("button-resend-activation"),
    ]) {
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeVisible();
    }
    await page.reload();
    await expect(page.getByTestId("input-activation-code")).toBeVisible();
    await expect(page.getByTestId("input-activation-code")).toHaveValue("");
    await expect(page.getByTestId("activation-recovery-message")).toContainText(
      "Welcome back",
    );
    await expect(page.getByTestId("button-verify-activation")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(page.getByTestId("input-create-password")).toHaveCount(0);

    await page.getByTestId("input-activation-code").fill("000000");
    await page.getByTestId("button-verify-activation").click();
    await expect(page.getByText("Invalid or expired code")).toBeVisible();
    await expect(page.getByTestId("input-activation-code")).toBeVisible();
    await expect(page.getByTestId("input-create-password")).toHaveCount(0);

    await page.getByTestId("input-activation-code").fill("123456");
    await page.getByTestId("button-verify-activation").click();
    await expect(
      page.getByText("Network error. Please try again."),
    ).toBeVisible();
    await expect(page.getByTestId("input-activation-code")).toBeVisible();
    await expect(page.getByTestId("input-create-password")).toHaveCount(0);
    await expect(page.getByTestId("activation-recovery-message")).toContainText(
      "Try verifying the same code again",
    );
    await expect(
      page.getByText(
        "Enter the 6-digit code sent to invited@example.test. Your password screen will open only after this code is verified.",
        { exact: true },
      ),
    ).toBeVisible();
    const pendingAfterVerificationDisconnect = await page.evaluate(() => {
      const value = window.localStorage.getItem("pending_activation_context");
      return value ? JSON.parse(value) : null;
    });
    expect(pendingAfterVerificationDisconnect).toMatchObject({
      email: "invited@example.test",
      eventId: EVENT.id,
    });
    expect(pendingAfterVerificationDisconnect).not.toHaveProperty("code");
    expect(pendingAfterVerificationDisconnect).not.toHaveProperty("password");

    await page.getByTestId("button-verify-activation").click();

    await expect(page.getByTestId("input-create-password")).toBeVisible();
    await expect(page.getByTestId("create-password-heading")).toHaveText(
      "Step 2 of 2: Create your password",
    );
    await expect(page.getByTestId("activation-step-indicator")).toHaveAttribute(
      "aria-label",
      "Account setup, step 2 of 2",
    );
    await expect(page.getByTestId("input-activation-code")).toHaveCount(0);
    await expect(
      page.getByTestId("password-requirement-length"),
    ).toHaveAttribute("aria-label", "At least 8 characters: not checked");
    await expect(
      page.getByTestId("password-requirement-number"),
    ).toHaveAttribute("aria-label", "At least one number: not checked");
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    for (const control of [
      page.getByTestId("input-create-password"),
      page.getByTestId("input-create-confirm-password"),
      page.getByTestId("password-requirement-length"),
      page.getByTestId("password-requirement-number"),
      page.getByTestId("button-create-password"),
    ]) {
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeVisible();
    }

    await page.getByTestId("input-create-password").fill("Longpass1");
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.getByTestId("input-activation-code")).toBeVisible();
    await expect(page.getByTestId("input-create-password")).toHaveCount(0);
    await expect(page.getByTestId("activation-recovery-message")).toContainText(
      "For security",
    );

    await page.reload();
    await expect(page.getByTestId("input-activation-code")).toBeVisible();
    await expect(page.getByTestId("input-create-password")).toHaveCount(0);
    await expect(page.getByTestId("input-activation-code")).toHaveValue("");
    await expect(page.getByTestId("activation-heading")).toHaveText(
      "Step 1 of 2: Verify activation code",
    );
    await expect(
      page.getByText(
        "Enter the 6-digit code sent to invited@example.test. Your password screen will open only after this code is verified.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByTestId("login-event-name")).toContainText(
      "Activation Flow Event",
    );
    await expect(page.getByTestId("activation-recovery-message")).toContainText(
      "Welcome back",
    );
    const persistedActivationContext = await page.evaluate(() => {
      const value = window.localStorage.getItem("pending_activation_context");
      return value ? JSON.parse(value) : null;
    });
    expect(persistedActivationContext).toMatchObject({
      email: "invited@example.test",
      eventId: EVENT.id,
    });
    expect(persistedActivationContext).not.toHaveProperty("code");
    expect(persistedActivationContext).not.toHaveProperty("password");
    expect(JSON.stringify(persistedActivationContext)).not.toContain(
      "Longpass1",
    );

    await page.getByTestId("input-activation-code").fill("123456");
    await page.getByTestId("button-verify-activation").click();
    await page.getByTestId("input-create-password").fill("short");
    await expect(
      page.getByTestId("password-requirement-length"),
    ).toHaveAttribute("aria-label", "At least 8 characters: not met");
    await expect(
      page.getByTestId("password-requirement-number"),
    ).toHaveAttribute("aria-label", "At least one number: not met");

    await page.getByTestId("input-create-password").fill("Longpass1");
    await page.getByTestId("input-create-confirm-password").fill("Longpass1");
    await expect(
      page.getByTestId("password-requirement-length"),
    ).toHaveAttribute("aria-label", "At least 8 characters: complete");
    await expect(
      page.getByTestId("password-requirement-number"),
    ).toHaveAttribute("aria-label", "At least one number: complete");
    await expect(
      page.getByTestId("button-create-password"),
    ).not.toHaveAttribute("aria-disabled", "true");

    await page.getByTestId("button-create-password").click();
    await expect(page.getByTestId("input-activation-code")).toBeVisible();
    await expect(page.getByTestId("input-create-password")).toHaveCount(0);
    await expect(page.getByTestId("activation-recovery-message")).toContainText(
      "expired before the password was saved",
    );
    await expect(page.getByTestId("button-resend-activation")).toBeVisible();

    await page.getByTestId("input-activation-code").fill("123456");
    await page.getByTestId("button-verify-activation").click();
    await page.getByTestId("input-create-password").fill("Longpass1");
    await page.getByTestId("input-create-confirm-password").fill("Longpass1");
    await page.getByTestId("button-create-password").click();
    await expect(
      page.getByText("Network error. Please try again."),
    ).toBeVisible();
    await expect(page.getByTestId("input-create-password")).toBeVisible();
    await expect(page.getByTestId("input-create-password")).toHaveValue(
      "Longpass1",
    );
    await expect(page.getByTestId("input-create-confirm-password")).toHaveValue(
      "Longpass1",
    );
    await expect(page.getByTestId("activation-recovery-message")).toContainText(
      "Try creating the password again",
    );
    const pendingAfterPasswordDisconnect = await page.evaluate(() => {
      const value = window.localStorage.getItem("pending_activation_context");
      return value ? JSON.parse(value) : null;
    });
    expect(pendingAfterPasswordDisconnect).toMatchObject({
      email: "invited@example.test",
      eventId: EVENT.id,
    });
    expect(pendingAfterPasswordDisconnect).not.toHaveProperty("code");
    expect(pendingAfterPasswordDisconnect).not.toHaveProperty("password");
    expect(JSON.stringify(pendingAfterPasswordDisconnect)).not.toContain(
      "Longpass1",
    );

    await page.getByTestId("button-create-password").click();
    await expect
      .poll(() => setPasswordPayload)
      .toMatchObject({
        email: "invited@example.test",
        code: "123456",
        newPassword: "Longpass1",
        eventId: EVENT.id,
      });
  });
});
