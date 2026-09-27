import { test, expect, type Page } from "@playwright/test";
import { WEB_PREVIEW_URL } from "./web-preview";

const INVITED_EMAIL = "invited-account@stress2026.test";
const ACTIVATION_CODE = "123456";
const INVALID_CODE = "111111";
const EXHAUSTED_CODE = "222222";
const NEW_PASSWORD = "ValidPass1";
const ACTIVATION_HEADING = "Step 1 of 2: Verify activation code";

const eventTheme = {
  id: "activation-flow-event",
  name: "Activation Flow Event",
  year: 2026,
  displayDate: "September 21, 2026",
  startDate: "2026-09-21",
  endDate: "2026-09-22",
  location: "Test venue",
  logoUrl: null,
  logoShape: "square",
  primaryColor: "#0c0057",
  accentColor: "#f78f1e",
  gradientStart: "#0c0057",
  gradientEnd: "#1a0a7a",
  tagline: null,
  showYearOnLogin: true,
  lastPublishedAt: "2026-09-21T00:00:00.000Z",
};

async function mockActivationFlow(
  page: Page,
  verifyCode: (code: string) => { status: number; body: object },
) {
  await page.route("**/api/events/active**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(eventTheme),
    });
  });

  await page.route("**/api/auth/login", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        needsSetup: true,
        accountType: "event",
        event: { id: eventTheme.id },
      }),
    });
  });

  await page.route("**/api/auth/request-activation", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ message: "Activation code sent" }),
    });
  });

  await page.route("**/api/auth/verify-reset-code", async (route) => {
    const requestBody = route.request().postDataJSON() as {
      code?: string;
      purpose?: string;
    };
    expect(requestBody.purpose).toBe("activation");
    const response = verifyCode(requestBody.code ?? "");
    await route.fulfill({
      status: response.status,
      contentType: "application/json",
      body: JSON.stringify(response.body),
    });
  });

  await page.route("**/api/auth/set-password", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        token: "browser-test-token",
        user: {
          id: "activation-flow-user",
          email: INVITED_EMAIL,
          name: "Invited Account",
          role: "attendee",
          eventId: eventTheme.id,
        },
      }),
    });
  });
}

async function openActivationCodeScreen(page: Page) {
  await page.goto(WEB_PREVIEW_URL, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("input-email")).toBeVisible();

  await page.getByTestId("input-email").fill(INVITED_EMAIL);
  await page.getByTestId("button-continue").click();

  await expect(page.getByTestId("activation-heading")).toHaveText(
    ACTIVATION_HEADING,
  );
  await expect(page.getByTestId("input-activation-code")).toBeVisible();
}

test.describe("invited account activation flow", () => {
  test("keeps invalid codes on the activation-code screen", async ({
    page,
  }) => {
    await mockActivationFlow(page, (code) => ({
      status: 400,
      body: {
        message:
          code === INVALID_CODE ? "Invalid or expired activation code" : "",
      },
    }));
    await openActivationCodeScreen(page);

    await page.getByTestId("input-activation-code").fill(INVALID_CODE);
    await page.getByTestId("button-verify-activation").click();

    await expect(page.getByTestId("activation-heading")).toHaveText(
      ACTIVATION_HEADING,
    );
    await expect(page.getByTestId("create-password-heading")).toHaveCount(0);
    await expect(
      page.getByText("Invalid or expired activation code", { exact: true }),
    ).toBeVisible();
  });

  test("blocks exhausted codes without exposing password creation", async ({
    page,
  }) => {
    await mockActivationFlow(page, (code) => ({
      status: code === EXHAUSTED_CODE ? 429 : 400,
      body:
        code === EXHAUSTED_CODE
          ? {
              code: "VERIFICATION_ATTEMPTS_EXCEEDED",
              message: "Too many verification attempts. Request a new code.",
            }
          : { message: "Invalid or expired activation code" },
    }));
    await openActivationCodeScreen(page);

    await page.getByTestId("input-activation-code").fill(EXHAUSTED_CODE);
    await page.getByTestId("button-verify-activation").click();

    await expect(
      page.getByText("Too many verification attempts. Request a new code.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByTestId("activation-heading")).toHaveText(
      ACTIVATION_HEADING,
    );
    await expect(page.getByTestId("create-password-heading")).toHaveCount(0);
    await expect(page.getByTestId("button-verify-activation")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  test("shows live password requirements and submits the verified code", async ({
    page,
  }) => {
    await mockActivationFlow(page, (code) => ({
      status: code === ACTIVATION_CODE ? 200 : 400,
      body:
        code === ACTIVATION_CODE
          ? { valid: true }
          : { message: "Invalid or expired activation code" },
    }));
    await openActivationCodeScreen(page);

    await page.getByTestId("input-activation-code").fill(ACTIVATION_CODE);
    await page.getByTestId("button-verify-activation").click();

    await expect(page.getByTestId("create-password-heading")).toHaveText(
      "Step 2 of 2: Create your password",
    );
    await expect(page.getByTestId("activation-heading")).toHaveCount(0);

    const lengthRequirement = page.getByText("At least 8 characters", {
      exact: true,
    });
    const numberRequirement = page.getByText("At least one number", {
      exact: true,
    });
    await expect(lengthRequirement).toBeVisible();
    await expect(numberRequirement).toBeVisible();
    await expect(page.getByTestId("button-create-password")).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    await page.getByTestId("input-create-password").fill("short1");
    await expect(lengthRequirement).toHaveCSS("color", "rgb(254, 202, 202)");
    await expect(numberRequirement).toHaveCSS("color", "rgb(220, 252, 231)");

    await page.getByTestId("input-create-password").fill(NEW_PASSWORD);
    await expect(lengthRequirement).toHaveCSS("color", "rgb(220, 252, 231)");
    await expect(numberRequirement).toHaveCSS("color", "rgb(220, 252, 231)");
    await page.getByTestId("input-create-confirm-password").fill(NEW_PASSWORD);
    await expect(page.getByTestId("button-create-password")).toBeEnabled();

    let submittedBody: Record<string, unknown> | undefined;
    await page.route("**/api/auth/set-password", async (route) => {
      submittedBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          token: "browser-test-token",
          user: {
            id: "activation-flow-user",
            email: INVITED_EMAIL,
            name: "Invited Account",
            role: "attendee",
            eventId: eventTheme.id,
          },
        }),
      });
    });

    await page.getByTestId("button-create-password").click();
    await expect
      .poll(() => submittedBody)
      .toMatchObject({
        email: INVITED_EMAIL,
        code: ACTIVATION_CODE,
        newPassword: NEW_PASSWORD,
      });
  });
});
