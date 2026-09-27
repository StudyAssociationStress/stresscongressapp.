import { test, expect, APIRequestContext } from "@playwright/test";
import { TEST_ATTENDEE_EMAIL, TEST_PASSWORD } from "./global-setup";
import { WEB_PREVIEW_URL } from "./web-preview";

async function login(
  request: APIRequestContext,
  deviceId: string,
  userAgent?: string,
): Promise<string> {
  const response = await request.post("/api/auth/login", {
    headers: userAgent ? { "User-Agent": userAgent } : undefined,
    data: {
      email: TEST_ATTENDEE_EMAIL,
      password: TEST_PASSWORD,
      deviceId,
    },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).token as string;
}

test.describe("device revocation", () => {
  test("web revoke action confirms and sends the delete request", async ({
    page,
    request,
  }) => {
    const primaryToken = await login(request, `revoke-primary-${Date.now()}`);
    await login(
      request,
      `revoke-secondary-${Date.now()}`,
      "Android Revoke Test",
    );

    await page.addInitScript((token) => {
      window.localStorage.setItem("auth_token", token);
      window.confirm = () => true;
    }, primaryToken);

    await page.goto(WEB_PREVIEW_URL);
    await page.getByTestId("button-open-drawer").click({ force: true });
    await page.getByText("Settings", { exact: true }).click();
    await expect(
      page.getByText("Signed-in devices", { exact: true }),
    ).toBeVisible();

    const revokeResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/auth/devices/") &&
        response.request().method() === "DELETE",
    );
    await page.getByRole("button", { name: "Revoke Android device" }).click();

    expect((await revokeResponse).status()).toBe(200);
  });
});
