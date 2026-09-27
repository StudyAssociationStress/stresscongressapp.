import express from "express";
import type { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { registerRoutes } from "./routes";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { createProxyMiddleware } from "http-proxy-middleware";

const app = express();
const log = console.log;

app.set("trust proxy", process.env.NODE_ENV === "production" ? 1 : false);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// ─── CORS ─────────────────────────────────────────────────────────────────────
function getAllowedOrigins(): string[] {
  const origins = [
    "http://localhost:8081",
    "http://localhost:5000",
    "http://localhost:3000",
    "http://localhost:19006",
  ];

  const expoDomain = process.env.EXPO_PUBLIC_DOMAIN;
  if (expoDomain) {
    const clean = expoDomain.replace(/^https?:\/\//, "");
    origins.push(`https://${clean}`);
    origins.push(`http://${clean}`);
  }

  const extra = process.env.ALLOWED_ORIGINS;
  if (extra) {
    extra.split(",").forEach((o: string) => origins.push(o.trim()));
  }

  return origins;
}

function isAllowedOrigin(origin: string): boolean {
  return getAllowedOrigins().includes(origin);
}

function setupCors(app: express.Application) {
  app.use((req, res, next) => {
    const origin = req.header("origin");

    if (origin && isAllowedOrigin(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS",
      );
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.header("Access-Control-Allow-Credentials", "true");
    }

    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }

    next();
  });
}

function setupSecurity(app: express.Application) {
  // Helmet security headers — disable CSP for Expo web compatibility
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
}

function setupBodyParsing(app: express.Application) {
  app.use(
    express.json({
      limit: "10mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.use(express.urlencoded({ extended: false }));
}

function setupRequestLogging(app: express.Application) {
  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    const requestId = req.header("x-request-id") || randomUUID();
    res.setHeader("x-request-id", requestId);

    res.on("finish", () => {
      if (!path.startsWith("/api")) return;

      log(
        JSON.stringify({
          event: "http_request",
          requestId,
          method: req.method,
          path,
          status: res.statusCode,
          durationMs: Date.now() - start,
        }),
      );
    });

    next();
  });
}

function getAppName(): string {
  try {
    const appJsonPath = path.resolve(process.cwd(), "app.json");
    const appJsonContent = fs.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}

function serveExpoManifest(platform: string, req: Request, res: Response) {
  if (platform !== "ios" && platform !== "android") {
    return res.status(404).json({ error: "Unsupported Expo platform" });
  }
  const manifestPath =
    platform === "ios"
      ? path.resolve(process.cwd(), "static-build", "ios", "manifest.json")
      : path.resolve(process.cwd(), "static-build", "android", "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    return res
      .status(404)
      .json({ error: `Manifest not found for platform: ${platform}` });
  }

  const forwardedProto =
    req.header("x-forwarded-proto") || req.protocol || "https";
  const forwardedHost = req.header("x-forwarded-host");
  // A development proxy can include Metro's internal port in x-forwarded-host.
  // That port is not reachable from Expo Go on a physical iPad/iPhone.
  const requestHost = (forwardedHost || req.get("host") || "")
    .split(",")[0]
    .trim();
  const publicHost = forwardedHost
    ? requestHost.replace(/:\d+$/, "")
    : requestHost;
  const requestBaseUrl = `${forwardedProto}://${publicHost}`;

  let manifest: Record<string, any>;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch {
    return res.status(500).json({ error: "Expo manifest is unavailable" });
  }

  // Static builds may have been generated on another host. Expo Go must be
  // given URLs reachable from the device that requested this manifest.
  const rewriteUrl = (value: unknown) =>
    typeof value === "string"
      ? value.replace(/^https?:\/\/[^/]+/, requestBaseUrl)
      : value;
  manifest.launchAsset.url = rewriteUrl(manifest.launchAsset.url);
  if (Array.isArray(manifest.assets)) {
    manifest.assets = manifest.assets.map((asset: Record<string, any>) => ({
      ...asset,
      url: rewriteUrl(asset.url),
    }));
  }
  const expoClient = manifest.extra?.expoClient;
  if (expoClient) {
    expoClient.iconUrl = rewriteUrl(expoClient.iconUrl);
    expoClient.hostUri = publicHost;
    if (expoClient.expoGo) {
      expoClient.expoGo.debuggerHost = expoClient.hostUri;
    }
    if (expoClient.extra) {
      expoClient.extra.apiUrl = requestBaseUrl;
    }
  }

  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");
  res.send(JSON.stringify(manifest));
}

function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName,
}: {
  req: Request;
  res: Response;
  landingPageTemplate: string;
  appName: string;
}) {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost || req.get("host") || "localhost:5000";
  const baseUrl = `${protocol}://${host}`;
  const expoUrl = getExpoDevUrl();

  log(`baseUrl`, baseUrl);
  log(`expoUrl`, expoUrl);

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPO_URL_PLACEHOLDER/g, expoUrl || "#")
    .replace(/APP_NAME_PLACEHOLDER/g, appName);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.status(200).send(html);
}

