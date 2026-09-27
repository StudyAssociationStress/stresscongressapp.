const fs = require("fs");
const path = require("path");

const STATIC_BUILD_ROOT = path.resolve(process.cwd(), "static-build");
const PLATFORMS = ["ios", "android"];

function fail(message) {
  throw new Error(`[static-build] ${message}`);
}

function assertFile(filePath, description) {
  if (!fs.existsSync(filePath)) {
    fail(
      `${description} is missing: ${path.relative(process.cwd(), filePath)}`,
    );
  }
  if (!fs.statSync(filePath).isFile()) {
    fail(
      `${description} is not a file: ${path.relative(process.cwd(), filePath)}`,
    );
  }
}

function resolveLocalAsset(url, description) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail(`${description} is not a valid URL: ${url}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    fail(`${description} must use HTTP(S): ${url}`);
  }
  if (
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "0.0.0.0"
  ) {
    fail(`${description} still points to a local host: ${url}`);
  }

  let pathname;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    fail(`${description} contains an invalid encoded path: ${url}`);
  }

  const filePath = path.resolve(STATIC_BUILD_ROOT, `.${pathname}`);
  const rootPrefix = `${STATIC_BUILD_ROOT}${path.sep}`;
  if (filePath !== STATIC_BUILD_ROOT && !filePath.startsWith(rootPrefix)) {
    fail(`${description} points outside static-build: ${url}`);
  }

  assertFile(filePath, description);
}

function verifyPlatform(platform) {
  const manifestPath = path.join(STATIC_BUILD_ROOT, platform, "manifest.json");
  assertFile(manifestPath, `${platform} manifest`);

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail(`${platform} manifest is not valid JSON: ${error.message}`);
  }

  if (!manifest.launchAsset || typeof manifest.launchAsset.url !== "string") {
    fail(`${platform} manifest has no launch asset URL`);
  }
  resolveLocalAsset(manifest.launchAsset.url, `${platform} launch asset`);

  if (!manifest.extra || typeof manifest.extra !== "object") {
    fail(`${platform} manifest has no Expo metadata`);
  }

  if (!Array.isArray(manifest.assets)) {
    fail(`${platform} manifest has no assets list`);
  }
  manifest.assets.forEach((asset, index) => {
    if (!asset || typeof asset.url !== "string") {
      fail(`${platform} asset ${index} has no URL`);
    }
    resolveLocalAsset(asset.url, `${platform} asset ${index}`);
  });
}

try {
  if (!fs.existsSync(STATIC_BUILD_ROOT)) {
    fail("static-build directory is missing");
  }
  PLATFORMS.forEach(verifyPlatform);
  console.log(
    `[static-build] Verified ${PLATFORMS.join(" and ")} manifests and local assets.`,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
