export const WEB_PREVIEW_URL =
  process.env.PLAYWRIGHT_WEB_PREVIEW_URL ??
  process.env.PLAYWRIGHT_WEB_BASE_URL ??
  "http://localhost:8082";
