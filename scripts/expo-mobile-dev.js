const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");

const expoUrlFile = path.resolve(process.cwd(), ".expo-dev-url");
const mobilePort = process.env.EXPO_MOBILE_PORT || "8083";
const connectionMode = process.env.EXPO_MOBILE_CONNECTION || "tunnel";
const connectionFlag =
  connectionMode === "lan"
    ? "--lan"
    : connectionMode === "tunnel"
      ? "--tunnel"
      : null;

function isLocalApiUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const parsed = new URL(value.includes("://") ? value : `http://${value}`);
    return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function resolveMobileApiUrl() {
  const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL;
  if (configuredApiUrl && !isLocalApiUrl(configuredApiUrl)) {
    return configuredApiUrl;
  }

  const publicDomain =
    process.env.EXPO_PUBLIC_DOMAIN || process.env.REPLIT_DEV_DOMAIN;
  if (!publicDomain) return configuredApiUrl;
  return /^https?:\/\//i.test(publicDomain)
    ? publicDomain.replace(/\/$/, "")
    : `https://${publicDomain}`;
}

const mobileApiUrl = resolveMobileApiUrl();
if (mobileApiUrl) {
  process.env.EXPO_PUBLIC_API_URL = mobileApiUrl;
  console.log(`[expo-mobile] Mobile API host: ${new URL(mobileApiUrl).host}`);
}

if (!connectionFlag) {
  console.error(
    `[expo-mobile] Unsupported EXPO_MOBILE_CONNECTION "${connectionMode}". Use "tunnel" or "lan".`,
  );
  process.exit(1);
}

function getPublicExpoUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/[),.;]+$/, "");
  try {
    const url = new URL(trimmed);
    if (
      url.protocol !== "exp:" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "localhost" ||
      url.hostname === "::1"
    ) {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
}

function publishExpoUrl(value) {
  const expoUrl = getPublicExpoUrl(value);
  if (!expoUrl) return;
  fs.writeFileSync(expoUrlFile, expoUrl, "utf8");
  console.log(`[expo-mobile] Landing page QR updated: ${expoUrl}`);
}

// Workflow restarts can leave a detached Expo/Metro process behind. If that
// process keeps the configured port, Expo may silently start elsewhere while
// the landing page continues advertising the old bundle. Only target this
// project's configured Expo connection and port.
function stopStaleTunnelProcess() {
  const processPattern = `[e]xpo start .*${connectionFlag} --port ${mobilePort}`;
  try {
    execFileSync("pkill", ["-TERM", "-f", processPattern], {
      stdio: "ignore",
      timeout: 2000,
    });
  } catch {
    // No stale process is the normal case. If pkill is unavailable, Expo's
    // normal port handling still provides the fallback behavior.
  }
}

stopStaleTunnelProcess();
try {
  fs.unlinkSync(expoUrlFile);
} catch {
  // No previous URL is the normal case.
}

// Do not publish a tunnel QR until the dependency that bootstraps the app is
// definitely present. Metro cannot render a useful in-app fallback when this
// import is missing, so exposing a QR in that state only produces a red screen
// for every Expo Go user.
try {
  require("./expo-preflight");
} catch {
  console.error(
    "[expo-mobile] Expo dependencies are unavailable. Run npm install before starting the mobile preview.",
  );
  process.exit(1);
}

// Run Expo through a pseudo-terminal so it keeps printing the QR/link while
// still allowing this wrapper to capture the live exp:// URL. Expo's tunnel
// client can exit on transient ngrok API errors, so keep this wrapper alive
// and reconnect with backoff instead of making the preview supervisor restart
// the entire mobile service every second.
let child = null;
let retryTimer = null;
let retryDelayMs = 5000;
let shuttingDown = false;

function startExpo() {
  if (shuttingDown) return;

  // Always clear Metro's module graph. A tunnel restart can otherwise reuse a
  // graph created while dependencies were being installed and keep serving a
  // stale "Unable to resolve module expo" bundle even after Expo is present.
  const expoCommand = `npx expo start --clear ${connectionFlag} --port ${mobilePort}`;

  console.log(
    `[expo-mobile] Starting Expo Go ${connectionMode} preview on port ${mobilePort}`,
  );

  child = spawn("script", ["-qec", expoCommand, "/dev/null"], {
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
    detached: true,
  });

  child.stdout.on("data", (chunk) => forwardOutput(process.stdout, chunk));
  child.stderr.on("data", (chunk) => forwardOutput(process.stderr, chunk));

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;

    try {
      fs.unlinkSync(expoUrlFile);
    } catch {}

    const delay = retryDelayMs;
    retryDelayMs = Math.min(retryDelayMs * 2, 30000);
    console.error(
      `[expo-mobile] Expo ${connectionMode} preview exited (${signal || code}); retrying in ${delay / 1000}s`,
    );
    if (connectionMode === "tunnel") {
      console.error(
        "[expo-mobile] If the tunnel remains unavailable, use the EAS internal preview build documented in RELEASE_HANDOFF.md.",
      );
    }
    retryTimer = setTimeout(() => {
      retryTimer = null;
      stopStaleTunnelProcess();
      startExpo();
    }, delay);
  });
}

async function updateUrlFromManifest() {
  try {
    const response = await fetch(`http://127.0.0.1:${mobilePort}/`);
    if (!response.ok) return;
    const manifest = await response.json();
    const launchAssetUrl = manifest?.launchAsset?.url;
    if (typeof launchAssetUrl !== "string") return;

    const launchAsset = new URL(launchAssetUrl);
    publishExpoUrl(`exp://${launchAsset.host}`);
  } catch {
    // Metro may not be ready yet; the next poll will retry.
  }
}

const manifestPoll = setInterval(updateUrlFromManifest, 1000);
updateUrlFromManifest();

function forwardOutput(stream, chunk) {
  const text = chunk.toString();
  stream.write(text);

  const normalized = text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  const match = normalized.match(/exp:\/\/[^\s]+/);
  if (match) publishExpoUrl(match[0]);
}

startExpo();

function shutdown(signal) {
  shuttingDown = true;
  if (retryTimer) clearTimeout(retryTimer);
  clearInterval(manifestPoll);
  try {
    fs.unlinkSync(expoUrlFile);
  } catch {}
  try {
    if (child?.pid) process.kill(-child.pid, signal);
  } catch {
    child?.kill(signal);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
