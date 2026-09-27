const { spawn } = require("node:child_process");

const services = new Map();
let shuttingDown = false;
let backendStarted = false;

function startService(name, command, onReady) {
  if (shuttingDown) return;

  const child = spawn(command, {
    shell: true,
    detached: true,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  services.set(name, child);
  child.stdout.on("data", (chunk) =>
    process.stdout.write(`[${name}] ${chunk}`),
  );
  child.stderr.on("data", (chunk) =>
    process.stderr.write(`[${name}] ${chunk}`),
  );

  child.once("spawn", () => {
    if (onReady) onReady();
  });

  child.once("exit", (code, signal) => {
    if (services.get(name) === child) services.delete(name);
    if (shuttingDown) return;

    console.error(
      `[preview] ${name} exited (${signal || code}); restarting in 1s`,
    );
    setTimeout(() => startService(name, command), 1000);
  });

  return child;
}

function stopService(child) {
  if (!child || child.killed) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

async function waitForWebPreview() {
  const deadline = Date.now() + 120000;
  while (!shuttingDown && Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:8082/status");
      if (response.ok) return;
    } catch {
      // Expo is still booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    "Expo web did not become ready on port 8082 within 120 seconds",
  );
}

async function start() {
  startService("expo-web", "npm run expo:dev");
  startService("expo-mobile", "npm run expo:dev:mobile");

  await waitForWebPreview();
  if (shuttingDown || backendStarted) return;

  backendStarted = true;
  startService("backend", "npm run server:dev");
  console.log(
    "[preview] Web preview ready on internal 8082; public preview is port 5000",
  );
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[preview] ${signal}; stopping all services`);
  for (const child of services.values()) stopService(child);
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

start().catch((error) => {
  console.error(`[preview] ${error.message}`);
  shutdown("startup failure");
});