function getExpoDevUrl(): string | null {
  const expoUrlPath = path.resolve(process.cwd(), ".expo-dev-url");
  try {
    const configuredExpoUrl = fs.readFileSync(expoUrlPath, "utf8").trim();
    if (
      configuredExpoUrl.startsWith("exp://") &&
      !configuredExpoUrl.includes("127.0.0.1") &&
      !configuredExpoUrl.includes("localhost")
    ) {
      return configuredExpoUrl;
    }
  } catch {
    // The mobile preview may still be starting.
  }
  return null;
}

function configureExpoAndLanding(app: express.Application) {
  const templatePath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html",
  );
  const landingPageTemplate = fs.readFileSync(templatePath, "utf-8");
  const appName = getAppName();

  log("Serving static Expo files with dynamic manifest routing");

  app.get("/expo-qr.png", async (req: Request, res: Response) => {
    try {
      const expoUrl = getExpoDevUrl();
      if (!expoUrl) {
        res
          .status(503)
          .setHeader("Cache-Control", "no-store, no-cache, must-revalidate")
          .setHeader("Retry-After", "2")
          .json({ message: "Expo Go tunnel is still starting" });
        return;
      }
      const png = await QRCode.toBuffer(expoUrl, {
        errorCorrectionLevel: "M",
        margin: 4,
        width: 512,
        color: { dark: "#000000", light: "#ffffff" },
      });
      res.type("png").setHeader("Cache-Control", "no-store").send(png);
    } catch (error) {
      console.error("Expo QR generation failed:", error);
      res.status(500).json({ message: "Unable to generate Expo Go QR code" });
    }
  });

  app.get("/expo-status", (_req: Request, res: Response) => {
    const expoUrl = getExpoDevUrl();
    res
      .setHeader("Cache-Control", "no-store, no-cache, must-revalidate")
      .json({ ready: Boolean(expoUrl), url: expoUrl });
  });

  app.get("/open-expo", (req: Request, res: Response) => {
    const expoUrl = getExpoDevUrl();
    if (!expoUrl) {
      res.redirect("/mobile");
      return;
    }
    const safeExpoUrl = JSON.stringify(expoUrl);

    res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Opening Expo Go</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; text-align: center; padding: 48px 24px; color: #0c0057; }
    a { display: inline-block; margin-top: 24px; padding: 14px 22px; border-radius: 10px; background: #f78f1e; color: white; text-decoration: none; font-weight: 700; }
  </style>
</head>
<body>
  <h1>Opening Expo Go…</h1>
  <p>If Expo Go does not open automatically, tap the button below.</p>
  <a href=${safeExpoUrl}>Open in Expo Go</a>
  <script>window.location.replace(${safeExpoUrl});</script>
</body>
</html>`);
  });

  app.get("/data-deletion", (_req: Request, res: Response) => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Data Deletion Request - Stress Congress</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #333; }
    .container { max-width: 600px; margin: 40px auto; padding: 20px; }
    .card { background: #fff; border-radius: 12px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { color: #0c0057; font-size: 24px; margin-bottom: 8px; }
    .subtitle { color: #666; margin-bottom: 24px; }
    p { line-height: 1.6; margin-bottom: 16px; }
    .info-box { background: #f0f0ff; border-left: 4px solid #0c0057; padding: 16px; border-radius: 0 8px 8px 0; margin: 20px 0; }
    form { margin-top: 24px; }
    label { display: block; font-weight: 600; margin-bottom: 6px; color: #0c0057; }
    input[type="email"], textarea { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 16px; margin-bottom: 16px; font-family: inherit; }
    textarea { height: 100px; resize: vertical; }
    button { background: #f78f1e; color: #fff; border: none; padding: 14px 28px; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; width: 100%; }
    .success { display: none; background: #e8f5e9; border: 1px solid #4caf50; padding: 16px; border-radius: 8px; color: #2e7d32; text-align: center; margin-top: 16px; }
    .footer { text-align: center; margin-top: 24px; color: #999; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h1>Data Deletion Request</h1>
      <p class="subtitle">Stress Congress</p>
      <p>You can request deletion of your account and all associated data from the Stress Congress app.</p>
      <div class="info-box">
        <strong>Data that will be deleted:</strong>
        <ul style="margin-top:8px;padding-left:20px;">
          <li>Your name and email address</li>
          <li>Your login credentials</li>
          <li>Check-in records</li>
          <li>Case study assignments</li>
          <li>Saved sessions and preferences</li>
          <li>Company memberships</li>
          <li>Notification history</li>
        </ul>
      </div>
      <form id="deletionForm" onsubmit="submitForm(event)">
        <label for="email">Email address used in the app</label>
        <input type="email" id="email" name="email" required placeholder="your@email.com">
        <label for="reason">Reason for deletion (optional)</label>
        <textarea id="reason" name="reason" placeholder="Please let us know why you want your data deleted..."></textarea>
        <button type="submit">Submit Deletion Request</button>
      </form>
      <div class="success" id="successMsg">
        Your deletion request has been submitted. We will process it within 30 days and send a confirmation to your email.
      </div>
      <div id="errorMsg" role="alert" style="display:none;background:#ffebee;border:1px solid #ef5350;padding:16px;border-radius:8px;color:#b71c1c;text-align:center;margin-top:16px;"></div>
    </div>
    <div class="footer">&copy; Stress Congress - University of Twente</div>
  </div>
  <script>
    async function submitForm(e) {
      e.preventDefault();
      const form = document.getElementById('deletionForm');
      const button = form.querySelector('button');
      const error = document.getElementById('errorMsg');
      error.style.display = 'none';
      if (!form.reportValidity()) return;
      button.disabled = true;
      button.textContent = 'Submitting...';
      try {
        const response = await fetch('/api/data-deletion', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: document.getElementById('email').value,
            reason: document.getElementById('reason').value
          })
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.message || 'Unable to submit request. Please try again.');
        form.style.display = 'none';
        document.getElementById('successMsg').style.display = 'block';
      } catch (err) {
        error.textContent = err.message || 'Unable to submit request. Please try again.';
        error.style.display = 'block';
        button.disabled = false;
        button.textContent = 'Submit Deletion Request';
      }
    }
  </script>
</body>
</html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(html);
  });

  app.get("/privacy-policy", (_req: Request, res: Response) => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy - Stress Congress</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #333; }
    .container { max-width: 700px; margin: 40px auto; padding: 20px; }
    .card { background: #fff; border-radius: 12px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { color: #0c0057; font-size: 24px; margin-bottom: 4px; }
    h2 { color: #0c0057; font-size: 18px; margin: 24px 0 8px; }
    .subtitle { color: #666; margin-bottom: 24px; }
    p, li { line-height: 1.7; margin-bottom: 8px; }
    ul { padding-left: 20px; margin-bottom: 16px; }
    .footer { text-align: center; margin-top: 24px; color: #999; font-size: 14px; }
    a { color: #f78f1e; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h1>Privacy Policy</h1>
      <p class="subtitle">Stress Congress &mdash; Last updated: 2026</p>
      <h2>1. Introduction</h2>
      <p>Stress Congress is a conference event application developed for the Stress Congress at the University of Twente. This Privacy Policy explains how we collect, use, and protect your personal data.</p>
      <h2>2. Data We Collect</h2>
      <ul>
        <li><strong>Name</strong> &mdash; to identify you at the event</li>
        <li><strong>Email address</strong> &mdash; for authentication and communication</li>
        <li><strong>Password</strong> &mdash; stored securely using bcrypt hashing</li>
        <li><strong>Check-in status</strong> &mdash; to track event attendance</li>
        <li><strong>Session preferences</strong> &mdash; saved sessions and case study assignments</li>
      </ul>
      <h2>3. How We Use Your Data</h2>
      <ul>
        <li>Authenticating your access to the app</li>
        <li>Managing event check-in via QR codes</li>
        <li>Displaying your personalized agenda</li>
        <li>Sending event-related notifications</li>
      </ul>
      <h2>4. Data Sharing</h2>
      <p>We do not sell, trade, or share your personal data with third parties. Your data is only accessible to authorized event staff.</p>
      <h2>5. Data Security</h2>
      <ul>
        <li>All data is transmitted using HTTPS</li>
        <li>Passwords are hashed using bcrypt</li>
        <li>Database access is restricted to authorized personnel</li>
      </ul>
      <h2>6. Your Rights</h2>
      <p>You have the right to access, correct, or delete your data. Visit our <a href="/data-deletion">Data Deletion Request</a> page or contact us below.</p>
      <h2>7. Contact</h2>
      <p><strong>Stress Congress Secretary</strong><br>Email: secretary@stress.utwente.nl</p>
      <p><strong>Technical Support</strong><br>Email: own.professionals@gmail.com</p>
    </div>
    <div class="footer">&copy; Stress Congress - University of Twente</div>
  </div>
</body>
</html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(html);
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api")) {
      return next();
    }

    if (
      req.path !== "/" &&
      req.path !== "/manifest" &&
      req.path !== "/mobile"
    ) {
      return next();
    }

    const platform = req.header("expo-platform");
    if (
      req.path === "/manifest" &&
      platform &&
      (platform === "ios" || platform === "android")
    ) {
      return serveExpoManifest(platform, req, res);
    }

    if (
      req.path === "/" &&
      platform &&
      (platform === "ios" || platform === "android")
    ) {
      return serveExpoManifest(platform, req, res);
    }

    if (req.path === "/mobile") {
      return serveLandingPage({
        req,
        res,
        landingPageTemplate,
        appName,
      });
    }

    if (req.path === "/") {
      return next();
    }

    next();
  });

  app.use("/assets", express.static(path.resolve(process.cwd(), "assets")));
  app.use(express.static(path.resolve(process.cwd(), "static-build")));

  // During local development, forward browser requests to Expo's web server so
  // the browser preview shows the actual app instead of the mobile QR landing page.
  // Native Expo requests and the mobile landing page are handled above.
  if (process.env.NODE_ENV !== "production") {
    app.use(
      createProxyMiddleware({
        target: "http://127.0.0.1:8082",
        changeOrigin: true,
        ws: true,
        pathFilter: (pathname) => !pathname.startsWith("/api"),
        on: {
          error: (error, _req, res) => {
            if ("headersSent" in res && !res.headersSent) {
              (res as Response).status(502).send(
                `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="refresh" content="2" />
    <title>Starting preview</title>
    <style>
      body { font-family: system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; color: #243047; }
      main { text-align: center; padding: 2rem; }
      p { color: #667085; }
    </style>
  </head>
  <body>
    <main>
      <h1>The web preview is starting</h1>
      <p>Connecting automatically. This page will refresh when the app is ready.</p>
    </main>
  </body>
</html>`,
              );
            }
            log(`Web preview proxy error: ${error.message}`);
          },
        },
      }),
    );
  }

  log("Expo routing: Checking expo-platform header on / and /manifest");
}

function setupErrorHandler(app: express.Application) {
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    const error = err as {
      status?: number;
      statusCode?: number;
      message?: string;
      name?: string;
    };

    const status = error.status || error.statusCode || 500;
    const message =
      status >= 500
        ? "Temporary service failure. Please try again."
        : error.message || "Internal Server Error";

    console.error(
      JSON.stringify({
        event: "request_error",
        requestId: res.getHeader("x-request-id"),
        method: req.method,
        path: req.path,
        status,
        error: error.name || "Error",
        message: error.message || "unknown",
      }),
    );

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });
}

(async () => {
  // ── #13: DATABASE_URL preflight ──────────────────────────────────────────────
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error(
      "[FATAL] DATABASE_URL is not set. Add it to your environment variables and restart.",
    );
    process.exit(1);
  }
  if (!dbUrl.startsWith("postgres://") && !dbUrl.startsWith("postgresql://")) {
    console.error(
      `[FATAL] DATABASE_URL looks wrong — expected a postgres:// or postgresql:// connection string, got: "${dbUrl.slice(0, 40)}…"`,
    );
    process.exit(1);
  }

  setupSecurity(app);
  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);

  // Health check endpoint used by Railway.
  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Run additive migrations on every startup (idempotent — all files use IF NOT EXISTS)
  const { storage } = await import("./storage");
  await storage.runStartupMigrations();
  // Recover any GDPR claims abandoned by a prior process crash (resets in_progress -> pending)
  await storage.reconcileAbandonedGdprClaims();

  app.get("/health/ready", async (_req, res) => {
    const databaseReady = await storage.checkDatabaseReady();
    if (!databaseReady || !storage.areMigrationsReady()) {
      return res.status(503).json({
        status: "not_ready",
        database: databaseReady ? "ok" : "unavailable",
        migrations: storage.areMigrationsReady() ? "ok" : "pending",
      });
    }
    return res.status(200).json({
      status: "ready",
      database: "ok",
      migrations: "ok",
    });
  });

  // Register the web/Expo fallback after readiness routes so the proxy cannot
  // swallow health checks intended for Railway.
  configureExpoAndLanding(app);

  const server = await registerRoutes(app);

  setupErrorHandler(app);

  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`express server serving on port ${port}`);
    },
  );
})();
