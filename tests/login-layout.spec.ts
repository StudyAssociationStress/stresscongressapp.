import { expect, test } from "@playwright/test";

const viewports = [
  { name: "compact phone", width: 320, height: 568 },
  { name: "phone", width: 390, height: 844 },
  { name: "phone landscape", width: 844, height: 390 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
];

test("login form stays readable and within responsive viewport bounds", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  for (const viewport of viewports) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await page.goto("/");

    const form = page.getByTestId("login-form");
    await expect(
      form,
      `${viewport.name}: login form should be visible`,
    ).toBeVisible();
    await expect(
      page.getByPlaceholder("Email address"),
      `${viewport.name}: email field should be visible`,
    ).toBeVisible();
    const continueButton = page.getByTestId("button-continue");
    await expect(
      continueButton,
      `${viewport.name}: continue action should be visible`,
    ).toBeVisible();

    const [bounds, buttonBounds] = await Promise.all([
      form.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          width: rect.width,
          viewportWidth: document.documentElement.clientWidth,
          documentWidth: document.documentElement.scrollWidth,
        };
      }),
      continueButton.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { height: rect.height };
      }),
    ]);

    expect(
      buttonBounds.height,
      `${viewport.name}: continue action should be large enough for touch`,
    ).toBeGreaterThanOrEqual(44);
    expect(
      bounds.width,
      `${viewport.name}: form should not exceed its comfortable maximum width`,
    ).toBeLessThanOrEqual(560);
    expect(
      bounds.left,
      `${viewport.name}: form should not extend beyond the left edge`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      bounds.right,
      `${viewport.name}: form should not extend beyond the right edge`,
    ).toBeLessThanOrEqual(bounds.viewportWidth);
    expect(
      bounds.documentWidth,
      `${viewport.name}: page should not overflow horizontally`,
    ).toBeLessThanOrEqual(bounds.viewportWidth);
  }

  expect(pageErrors).toEqual([]);
});
