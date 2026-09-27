import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { rateLimit } from "express-rate-limit";
import nodemailer from "nodemailer";
import { z } from "zod";
import { randomInt, randomUUID } from "node:crypto";
import {
  CASE_STUDY_FULL_ERROR,
  CASE_STUDY_FULL_MESSAGE,
  storage,
  type EventEmailOutboxItem,
} from "./storage";
import {
  EVENT_START_DATE_ERROR_MESSAGE,
  parseEventDate,
} from "../shared/event-date";
import type * as schema from "../shared/schema";

const gmailTransporter =
  process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD
    ? nodemailer.createTransport({
        service: "gmail",
        pool: true,
        maxConnections: 1,
        maxMessages: 100,
        rateDelta: 1000,
        rateLimit: 1,
        connectionTimeout: 30_000,
        greetingTimeout: 30_000,
        socketTimeout: 60_000,
        auth: {
          user: process.env.GMAIL_USER,
          pass: process.env.GMAIL_APP_PASSWORD,
        },
      })
    : null;

const PROTECTED_ADMIN_EMAIL = "stresscongressapp@gmail.com";
const PASSWORD_REUSE_MESSAGE =
  "You cannot reuse a previous password. Please choose a different password.";

function normalizeAuthEmail(email: unknown): string {
  return String(email ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.+$/, "");
}

const HTML_ESCAPE_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => HTML_ESCAPE_ENTITIES[character],
  );
}

export const EMAIL_HTML = (
  name: string,
  code: string,
  activation = false,
  eventName = "Stress Congress",
  toEmail = "",
) => {
  const escapedName = escapeHtml(name);
  const escapedCode = escapeHtml(code);
  const escapedEventName = escapeHtml(eventName);
  const escapedToEmail = escapeHtml(toEmail);

  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;">
      <h2 style="color:#0c0057;margin-bottom:8px;">${activation ? "Activate your account" : "Password Reset"}</h2>
      <p style="color:#444;margin-bottom:24px;">Hi ${escapedName},</p>
      <p style="color:#444;">${
        activation
          ? `Your Stress Congress account has been created for ${escapedEventName}. To sign in, open the app, enter this email address, then use the code below to create your password:`
          : "Your verification code is:"
      }</p>
      ${
        activation && toEmail
          ? `<p style="color:#444;"><strong>Email:</strong> ${escapedToEmail}</p>`
          : ""
      }
      <div style="background:#f4f3ff;border-radius:12px;padding:24px;text-align:center;margin:20px 0;">
        <span style="font-size:40px;font-weight:700;letter-spacing:10px;color:#0c0057;">${escapedCode}</span>
      </div>
      <p style="color:#888;font-size:13px;">This code expires in <strong>10 minutes</strong>. ${activation ? "If you did not expect this invitation, contact the event administrator." : "If you did not request a password reset, please ignore this email."}</p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
      <p style="color:#aaa;font-size:12px;">Stress Congress App</p>
    </div>
  `;
};
function formatEventDate(
  value: Date | string | null | undefined,
  eventYear?: number | null,
): string | null {
  const date = parseEventDate(value, eventYear);
  return date
    ? date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;
}

export const EVENT_LIVE_HTML = (
  name: string,
  eventName: string,
  startDate: Date | string | null,
  eventYear?: number | null,
) => {
  const escapedName = escapeHtml(name);
  const escapedEventName = escapeHtml(eventName);
  const formattedEventDate = formatEventDate(startDate, eventYear);

  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;">
      <h2 style="color:#0c0057;margin-bottom:8px;">${escapedEventName} is now live</h2>
      <p style="color:#444;margin-bottom:24px;">Hi ${escapedName},</p>
      <p style="color:#444;">${escapedEventName} is now live in the Stress Congress app. Open the app and enter your registered email address to sign in.</p>
      ${
        formattedEventDate
          ? `<p style="color:#444;"><strong>Event date:</strong> ${formattedEventDate}</p>`
          : ""
      }
      <p style="color:#888;font-size:13px;">If you have not set up your account yet, the app will guide you through requesting an activation code after you start signing in.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
      <p style="color:#aaa;font-size:12px;">Stress Congress App</p>
    </div>
  `;
};

export const EVENT_ATTENDEE_ADDED_HTML = (
  name: string,
  eventName: string,
  startDate: Date | string | null,
  eventYear?: number | null,
) => {
  const escapedName = escapeHtml(name);
  const escapedEventName = escapeHtml(eventName);
  const formattedEventDate = formatEventDate(startDate, eventYear);

  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;">
      <h2 style="color:#0c0057;margin-bottom:8px;">You have been added to ${escapedEventName}</h2>
      <p style="color:#444;margin-bottom:24px;">Hi ${escapedName},</p>
      <p style="color:#444;">You have been added to ${escapedEventName} in the Stress Congress app. Open the app and enter your registered email address to sign in.</p>
      ${
        formattedEventDate
          ? `<p style="color:#444;"><strong>Event date:</strong> ${formattedEventDate}</p>`
          : ""
      }
      <p style="color:#888;font-size:13px;">If you have not set up your account yet, the app will guide you through account setup after you start signing in.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
      <p style="color:#aaa;font-size:12px;">Stress Congress App</p>
    </div>
  `;
};

type PrioritizedMailRequest = {
  priority: number;
  send: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};
const mailRequests: PrioritizedMailRequest[] = [];
let mailRequestActive = false;
function sendMailWithPriority(
  mailer: { sendMail: (message: any) => Promise<unknown> },
  message: { from: string; to: string; subject: string; html: string },
  priority: "urgent" | "bulk",
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    mailRequests.push({
      priority: priority === "urgent" ? 0 : 1,
      send: () => mailer.sendMail(message),
      resolve,
      reject,
    });
    mailRequests.sort((a, b) => a.priority - b.priority);
    const drain = () => {
      if (mailRequestActive) return;
      const next = mailRequests.shift();
      if (!next) return;
      mailRequestActive = true;
      void Promise.resolve()
        .then(next.send)
        .then(next.resolve, next.reject)
        .finally(() => {
          mailRequestActive = false;
          drain();
        });
    };
    drain();
  });
}

function isRealGmailMailer(mailer: unknown): boolean {
  return Boolean(gmailTransporter) && mailer === gmailTransporter;
}

function isSmtp454(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const smtpError = error as {
    code?: string;
    responseCode?: number;
    response?: string;
  };
  return (
    smtpError.responseCode === 454 ||
    smtpError.code === "454" ||
    /\b454\b|too many login attempts/i.test(
      `${message} ${smtpError.response ?? ""}`,
    )
  );
}

async function sendResetEmail(
  toEmail: string,
  name: string,
  code: string,
  activation = false,
  eventName = "Stress Congress",
  mailer: ActivationMailer | null = gmailTransporter as unknown as ActivationMailer | null,
): Promise<void> {
  const realTransport = isRealGmailMailer(mailer);
  if (realTransport && toEmail.trim().toLowerCase().endsWith(".test")) {
    throw new Error("Test-domain addresses cannot receive account emails");
  }
  if (!mailer) {
    console.warn(
      "[Password Reset] Gmail is not configured; email delivery unavailable.",
    );
    throw new Error(
      "Email delivery is not configured. Please contact your administrator.",
    );
  }
  let urgentToken: string | null = null;
  let failedWith454 = false;
  let delivery: Awaited<ReturnType<ActivationMailer["sendMail"]>>;
  try {
    if (realTransport) {
      urgentToken = await storage.acquireUrgentEventEmailSlot();
    }
    delivery = (await sendMailWithPriority(
      mailer,
      {
        from: `"Stress Congress App" <${process.env.GMAIL_USER}>`,
        to: toEmail,
        subject: activation
          ? "Your Stress Congress sign-in instructions"
          : "Your Password Reset Code",
        html: EMAIL_HTML(name, code, activation, eventName, toEmail),
      },
      "urgent",
    )) as Awaited<ReturnType<ActivationMailer["sendMail"]>>;
    if (!delivery.accepted?.length || delivery.rejected?.length) {
      throw new Error("Gmail rejected the activation or reset recipient");
    }
  } catch (error) {
    failedWith454 = isSmtp454(error);
    throw error;
  } finally {
    if (urgentToken) {
      await storage.releaseUrgentEventEmailSlot(urgentToken, failedWith454);
    }
  }
  console.log(
    `[Email] Gmail accepted ${delivery.accepted.length} recipient(s); ` +
      `rejected ${delivery.rejected?.length ?? 0}; messageId=${delivery.messageId}`,
  );
}

export type ActivationMailer = {
  sendMail: (message: {
    from: string;
    to: string;
    subject: string;
    html: string;
  }) => Promise<{
    accepted?: string[];
    rejected?: string[];
    messageId?: string;
  }>;
};

export type EventInvitationDelivery = {
  attempted: number;
  sent: number;
  failed: number;
  deferred: number;
};

export async function sendEventInvitationsForEvent(
  event: EventLiveEmail & { status?: string },
  candidates: schema.User[],
  _mailer: ActivationMailer | null = gmailTransporter as unknown as ActivationMailer | null,
): Promise<EventInvitationDelivery> {
  const recipients = candidates.filter(
    (user) =>
      user.eventId === event.id &&
      user.role === "attendee" &&
      !user.eventInvitationSentAt,
  );

  if (event.status !== "published") {
    return {
      attempted: 0,
      sent: 0,
      failed: 0,
      deferred: recipients.length,
    };
  }

  const attempted = await storage.enqueueEventEmailsForEvent(
    event as schema.Event,
    "attendee_added",
    candidates ? recipients.map((user) => user.id) : undefined,
  );

  return {
    attempted,
    sent: 0,
    failed: 0,
    deferred: 0,
  };
}

export type EventLiveEmail = {
  id: string;
  name: string;
  year: number;
  startDate?: Date | string | null;
};

export type EventLiveMailer = {
  sendMail: (message: {
    from: string;
    to: string;
    subject: string;
    html: string;
  }) => Promise<unknown>;
};

export async function sendEventLiveAnnouncements(
  event: EventLiveEmail,
  _mailer: EventLiveMailer | null = gmailTransporter,
): Promise<{
  attempted: number;
  sent: number;
  failed: number;
}> {
  const attempted = await storage.enqueueEventEmailsForEvent(
    event as schema.Event,
    "event_live",
  );
  return { attempted, sent: 0, failed: 0 };
}

export async function processOneEventEmailOutboxItem(
  mailer: ActivationMailer | null = gmailTransporter as unknown as ActivationMailer | null,
  outbox: Pick<
    typeof storage,
    | "claimEventEmail"
    | "getValidatedEventEmailClaim"
    | "skipEventEmail"
    | "completeEventEmail"
    | "failEventEmail"
  > &
    Partial<Pick<typeof storage, "withLockedEventEmailRecipient">> = storage,
): Promise<boolean> {
  const claim = await outbox.claimEventEmail();
  if (!claim) return false;
  const item = await outbox.getValidatedEventEmailClaim(claim);
  if (!item) return true;
  let smtpAccepted = false;
  let smtpStarted = false;
  let definitivelyRejected = false;
  try {
    const deliver = async (current: EventEmailOutboxItem): Promise<void> => {
      if (
        isRealGmailMailer(mailer) &&
        current.recipientEmail.trim().toLowerCase().endsWith(".test")
      ) {
        return;
      }
      if (!mailer) {
        throw new Error("Email delivery is not configured");
      }
      const html =
        current.kind === "event_live"
          ? EVENT_LIVE_HTML(
              current.recipientName,
              current.eventName,
              current.eventStartDate,
              current.eventYear,
            )
          : EVENT_ATTENDEE_ADDED_HTML(
              current.recipientName,
              current.eventName,
              current.eventStartDate,
              current.eventYear,
            );
      smtpStarted = true;
      const result = (await sendMailWithPriority(
        mailer,
        {
          from: `"Stress Congress App" <${process.env.GMAIL_USER}>`,
          to: current.recipientEmail,
          subject:
            current.kind === "event_live"
              ? `${current.eventName} is now live`
              : `You've been added to ${current.eventName}`,
          html,
        },
        "bulk",
      )) as Awaited<ReturnType<ActivationMailer["sendMail"]>>;
      smtpAccepted = Boolean(result.accepted?.length);
      if (!smtpAccepted || result.rejected?.length) {
        definitivelyRejected = !smtpAccepted;
        throw new Error("Gmail rejected the event email recipient");
      }
    };
    const current = outbox.withLockedEventEmailRecipient
      ? await outbox.withLockedEventEmailRecipient(item, deliver)
      : await (async () => {
          await deliver(item);
          return item;
        })();
    if (!current) return true;
    if (
      isRealGmailMailer(mailer) &&
      current.recipientEmail.trim().toLowerCase().endsWith(".test")
    ) {
      await outbox.skipEventEmail(current);
    } else {
      await outbox.completeEventEmail(current);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const smtp454 = isSmtp454(error);
    const uncertain =
      smtpAccepted || (smtpStarted && !smtp454 && !definitivelyRejected);
    await outbox.failEventEmail(item, message, smtp454, uncertain);
    console.warn("[Email] Event outbox delivery failed", {
      outboxId: item.id,
      attempt: item.attempts,
      smtp454,
      deliveryOutcomeUncertain: uncertain,
      error: message,
    });
  }
  return true;
}

let eventEmailWorkerStarted = false;
let eventEmailWorkerBusy = false;
function startEventEmailOutboxWorker(): void {
  if (eventEmailWorkerStarted) return;
  eventEmailWorkerStarted = true;
  const timer = setInterval(() => {
    if (eventEmailWorkerBusy) return;
    eventEmailWorkerBusy = true;
    void processOneEventEmailOutboxItem()
      .catch((error) => console.error("[Email] Outbox worker error", error))
      .finally(() => {
        eventEmailWorkerBusy = false;
      });
  }, 1000);
  timer.unref?.();
}

// ─── Expo Push Notifications helper ─────────────────────────────────────────
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_PUSH_TIMEOUT_MS = 10_000;

/**
 * Fan out a push notification to a list of Expo push tokens.
 * Sends in batches of 100, cleans up DeviceNotRegistered tokens,
 * and returns the number of successfully queued deliveries.
 */
type ExpoPushTicket = {
  status: string;
  details?: { error?: string };
};

type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: "default";
  channelId: "default";
};

type ExpoPushBatchResponse = {
  ok: boolean;
  status: number;
  tickets?: ExpoPushTicket[];
};

export type ExpoPushNotificationDependencies = {
  sendBatch?: (messages: ExpoPushMessage[]) => Promise<ExpoPushBatchResponse>;
  clearInvalidPushToken?: (token: string) => Promise<void>;
};

async function sendExpoPushBatch(
  messages: ExpoPushMessage[],
): Promise<ExpoPushBatchResponse> {
  const res = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    signal: AbortSignal.timeout(EXPO_PUSH_TIMEOUT_MS),
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(messages),
  });
  if (!res.ok) {
    return { ok: false, status: res.status };
  }
  const result = (await res.json()) as { data?: ExpoPushTicket[] };
  return { ok: true, status: res.status, tickets: result.data ?? [] };
}

export async function sendExpoPushNotifications(
  tokens: { userId: string; token: string }[],
  title: string,
  body: string,
  data: Record<string, unknown> = {},
  dependencies: ExpoPushNotificationDependencies = {},
): Promise<{ attempted: number; sent: number; failed: number }> {
  if (tokens.length === 0) {
    return { attempted: 0, sent: 0, failed: 0 };
  }

  const sendBatch = dependencies.sendBatch ?? sendExpoPushBatch;
  const clearInvalidPushToken =
    dependencies.clearInvalidPushToken ??
    ((token: string) => storage.clearInvalidPushToken(token));
  const CHUNK = 100;
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < tokens.length; i += CHUNK) {
    const chunk = tokens.slice(i, i + CHUNK);
    const messages: ExpoPushMessage[] = chunk.map(({ token }) => ({
      to: token,
      title,
      body,
      data,
      sound: "default",
      channelId: "default",
    }));

    try {
      const result = await sendBatch(messages);
      if (!result.ok) {
        console.error(`[Push] Expo API returned ${result.status}`);
        failed += chunk.length;
        continue;
      }
      const tickets = result.tickets ?? [];
      for (let j = 0; j < tickets.length; j++) {
        const ticket = tickets[j];
        if (ticket.status === "ok") {
          sent++;
        } else {
          failed++;
          if (ticket.details?.error === "DeviceNotRegistered") {
            try {
              const token = chunk[j]?.token;
              if (token) await clearInvalidPushToken(token);
            } catch {}
          }
        }
      }
      failed += Math.max(0, chunk.length - tickets.length);
    } catch (e) {
      console.error("[Push] Failed to send batch:", e);
      failed += chunk.length;
    }
  }

  return { attempted: tokens.length, sent, failed };
}

async function notifyPasswordChanged(userId: string): Promise<void> {
  try {
    const tokens = await storage.getUserPushTokens(userId);
    await sendExpoPushNotifications(
      tokens,
      "Password changed",
      "You were signed out on your devices because your password was changed. Please sign in again.",
      { type: "password_changed" },
    );
  } catch (error) {
    // Password changes must not fail because push delivery is unavailable.
    console.error("[Push] Password-change notification failed:", error);
  }
}

const JWT_SECRET = (() => {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "SESSION_SECRET environment variable is required in production",
      );
    }
    console.warn(
      "WARNING: SESSION_SECRET not set — using insecure default. Set SESSION_SECRET before deploying!",
    );
    return "stress-congress-2026-secret-key-dev-only";
  }
  return secret;
})();

const adminUserRoleSchema = z.enum(["attendee", "staff", "admin"]);
const importedUserRoleSchema = z.enum(["attendee", "staff", "admin"]);
const MAX_TAGLINE_LENGTH = 300;
// Image uploads are stored as base64 data URIs when hosted storage is not
// configured. Keep this in sync with the upload endpoint's 1 MB base64 limit,
// while still allowing normal hosted image URLs.
const MAX_LOGO_URL_LENGTH = 1_100_000;
const normalizedEmailSchema = z.preprocess(
  (value) => (typeof value === "string" ? normalizeAuthEmail(value) : value),
  z.string().email("Enter a valid email address"),
);
const adminUserInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(200, "Name is too long"),
  email: normalizedEmailSchema,
  role: adminUserRoleSchema.default("attendee"),
  eventId: z.string().trim().min(1).optional().nullable(),
});
const adminUserUpdateSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Name is required")
      .max(200, "Name is too long")
      .optional(),
    email: normalizedEmailSchema.optional(),
    role: adminUserRoleSchema.optional(),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/\d/, "Password must contain at least one number")
      .optional(),
  })
  .strict();

const adminEventUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    year: z.number().int().min(2000).max(3000).optional(),
    startDate: z.string().trim().max(40).nullable().optional(),
    endDate: z.string().trim().max(40).nullable().optional(),
    scheduleStart: z.string().trim().max(10).nullable().optional(),
    scheduleEnd: z.string().trim().max(10).nullable().optional(),
    location: z.string().trim().max(300).nullable().optional(),
    description: z.string().trim().max(10000).nullable().optional(),
    logoUrl: z
      .string()
      .trim()
      .max(
        MAX_LOGO_URL_LENGTH,
        "Event logo is too large. Remove it or upload a smaller image.",
      )
      .nullable()
      .optional(),
    logoShape: z.enum(["circle", "square"]).optional(),
    logoZoom: z.number().int().min(50).max(250).optional(),
    logoOffsetX: z.number().int().min(-80).max(80).optional(),
    logoOffsetY: z.number().int().min(-80).max(80).optional(),
    primaryColor: z.string().trim().max(32).nullable().optional(),
    accentColor: z.string().trim().max(32).nullable().optional(),
    gradientStart: z.string().trim().max(32).nullable().optional(),
    gradientEnd: z.string().trim().max(32).nullable().optional(),
    tagline: z
      .string()
      .trim()
      .max(
        MAX_TAGLINE_LENGTH,
        `Tagline must be ${MAX_TAGLINE_LENGTH} characters or fewer.`,
      )
      .nullable()
      .optional(),
    displayDate: z.string().trim().max(80).nullable().optional(),
    showYearOnLogin: z.boolean().optional(),
  })
  .strict();

function formatZodMessage(error: z.ZodError): string {
  return error.issues[0]?.message || "Invalid request";
}

function formatAdminEventUpdateMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid event update";

  const field = issue.path[0];
  if (field === "logoUrl") {
    return issue.code === "too_big"
      ? "Event logo is too large. Remove it or upload a smaller image."
      : `Event logo: ${issue.message}`;
  }
  if (field === "tagline") {
    return issue.code === "too_big"
      ? `Tagline must be ${MAX_TAGLINE_LENGTH} characters or fewer.`
      : `Tagline: ${issue.message}`;
  }

  return issue.message;
}

function validateEventStartDate(
  value: unknown,
  eventYear: number | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return EVENT_START_DATE_ERROR_MESSAGE;
  if (!value.trim()) return null;
  return parseEventDate(value, eventYear)
    ? null
    : EVENT_START_DATE_ERROR_MESSAGE;
}
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: "Too many attempts, please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV !== "production",
});

const resetCodeRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    message: "Too many code attempts, please request a new code later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV !== "production",
});

function verificationFailureResponse(): { message: string } {
  return {
    message: "Invalid or expired code. Please request a new one.",
  };
}

// Rate limiting: 20 admin write operations per 15 minutes per IP
const adminWriteRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: "Too many requests, please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV !== "production",
});

const clientErrorRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { message: "Too many diagnostic reports, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV !== "production",
});

const clientErrorSchema = z
  .object({
    platform: z.enum(["ios", "android", "web", "windows", "macos", "unknown"]),
    appVersion: z.string().trim().max(64),
    buildVersion: z.string().trim().max(64),
    osVersion: z.string().trim().max(64),
    message: z.string().trim().min(1).max(1000),
    stack: z.string().trim().max(6000).optional(),
    componentStack: z.string().trim().max(6000).optional(),
  })
  .strict();

interface JWTPayload {
  userId: string;
  email: string;
  role: string;
  passwordVersion: number;
  jti?: string;
}

function generateToken(
  user: {
    id: string;
    email: string;
    role: string;
    passwordVersion: number;
  },
  sessionId?: string,
): string {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      passwordVersion: user.passwordVersion,
      ...(sessionId ? { jti: sessionId } : {}),
    },
    JWT_SECRET,
    { expiresIn: "7d" },
  );
}

async function issueSessionToken(
  user: { id: string; email: string; role: string; passwordVersion: number },
  deviceId: unknown,
  userAgent: string | undefined,
): Promise<string> {
  const sessionId = randomUUID();
  await storage.createAuthSession(
    user.id,
    sessionId,
    typeof deviceId === "string" && deviceId.trim()
      ? deviceId.trim()
      : "unknown-device",
    userAgent,
  );
  return generateToken(user, sessionId);
}

function validatePasswordStrength(password: string): {
  valid: boolean;
  message?: string;
} {
  if (!password || password.length < 8)
    return { valid: false, message: "Password must be at least 8 characters" };
  if (!/\d/.test(password))
    return {
      valid: false,
      message: "Password must contain at least one number",
    };
  return { valid: true };
}

function validateScheduleHours(start: unknown, end: unknown): string | null {
  if (start == null && end == null) return null;
  if (typeof start !== "string" || typeof end !== "string" || !start || !end) {
    return "Both schedule start and end times are required";
  }
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!timePattern.test(start) || !timePattern.test(end)) {
    return "Schedule times must use 24-hour HH:MM format";
  }
  if (start >= end) return "Schedule end time must be later than start time";
  return null;
}

function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch {
    return null;
  }
}

async function authMiddleware(req: Request, res: Response, next: Function) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const token = authHeader.substring(7);
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ message: "Invalid token" });
  }

  // Verify the user still exists — this immediately revokes tokens for deleted accounts
  // without needing a token blacklist or session store.
  const user = await storage.getUserById(payload.userId).catch(() => null);
  if (!user) {
    return res
      .status(401)
      .json({ message: "Account not found or has been deleted" });
  }
  if (user.eventId) {
    const event = await storage.getEventById(user.eventId).catch(() => null);
    if (!event) {
      return res.status(401).json({
        code: "EVENT_DELETED",
        message: "This event account is no longer available.",
      });
    }
  }
  if (payload.passwordVersion !== user.passwordVersion) {
    return res.status(401).json({
      code: "PASSWORD_CHANGED",
      message: "You were logged out because your password was changed.",
    });
  }
  if (payload.jti) {
    const session = await storage.getAuthSession(payload.jti).catch(() => null);
    if (!session || session.userId !== user.id || session.revokedAt) {
      return res.status(401).json({
        code: "SESSION_REVOKED",
        message: "This device session has been revoked.",
      });
    }
    await storage.touchAuthSession(payload.jti).catch(() => {});
  }

  (req as any).userId = user.id;
  (req as any).userRole = user.role;
  (req as any).sessionId = payload.jti;
  next();
}

/**
 * Narrow an Express route parameter to a plain string.
 * `ParamsDictionary` is typed as `{ [key: string]: string | string[] }` in some
 * versions of @types/express, but route params are never arrays at runtime.
 */
function asParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function csvResponse(
  res: Response,
  filename: string,
  headers: string[],
  rows: unknown[][],
) {
  const body = [headers, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.send(`\ufeff${body}\r\n`);
}

function safeAdminUser(
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    checkedIn: boolean;
    checkedInAt: Date | null;
    eventId: string | null;
    eventInvitationSentAt: Date | null;
    photoUrl: string | null;
    createdAt: Date;
  },
  eventInvitationStatus: string | null = null,
) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    checkedIn: user.checkedIn,
    checkedInAt: user.checkedInAt,
    eventId: user.eventId,
    eventInvitationSentAt: user.eventInvitationSentAt,
    eventInvitationStatus: user.eventInvitationSentAt
      ? "sent"
      : eventInvitationStatus,
    photoUrl: user.photoUrl,
    createdAt: user.createdAt,
  };
}

export async function registerRoutes(app: Express): Promise<Server> {
  await storage.seedData();

  app.post(
    "/api/client-errors",
    clientErrorRateLimit,
    (req: Request, res: Response) => {
      const parsed = clientErrorSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid diagnostic report." });
      }

      const clientErrorId = `ERR-${randomUUID()
        .replace(/-/g, "")
        .slice(0, 10)
        .toUpperCase()}`;
      console.error(
        JSON.stringify({
          event: "client_error",
          clientErrorId,
          requestId: res.getHeader("x-request-id"),
          ...parsed.data,
        }),
      );

      return res.status(202).json({ clientErrorId });
    },
  );

  type EventAccountOption = {
    id: string;
    name: string;
    year: number;
    status: string;
    needsSetup: boolean;
    showYearOnLogin: boolean;
  };

  type AuthenticationAccount = {
    user: Awaited<ReturnType<typeof storage.getUsersByEmail>>[number];
    event: NonNullable<Awaited<ReturnType<typeof storage.getEventById>>>;
  };

  // Resolve an email to the event account it is actually allowed to use.
  // Only global administrators are available without an event. Attendees and
  // staff are always resolved to their own surviving event account.
  async function getAuthenticationAccounts(email: string): Promise<{
    globalUser?: Awaited<ReturnType<typeof storage.getUsersByEmail>>[number];
    eventAccounts: AuthenticationAccount[];
  }> {
    const users = await storage.getUsersByEmail(email);
    const globalUser = users.find(
      (candidate) => !candidate.eventId && candidate.role === "admin",
    );
    if (globalUser) return { globalUser, eventAccounts: [] };

    const eventAccounts: AuthenticationAccount[] = [];
    for (const candidate of users) {
      if (!candidate.eventId) continue;
      const event = await storage.getEventById(candidate.eventId);
      if (event) eventAccounts.push({ user: candidate, event });
    }

    eventAccounts.sort(
      (left, right) =>
        Number(right.event.status === "published") -
          Number(left.event.status === "published") ||
        right.event.year - left.event.year,
    );
    return { eventAccounts };
  }

  function toEventAccountOption(
    account: AuthenticationAccount,
  ): EventAccountOption {
    return {
      id: account.event.id,
      name: account.event.name,
      year: account.event.year,
      status: account.event.status,
      needsSetup: !account.user.passwordHash,
      showYearOnLogin: account.event.showYearOnLogin !== false,
    };
  }

  function eventHasBeenLive(
    event: NonNullable<Awaited<ReturnType<typeof storage.getEventById>>>,
  ) {
    return event.status === "published" || Boolean(event.lastPublishedAt);
  }

  const eventNotLiveResponse = {
    code: "EVENT_NOT_LIVE",
    message:
      "This event is still under construction. Sign-in will be available after it has been live.",
  };

  async function identifyAuthenticationEmail(email: string) {
    const accounts = await getAuthenticationAccounts(email);
    if (accounts.globalUser) {
      return {
        user: accounts.globalUser,
        needsPassword: Boolean(accounts.globalUser.passwordHash),
        needsSetup: !accounts.globalUser.passwordHash,
        accountType: "global" as const,
      };
    }

    if (accounts.eventAccounts.length === 0) return undefined;
    const liveAccounts = accounts.eventAccounts.filter((account) =>
      eventHasBeenLive(account.event),
    );
    if (liveAccounts.length === 0) {
      return {
        eventUnavailable: true as const,
        event: toEventAccountOption(accounts.eventAccounts[0]),
        eventOptions: accounts.eventAccounts.map(toEventAccountOption),
        ...eventNotLiveResponse,
      };
    }
    if (liveAccounts.length > 1) {
      return {
        eventSelectionRequired: true as const,
        eventOptions: liveAccounts.map(toEventAccountOption),
      };
    }

    const account = liveAccounts[0];
    return {
      user: account.user,
      needsPassword: Boolean(account.user.passwordHash),
      needsSetup: !account.user.passwordHash,
      accountType: "event" as const,
      event: toEventAccountOption(account),
    };
  }

  async function resolveAuthenticationUser(
    email: string,
    selectedEventId?: string,
  ) {
    const accounts = await getAuthenticationAccounts(email);
    if (accounts.globalUser) {
      return selectedEventId ? undefined : accounts.globalUser;
    }

    if (selectedEventId) {
      const selectedAccount = accounts.eventAccounts.find(
        (account) => account.event.id === selectedEventId,
      );
      return selectedAccount && eventHasBeenLive(selectedAccount.event)
        ? selectedAccount.user
        : undefined;
    }

    const liveAccounts = accounts.eventAccounts.filter((account) =>
      eventHasBeenLive(account.event),
    );
    return liveAccounts.length === 1 ? liveAccounts[0].user : undefined;
  }

  // ─── Public: Active Event Theme (no auth required) ───────────────────────────
  app.get("/api/events/active", async (_req: Request, res: Response) => {
    try {
      const bearer = _req.headers.authorization;
      let payload: { userId: string } | null = null;
      if (bearer?.startsWith("Bearer ")) {
        try {
          payload = verifyToken(bearer.substring(7));
        } catch {
          // This endpoint is public. An expired or revoked optional token
          // should not prevent the login screen from loading the live theme.
        }
      }
      const authenticatedUser = payload
        ? await storage.getUserById(payload.userId)
        : undefined;
      const event = authenticatedUser?.eventId
        ? await storage.getEventById(authenticatedUser.eventId)
        : await storage.getActiveEvent();
      if (!event) {
        return res.status(404).json({ message: "No active event" });
      }
      return res.json(event);
    } catch (error) {
      console.error("Get active event error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post(
    "/api/auth/login",
    authRateLimit,
    async (req: Request, res: Response) => {
      try {
        const { email, password, deviceId, eventId } = req.body;

        if (!email) {
          return res.status(400).json({ message: "Email is required" });
        }

        const normalizedEmail = normalizeAuthEmail(email);
        const identification =
          await identifyAuthenticationEmail(normalizedEmail);

        if (!password) {
          if (!identification) {
            return res.status(404).json({
              code: "INVALID_EMAIL",
              message: "This email is not registered for an event.",
            });
          }
          if ("eventUnavailable" in identification) {
            return res.status(403).json(identification);
          }
          if ("eventSelectionRequired" in identification) {
            return res.json(identification);
          }
          return res.json({
            needsPassword: identification.needsPassword,
            needsSetup: identification.needsSetup,
            accountType: identification.accountType,
            event: "event" in identification ? identification.event : null,
          });
        }

        if (identification && "eventUnavailable" in identification) {
          return res.status(403).json(identification);
        }

        if (
          identification &&
          "eventSelectionRequired" in identification &&
          !eventId
        ) {
          return res.status(409).json({
            code: "EVENT_SELECTION_REQUIRED",
            message:
              "Choose the event year for this account before signing in.",
            eventOptions: identification.eventOptions,
          });
        }

        const user = await resolveAuthenticationUser(normalizedEmail, eventId);
        const isValidPassword = await bcrypt.compare(
          password,
          user?.passwordHash ||
            "$2a$10$JPcLyyhaavvjaxQC7qF8Qe/75BDGU7IOexVsWEuAcmZtF6AOrAOti",
        );
        if (!user?.passwordHash || !isValidPassword) {
          await storage.logLoginEvent(
            normalizedEmail,
            "login_failed",
            user?.eventId || null,
          );
          return res.status(401).json({ message: "Invalid email or password" });
        }

        await storage.logLoginEvent(
          normalizedEmail,
          "login_success",
          user.eventId || null,
        );
        const updatedUser = await storage.getUserById(user.id);
        if (!updatedUser) {
          return res.status(404).json({ message: "Account not found" });
        }
        const token = await issueSessionToken(
          updatedUser,
          deviceId,
          req.get("user-agent"),
        );
        return res.json({
          token,
          user: {
            id: updatedUser.id,
            email: updatedUser.email,
            name: updatedUser.name,
            role: updatedUser.role,
            qrCodeValue: updatedUser.qrCodeValue,
            checkedIn: updatedUser.checkedIn,
            photoUrl: updatedUser.photoUrl,
          },
        });
      } catch (error) {
        console.error("Login error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  // Self-registration is disabled — admin creates all accounts
  app.post("/api/auth/register", (_req: Request, res: Response) => {
    return res.status(403).json({
      message:
        "Self-registration is disabled. Contact your event administrator.",
    });
  });

  // ─── Token refresh ───────────────────────────────────────────────────────────
  app.post(
    "/api/auth/refresh",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const user = await storage.getUserById((req as any).userId);
        if (!user) return res.status(404).json({ message: "User not found" });
        const token = generateToken(user, (req as any).sessionId);
        return res.json({ token });
      } catch (error) {
        console.error("Token refresh error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.post(
    "/api/auth/logout",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const sessionId = (req as any).sessionId as string | undefined;
        if (sessionId) {
          await storage.revokeAuthSession((req as any).userId, sessionId);
        }
        return res.status(204).send();
      } catch (error) {
        console.error("Logout error:", error);
        return res.status(500).json({ message: "Unable to end this session" });
      }
    },
  );

  app.post(
    "/api/auth/set-password",
    authRateLimit,
    async (req: Request, res: Response) => {
      try {
        const { email, code, newPassword, eventId } = req.body;
        const normalizedEmail = normalizeAuthEmail(email);
        if (!email || !code || !newPassword)
          return res.status(400).json({
            message: "Email, verification code, and password are required",
          });
        const strengthCheck = validatePasswordStrength(newPassword);
        if (!strengthCheck.valid)
          return res.status(400).json({ message: strengthCheck.message });

        const user = await resolveAuthenticationUser(normalizedEmail, eventId);
        if (!user || user.passwordHash) {
          return res.status(400).json(verificationFailureResponse());
        }

        const verification = await storage.verifyResetToken(
          user.id,
          user.email,
          code.trim(),
          "activation",
        );
        if (!verification.valid) {
          return res.status(400).json(verificationFailureResponse());
        }
        if (await storage.isPasswordReused(user.id, newPassword)) {
          return res.status(400).json({ message: PASSWORD_REUSE_MESSAGE });
        }
        const passwordHash = await bcrypt.hash(newPassword, 10);
        const updated = await storage.consumeResetTokenAndSetPassword(
          user.id,
          user.email,
          code.trim(),
          passwordHash,
          "activation",
          true,
        );
        if (!updated) {
          return res.status(400).json({
            message: "Invalid or expired code. Please request a new one.",
          });
        }
        await storage.logLoginEvent(user.email, "password_set", user.eventId);
        await notifyPasswordChanged(user.id);

        const updatedUser = await storage.getUserById(user.id);
        if (!updatedUser) {
          return res.status(404).json({ message: "Account not found" });
        }
        const token = await issueSessionToken(
          updatedUser,
          req.body?.deviceId,
          req.get("user-agent"),
        );
        return res.json({
          token,
          user: {
            id: updatedUser.id,
            email: updatedUser.email,
            name: updatedUser.name,
            role: updatedUser.role,
            qrCodeValue: updatedUser.qrCodeValue,
            checkedIn: updatedUser.checkedIn,
            photoUrl: updatedUser.photoUrl,
          },
        });
      } catch (error) {
        console.error("Set password error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.post(
    "/api/auth/forgot-password",
    authRateLimit,
    async (req: Request, res: Response) => {
      try {
        const { email, eventId } = req.body;
        if (!email)
          return res.status(400).json({ message: "Email is required" });
        const normalizedEmail = normalizeAuthEmail(email);
        const user = await resolveAuthenticationUser(normalizedEmail, eventId);
        if (!user || !user.passwordHash) {
          return res.json({
            message: "If this email is registered, a reset code has been sent.",
          });
        }
        const retryAfterSeconds = await storage.getResetTokenCooldownSeconds(
          user.id,
          "reset",
        );
        if (retryAfterSeconds > 0) {
          res.set("Retry-After", String(retryAfterSeconds));
          return res.status(429).json({
            code: "RESEND_COOLDOWN",
            retryAfterSeconds,
            message: `Please wait ${retryAfterSeconds} seconds before requesting another code.`,
          });
        }
        const code = String(randomInt(100000, 1000000));
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        await storage.createResetToken(
          user.id,
          user.email,
          code,
          expiresAt,
          "reset",
        );
        try {
          await sendResetEmail(user.email, user.name, code);
        } catch (error) {
          await storage.deleteResetTokens(user.id, "reset");
          throw error;
        }
        return res.json({
          message: "If this email is registered, a reset code has been sent.",
        });
      } catch (error: any) {
        console.error("Forgot password error:", error);
        return res
          .status(500)
          .json({ message: "Unable to request a reset code" });
      }
    },
  );

  app.post(
    "/api/auth/change-password",
    authRateLimit,
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { currentPassword, newPassword } = req.body ?? {};
        if (
          typeof currentPassword !== "string" ||
          typeof newPassword !== "string" ||
          !currentPassword ||
          !newPassword
        ) {
          return res.status(400).json({
            message: "Current password and new password are required",
          });
        }
        const strengthCheck = validatePasswordStrength(newPassword);
        if (!strengthCheck.valid) {
          return res.status(400).json({ message: strengthCheck.message });
        }
        const user = await storage.getUserById((req as any).userId);
        if (!user?.passwordHash) {
          return res.status(400).json({ message: "Password is not set up" });
        }
        if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
          return res
            .status(400)
            .json({ message: "Current password is incorrect" });
        }
        if (await storage.isPasswordReused(user.id, newPassword)) {
          return res.status(400).json({ message: PASSWORD_REUSE_MESSAGE });
        }
        const passwordHash = await bcrypt.hash(newPassword, 10);
        await storage.updateUserPassword(user.id, passwordHash);
        await notifyPasswordChanged(user.id);
        return res.json({ passwordChanged: true });
      } catch (error) {
        console.error("Change password error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.post(
    "/api/auth/request-activation",
    authRateLimit,
    async (req: Request, res: Response) => {
      const generic =
        "If this email is registered for an unactivated account, an activation code has been sent.";
      try {
        const email = normalizeAuthEmail(req.body?.email);
        const eventId =
          typeof req.body?.eventId === "string" ? req.body.eventId : undefined;
        if (!email)
          return res.status(400).json({ message: "Email is required" });
        const identification = await identifyAuthenticationEmail(email);
        if (identification && "eventUnavailable" in identification) {
          return res.status(403).json(identification);
        }
        const user = await resolveAuthenticationUser(email, eventId);
        if (!user) {
          return res.status(404).json({
            code: "INVALID_EMAIL",
            message: "This email is not registered for an event.",
          });
        }
        if (user.passwordHash) return res.json({ message: generic });
        const userEvent = user.eventId
          ? await storage.getEventById(user.eventId)
          : undefined;
        const retryAfterSeconds = await storage.getResetTokenCooldownSeconds(
          user.id,
          "activation",
        );
        if (retryAfterSeconds > 0) return res.json({ message: generic });
        const code = String(randomInt(100000, 1000000));
        await storage.createResetToken(
          user.id,
          user.email,
          code,
          new Date(Date.now() + 10 * 60 * 1000),
          "activation",
        );
        try {
          await sendResetEmail(
            user.email,
            user.name,
            code,
            true,
            userEvent?.name,
          );
          await storage.markActivationInvitationSent(user.id);
        } catch (error) {
          await storage.deleteResetTokens(user.id, "activation");
          throw error;
        }
        return res.json({ message: generic });
      } catch (error) {
        console.error("Activation request error:", error);
        return res.status(500).json({
          message: "Unable to send activation email. Please try again.",
        });
      }
    },
  );

  app.post(
    "/api/auth/verify-reset-code",
    resetCodeRateLimit,
    async (req: Request, res: Response) => {
      try {
        const { email, code, eventId } = req.body;
        const normalizedEmail = normalizeAuthEmail(email);
        if (!email || !code)
          return res
            .status(400)
            .json({ message: "Email and code are required" });
        const user = await resolveAuthenticationUser(normalizedEmail, eventId);
        const verification = user
          ? await storage.verifyResetToken(
              user.id,
              user.email,
              code.trim(),
              req.body?.purpose === "reset" ? "reset" : "activation",
            )
          : { valid: false as const, reason: "not_found" as const };
        if (!verification.valid)
          return res.status(400).json(verificationFailureResponse());
        return res.json({ valid: true });
      } catch (error) {
        console.error("Verify reset code error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.post(
    "/api/auth/reset-password",
    authRateLimit,
    async (req: Request, res: Response) => {
      try {
        const { email, code, newPassword, eventId } = req.body;
        const normalizedEmail = normalizeAuthEmail(email);

        if (!email || !code || !newPassword) {
          return res
            .status(400)
            .json({ message: "Email, code, and new password are required" });
        }

        const strengthCheck = validatePasswordStrength(newPassword);
        if (!strengthCheck.valid) {
          return res.status(400).json({ message: strengthCheck.message });
        }

        const user = await resolveAuthenticationUser(normalizedEmail, eventId);
        if (!user || !user.passwordHash) {
          return res.status(400).json({
            message: "Invalid or expired code. Please request a new one.",
          });
        }

        const verification = await storage.verifyResetToken(
          user.id,
          user.email,
          code.trim(),
          "reset",
        );
        if (!verification.valid) {
          return res.status(400).json(verificationFailureResponse());
        }
        if (await storage.isPasswordReused(user.id, newPassword)) {
          return res.status(400).json({ message: PASSWORD_REUSE_MESSAGE });
        }

        const passwordHash = await bcrypt.hash(newPassword, 10);
        const tokenConsumed = await storage.consumeResetTokenAndSetPassword(
          user.id,
          user.email,
          code.trim(),
          passwordHash,
          "reset",
          false,
        );
        if (!tokenConsumed) {
          return res.status(400).json({
            message: "Invalid or expired code. Please request a new one.",
          });
        }
        await notifyPasswordChanged(user.id);

        return res.json({
          passwordChanged: true,
        });
      } catch (error) {
        console.error("Reset password error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  // ─── Push token registration ─────────────────────────────────────────────────
  app.put(
    "/api/users/push-token",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).userId;
        const { token, deviceId } = req.body;
        if (deviceId && typeof deviceId === "string") {
          await storage.saveDevicePushToken(userId, deviceId, token ?? null);
          return res.json({ ok: true });
        }
        // token may be null (to clear) or an Expo push token string
        await storage.savePushToken(userId, token ?? null);
        return res.json({ ok: true });
      } catch (error) {
        console.error("Save push token error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.get(
    "/api/users/notification-preferences",
    authMiddleware,
    async (req: Request, res: Response) => {
      const deviceId =
        typeof req.query.deviceId === "string" ? req.query.deviceId.trim() : "";
      if (!deviceId)
        return res.status(400).json({ message: "Device ID is required" });
      try {
        return res.json(
          await storage.getNotificationPreferences(
            (req as any).userId,
            deviceId,
          ),
        );
      } catch (error) {
        console.error("Get notification preferences error:", error);
        return res
          .status(500)
          .json({ message: "Unable to load notification preferences" });
      }
    },
  );

  app.put(
    "/api/users/notification-preferences",
    authMiddleware,
    async (req: Request, res: Response) => {
      const deviceId =
        typeof req.body?.deviceId === "string" ? req.body.deviceId.trim() : "";
      if (!deviceId)
        return res.status(400).json({ message: "Device ID is required" });
      const preferences = req.body?.preferences ?? {
        pushEnabled: req.body?.pushEnabled,
        sessionAlerts: req.body?.sessionAlerts,
      };
      const parsed = z
        .object({
          pushEnabled: z.boolean().optional(),
          sessionAlerts: z.boolean().optional(),
        })
        .strict()
        .safeParse(preferences);
      if (!parsed.success || Object.keys(parsed.data).length === 0) {
        return res
          .status(400)
          .json({ message: "At least one valid preference is required" });
      }
      try {
        return res.json(
          await storage.updateNotificationPreferences(
            (req as any).userId,
            deviceId,
            parsed.data,
          ),
        );
      } catch (error) {
        console.error("Update notification preferences error:", error);
        return res
          .status(500)
          .json({ message: "Unable to save notification preferences" });
      }
    },
  );

  app.get(
    "/api/auth/me",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const user = await storage.getUserById((req as any).userId);
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        return res.json({
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          qrCodeValue: user.qrCodeValue,
          checkedIn: user.checkedIn,
          photoUrl: user.photoUrl,
        });
      } catch (error) {
        console.error("Get user error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.get(
    "/api/auth/devices",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const currentDeviceId =
          typeof req.query.deviceId === "string" ? req.query.deviceId : "";
        const sessions = await storage.getAuthSessions((req as any).userId);
        return res.json(
          sessions.map((session) => ({
            id: session.id,
            deviceId: session.deviceId,
            userAgent: session.userAgent,
            createdAt: session.createdAt,
            lastSeenAt: session.lastSeenAt,
            current:
              session.id === (req as any).sessionId ||
              (!!currentDeviceId && session.deviceId === currentDeviceId),
          })),
        );
      } catch (error) {
        console.error("Get devices error:", error);
        return res.status(500).json({ message: "Unable to load devices" });
      }
    },
  );

  app.delete(
    "/api/auth/devices/:sessionId",
    authMiddleware,
    async (req: Request, res: Response) => {
      const sessionId = asParam(req.params.sessionId);
      if (!sessionId) {
        return res.status(400).json({ message: "Device is required" });
      }
      try {
        const revoked = await storage.revokeAuthSession(
          (req as any).userId,
          sessionId,
        );
        if (!revoked) {
          return res.status(404).json({ message: "Device not found" });
        }
        return res.json({
          ok: true,
          current: sessionId === (req as any).sessionId,
        });
      } catch (error) {
        console.error("Revoke device error:", error);
        return res.status(500).json({ message: "Unable to revoke device" });
      }
    },
  );

  app.put(
    "/api/users/profile-photo",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const dataUri = req.body?.dataUri;
        if (typeof dataUri !== "string") {
          return res.status(400).json({ message: "dataUri is required" });
        }
        if (dataUri === "") {
          const user = await storage.updateUser((req as any).userId, {
            photoUrl: null,
          });
          return res.json({ url: user.photoUrl, photoUrl: user.photoUrl });
        }
        const match = dataUri.match(/^data:image\/[^;]+;base64,(.+)$/s);
        if (!match || match[1].length > 1_048_576) {
          return res
            .status(400)
            .json({ message: "Invalid or oversized image" });
        }
        const user = await storage.updateUser((req as any).userId, {
          photoUrl: dataUri,
        });
        return res.json({ url: user.photoUrl, photoUrl: user.photoUrl });
      } catch (error) {
        console.error("Update profile photo error:", error);
        return res
          .status(500)
          .json({ message: "Unable to save profile photo" });
      }
    },
  );

  app.post(
    "/api/check-in",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const userRole = (req as any).userRole;
        if (userRole !== "staff" && userRole !== "admin") {
          return res
            .status(403)
            .json({ success: false, message: "Staff access required" });
        }
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(400).json({
            success: false,
            message: "No event is currently selected",
          });
        const actor = await storage.getUserById((req as any).userId);
        const recordOutcome = (statusCode: number) =>
          storage.logAuditAction(
            actor?.id || (req as any).userId,
            actor?.email || "unknown",
            "staff_qr_scan",
            undefined,
            "qr_scan",
            {
              eventId,
              eventOutcome: statusCode >= 400 ? "failed" : "recorded",
              statusCode,
            },
          );
        const { qrCodeValue } = req.body;

        if (!qrCodeValue) {
          await recordOutcome(400);
          return res
            .status(400)
            .json({ success: false, message: "QR code value is required" });
        }

        const user = await storage.getUserByQRCode(qrCodeValue, eventId);

        if (!user) {
          await recordOutcome(404);
          return res.status(404).json({
            success: false,
            message:
              "This QR code is not an attendee QR for the selected event",
          });
        }

        if (user.checkedIn) {
          await recordOutcome(200);
          return res.json({
            success: false,
            alreadyCheckedIn: true,
            user: { name: user.name, email: user.email },
            message: "Attendee already checked in",
          });
        }

        if (!(await storage.checkInUser(user.id, eventId))) {
          const currentUser = await storage.getUserById(user.id);
          if (currentUser?.checkedIn) {
            await recordOutcome(200);
            return res.json({
              success: false,
              alreadyCheckedIn: true,
              user: { name: currentUser.name, email: currentUser.email },
              message: "Attendee already checked in",
            });
          }
          await recordOutcome(409);
          return res.status(409).json({
            success: false,
            message: "Attendee could not be checked in for this event",
          });
        }

        await recordOutcome(200);
        return res.json({
          success: true,
          user: { name: user.name, email: user.email },
          message: "Check-in successful",
        });
      } catch (error) {
        console.error("Check-in error:", error);
        return res
          .status(500)
          .json({ success: false, message: "Internal server error" });
      }
    },
  );

  app.post(
    "/api/manual-check-in",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const userRole = (req as any).userRole;
        if (userRole !== "staff" && userRole !== "admin") {
          return res
            .status(403)
            .json({ success: false, message: "Staff access required" });
        }
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(400).json({
            success: false,
            message: "No event is currently selected",
          });
        const actor = await storage.getUserById((req as any).userId);
        const recordOutcome = (statusCode: number) =>
          storage.logAuditAction(
            actor?.id || (req as any).userId,
            actor?.email || "unknown",
            "manual_check_in",
            req.body?.userId,
            "attendee",
            {
              eventId,
              eventOutcome: statusCode >= 400 ? "failed" : "recorded",
              statusCode,
            },
          );
        const { userId } = req.body;

        if (!userId) {
          await recordOutcome(400);
          return res
            .status(400)
            .json({ success: false, message: "User ID is required" });
        }

        const user = await storage.getUserById(userId);

        if (!user) {
          await recordOutcome(404);
          return res
            .status(404)
            .json({ success: false, message: "Attendee not found" });
        }
        if (user.eventId !== eventId || user.role !== "attendee") {
          await recordOutcome(404);
          return res.status(404).json({
            success: false,
            message: "Attendee is not registered for the selected event",
          });
        }

        if (user.checkedIn) {
          await recordOutcome(400);
          return res
            .status(400)
            .json({ success: false, message: "Attendee already checked in" });
        }

        if (!(await storage.checkInUser(user.id, eventId))) {
          const currentUser = await storage.getUserById(user.id);
          if (currentUser?.checkedIn) {
            await recordOutcome(400);
            return res.status(400).json({
              success: false,
              message: "Attendee already checked in",
            });
          }
          await recordOutcome(409);
          return res.status(409).json({
            success: false,
            message: "Attendee could not be checked in for this event",
          });
        }

        await recordOutcome(200);
        return res.json({
          success: true,
          user: { name: user.name, email: user.email },
          message: "Check-in successful",
        });
      } catch (error) {
        console.error("Manual check-in error:", error);
        return res
          .status(500)
          .json({ success: false, message: "Internal server error" });
      }
    },
  );

  app.post(
    "/api/check-out",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const userRole = (req as any).userRole;
        if (userRole !== "staff" && userRole !== "admin") {
          return res
            .status(403)
            .json({ success: false, message: "Staff access required" });
        }
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(400).json({
            success: false,
            message: "No event is currently selected",
          });
        const actor = await storage.getUserById((req as any).userId);
        const recordOutcome = (statusCode: number) =>
          storage.logAuditAction(
            actor?.id || (req as any).userId,
            actor?.email || "unknown",
            "staff_check_out",
            req.body?.userId,
            "attendee",
            {
              eventId,
              eventOutcome: statusCode >= 400 ? "failed" : "recorded",
              statusCode,
            },
          );
        const { userId } = req.body;

        if (!userId) {
          await recordOutcome(400);
          return res
            .status(400)
            .json({ success: false, message: "User ID is required" });
        }

        const user = await storage.getUserById(userId);

        if (!user) {
          await recordOutcome(404);
          return res
            .status(404)
            .json({ success: false, message: "Attendee not found" });
        }
        if (user.eventId !== eventId || user.role !== "attendee") {
          await recordOutcome(404);
          return res.status(404).json({
            success: false,
            message: "Attendee is not registered for the selected event",
          });
        }

        if (!user.checkedIn) {
          await recordOutcome(400);
          return res
            .status(400)
            .json({ success: false, message: "Attendee is not checked in" });
        }

        if (!(await storage.checkOutUser(user.id, eventId))) {
          const currentUser = await storage.getUserById(user.id);
          if (!currentUser?.checkedIn) {
            await recordOutcome(400);
            return res.status(400).json({
              success: false,
              message: "Attendee is not checked in",
            });
          }
          await recordOutcome(409);
          return res.status(409).json({
            success: false,
            message: "Attendee could not be checked out for this event",
          });
        }

        await recordOutcome(200);
        return res.json({
          success: true,
          user: { name: user.name, email: user.email },
          message: "Check-out successful",
        });
      } catch (error) {
        console.error("Check-out error:", error);
        return res
          .status(500)
          .json({ success: false, message: "Internal server error" });
      }
    },
  );

  app.get(
    "/api/stats",
    staffMiddleware,
    async (req: Request, res: Response) => {
      try {
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.json({
            totalRegistered: 0,
            checkedIn: 0,
            pending: 0,
            attendeeCount: 0,
            staffCount: 0,
          });
        const stats = await storage.getStats(eventId);
        return res.json(stats);
      } catch (error) {
        console.error("Get stats error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.get(
    "/api/recent-checkins",
    staffMiddleware,
    async (req: Request, res: Response) => {
      try {
        const eventId = await resolveEventId(req);
        if (!eventId) return res.json([]);
        const checkIns = await storage.getRecentCheckIns(10, eventId);
        return res.json(checkIns);
      } catch (error) {
        console.error("Get recent check-ins error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.get(
    "/api/attendees",
    staffMiddleware,
    async (req: Request, res: Response) => {
      try {
        const eventId = await resolveEventId(req);
        if (!eventId) return res.json([]);
        const users = await storage.getAllUsers(eventId);
        return res.json(
          users
            .filter((user) => user.role !== "admin")
            .map((u) => ({
              id: u.id,
              name: u.name,
              email: u.email,
              role: u.role,
              checkedIn: u.checkedIn,
            })),
        );
      } catch (error) {
        console.error("Get attendees error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.get(
    "/api/sessions",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const eventId = await resolveEventId(req);
        if (!eventId) return res.json([]);
        const sessions = await storage.getSessions(eventId);
        return res.json(sessions);
      } catch (error) {
        console.error("Get sessions error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.get(
    "/api/speakers",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const eventId = await resolveEventId(req);
        if (!eventId) return res.json([]);
        const speakers = await storage.getSpeakers(eventId);
        return res.json(speakers);
      } catch (error) {
        console.error("Get speakers error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.get(
    "/api/notifications",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).userId;
        const userRole = (req as any).userRole;
        const eventId = await resolveEventId(req);
        if (!eventId) return res.json([]);
        const activeEvent = await storage.getEventById(eventId);
        if (!activeEvent) return res.json([]);
        const notifications = await storage.getUserNotifications(
          userId,
          userRole,
          eventId,
        );
        const deviceId =
          typeof req.query.deviceId === "string" ? req.query.deviceId : "";
        const preferences = deviceId
          ? await storage.getNotificationPreferences(userId, deviceId)
          : { pushEnabled: true, sessionAlerts: true };

        const sessionFilteredNotifications = preferences.sessionAlerts
          ? notifications
          : notifications.filter(
              (item) => item.type !== "alert" && item.type !== "session",
            );
        const visibleNotifications = sessionFilteredNotifications.filter(
          (item) => item.type !== "event_reminder",
        );
        return res.json(visibleNotifications);
      } catch (error) {
        console.error("Get notifications error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.post(
    "/api/notifications/:id/read",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).userId;
        const userRole = (req as any).userRole;
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(400).json({ message: "No active event" });

        const notifications = await storage.getUserNotifications(
          userId,
          userRole,
          eventId,
        );
        if (
          !notifications.some(
            (notification) => notification.id === asParam(req.params.id),
          )
        ) {
          return res.status(404).json({ message: "Notification not found" });
        }

        await storage.markNotificationRead(userId, asParam(req.params.id));
        return res.json({ success: true });
      } catch (error) {
        console.error("Mark notification read error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.post(
    "/api/notifications/read-all",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).userId;
        const userRole = (req as any).userRole;
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(400).json({ message: "No active event" });
        const count = await storage.markAllNotificationsRead(
          userId,
          userRole,
          eventId,
        );
        return res.json({ success: true, count });
      } catch (error) {
        console.error("Mark all notifications read error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.delete(
    "/api/notifications/:id",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).userId;
        const userRole = (req as any).userRole;
        const eventId = await resolveEventId(req);
        const notificationId = asParam(req.params.id);
        if (!eventId)
          return res.status(400).json({ message: "No active event" });
        if (notificationId.startsWith("reminder-")) {
          return res
            .status(400)
            .json({ message: "Reminder notifications cannot be dismissed" });
        }
        const notifications = await storage.getUserNotifications(
          userId,
          userRole,
          eventId,
        );
        if (
          !notifications.some(
            (notification) => notification.id === notificationId,
          )
        ) {
          return res.status(404).json({ message: "Notification not found" });
        }
        await storage.dismissNotification(userId, notificationId);
        return res.json({ success: true });
      } catch (error) {
        console.error("Dismiss notification error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.post(
    "/api/notifications",
    authMiddleware,
    adminWriteRateLimit,
    async (req: Request, res: Response) => {
      try {
        const userRole = (req as any).userRole;
        const userId = (req as any).userId;
        if (userRole !== "staff" && userRole !== "admin") {
          return res
            .status(403)
            .json({ message: "Only staff or admin can create notifications" });
        }
        const { title, message, type, targetRole } = req.body;
        if (type === "event_reminder") {
          return res.status(400).json({
            message: "Countdown notifications are no longer supported",
          });
        }
        if (!title || !message) {
          return res
            .status(400)
            .json({ message: "Title and message are required" });
        }
        const allowedTargetRoles = [
          null,
          undefined,
          "all",
          "attendee",
          "staff",
        ];
        if (!allowedTargetRoles.includes(targetRole)) {
          return res
            .status(400)
            .json({ message: "Target must be everyone, attendees, or staff" });
        }
        const normalisedTargetRole = targetRole === "all" ? null : targetRole;
        const resolvedEventId = await resolveEventId(req);
        if (!resolvedEventId)
          return res
            .status(400)
            .json({ message: "No event is currently selected" });
        const notification = await storage.createNotification(
          title,
          message,
          type || "announcement",
          normalisedTargetRole,
          resolvedEventId,
        );
        const publisher = await storage.getUserById(userId);
        await storage.logAuditAction(
          userId,
          publisher?.email || "unknown",
          "publish_notification",
          notification.id,
          "notification",
          {
            title,
            targetRole: normalisedTargetRole || "all",
            eventId: resolvedEventId,
          },
        );

        // Fan out real push notifications to registered devices, respecting targetRole
        const tokens = await storage.getAttendeePushTokens(
          resolvedEventId,
          normalisedTargetRole,
          type || "announcement",
        );
        const pushDelivery = await sendExpoPushNotifications(
          tokens,
          title,
          message,
          {
            screen: "Notifications",
            notificationId: notification.id,
            type: type || "announcement",
          },
        );
        return res.json({
          ...notification,
          pushCount: pushDelivery.sent,
          pushAttempted: pushDelivery.attempted,
          pushFailed: pushDelivery.failed,
        });
      } catch (error) {
        console.error("Create notification error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.get(
    "/api/timetable",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).userId;
        const userRole = (req as any).userRole;
        const eventId = await resolveEventId(req);
        if (!eventId) return res.json([]);
        const items = await storage.getTimetableItems(eventId);

        if (userRole === "staff") {
          return res.json(items);
        }

        const isInvited = await storage.isInvitedToDinner(userId);
        const filtered = isInvited
          ? items
          : items.filter(
              (item) =>
                !item.activity1.toLowerCase().includes("company dinner"),
            );

        const userCaseStudies = await storage.getUserCaseStudies(
          userId,
          eventId,
        );
        const longCase = userCaseStudies.find((cs) => cs.type === "Long Case");
        const shortCase = userCaseStudies.find(
          (cs) => cs.type === "Short Case",
        );

        const personalized = filtered.map((item) => {
          const activity = item.activity1.toLowerCase();
          if (activity.includes("long case") && longCase?.room) {
            return {
              ...item,
              location: `${longCase.room} — ${longCase.company}`,
            };
          }
          if (activity.includes("short case") && shortCase?.room) {
            return {
              ...item,
              location: `${shortCase.room} — ${shortCase.company}`,
            };
          }
          return item;
        });

        return res.json(personalized);
      } catch (error) {
        console.error("Get timetable error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.get(
    "/api/support-contacts",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const contacts = await storage.getSupportContacts();
        return res.json(contacts);
      } catch (error) {
        console.error("Get support contacts error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.get(
    "/api/case-studies",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).userId;
        const eventId = await resolveEventId(req);
        if (!eventId) return res.json([]);
        const caseStudies = await storage.getUserCaseStudiesWithStatus(
          userId,
          eventId,
        );
        return res.json(caseStudies);
      } catch (error) {
        console.error("Get case studies error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.get(
    "/api/case-studies/all",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const userRole = (req as any).userRole;
        if (userRole !== "staff" && userRole !== "admin") {
          return res.status(403).json({ message: "Staff only" });
        }
        const eventId = await resolveEventId(req);
        if (!eventId) return res.json([]);
        const caseStudies = await storage.getAllCaseStudies(eventId);
        return res.json(caseStudies);
      } catch (error) {
        console.error("Get all case studies error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.get(
    "/api/case-studies/:id/attendees",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const userRole = (req as any).userRole;
        if (userRole !== "staff" && userRole !== "admin") {
          return res.status(403).json({ message: "Staff only" });
        }
        const eventId = await resolveEventId(req);
        if (!eventId) return res.json([]);
        const caseStudy = (await storage.getAllCaseStudies(eventId)).find(
          (item) => item.id === asParam(req.params.id),
        );
        if (!caseStudy)
          return res
            .status(404)
            .json({ message: "Case study not found for this event" });
        const attendees = await storage.getCaseStudyAttendees(caseStudy.id);
        return res.json(attendees);
      } catch (error) {
        console.error("Get case study attendees error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.post(
    "/api/case-studies/:id/check-in",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const userRole = (req as any).userRole;
        if (userRole !== "staff" && userRole !== "admin") {
          return res.status(403).json({ message: "Staff only" });
        }
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(400).json({
            success: false,
            message: "No event is currently selected",
          });
        const actor = await storage.getUserById((req as any).userId);
        const recordOutcome = (statusCode: number) =>
          storage.logAuditAction(
            actor?.id || (req as any).userId,
            actor?.email || "unknown",
            "case_study_qr_check_in",
            asParam(req.params.id),
            "case_study",
            {
              eventId,
              eventOutcome: statusCode >= 400 ? "failed" : "recorded",
              statusCode,
            },
          );
        const selectedCaseStudy = (
          await storage.getAllCaseStudies(eventId)
        ).find((item) => item.id === asParam(req.params.id));
        if (!selectedCaseStudy) await recordOutcome(404);
        if (!selectedCaseStudy)
          return res.status(404).json({
            success: false,
            message: "Case study not found for this event",
          });
        const { qrCodeValue } = req.body;
        if (!qrCodeValue) {
          await recordOutcome(400);
          return res
            .status(400)
            .json({ success: false, message: "QR code value is required" });
        }

        const user = await storage.getUserByQRCode(qrCodeValue, eventId);
        if (!user) {
          await recordOutcome(404);
          return res.status(404).json({
            success: false,
            message:
              "This QR code is not an attendee QR for the selected event",
          });
        }
        if (user.role !== "attendee" || user.eventId !== eventId) {
          await recordOutcome(400);
          return res.status(400).json({
            success: false,
            message: "Only attendees can be checked in to case studies",
          });
        }
        try {
          const result = await storage.checkInUserCaseStudy(
            user.id,
            selectedCaseStudy.id,
            eventId,
          );
          if (result.alreadyCheckedIn) {
            await recordOutcome(200);
            return res.json({
              success: false,
              alreadyCheckedIn: true,
              user: { id: user.id, name: user.name, email: user.email },
              message: `${user.name} is already checked in for this case study`,
            });
          }
          await recordOutcome(200);
          return res.json({
            success: true,
            user: { id: user.id, name: user.name, email: user.email },
            message: `${user.name} checked in for case study`,
          });
        } catch (err: any) {
          if (err.message === "NOT_ASSIGNED") {
            await recordOutcome(200);
            return res.json({
              success: false,
              notAssigned: true,
              message: `${user.name} is not assigned to ${selectedCaseStudy.title}`,
            });
          }
          throw err;
        }
      } catch (error) {
        console.error("Case study check-in error:", error);
        return res
          .status(500)
          .json({ success: false, message: "Internal server error" });
      }
    },
  );

  app.post(
    "/api/case-studies/:id/manual-check-in",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const userRole = (req as any).userRole;
        if (userRole !== "staff" && userRole !== "admin") {
          return res.status(403).json({ message: "Staff only" });
        }
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(400).json({
            success: false,
            message: "No event is currently selected",
          });
        const caseStudy = (await storage.getAllCaseStudies(eventId)).find(
          (item) => item.id === asParam(req.params.id),
        );
        if (!caseStudy)
          return res.status(404).json({
            success: false,
            message: "Case study not found for this event",
          });
        const { userId } = req.body;
        if (!userId) {
          return res
            .status(400)
            .json({ success: false, message: "User ID is required" });
        }
        const user = await storage.getUserById(userId);
        if (!user) {
          return res
            .status(404)
            .json({ success: false, message: "Attendee not found" });
        }
        if (user.role !== "attendee" || user.eventId !== eventId) {
          return res.status(404).json({
            success: false,
            message: "Attendee is not registered for the selected event",
          });
        }
        try {
          const result = await storage.checkInUserCaseStudy(
            user.id,
            caseStudy.id,
            eventId,
          );
          if (result.alreadyCheckedIn) {
            return res.json({
              success: false,
              alreadyCheckedIn: true,
              user: { id: user.id, name: user.name, email: user.email },
              message: `${user.name} is already checked in for this case study`,
            });
          }
          return res.json({
            success: true,
            user: { id: user.id, name: user.name, email: user.email },
            message: `${user.name} checked in for case study`,
          });
        } catch (err: any) {
          if (err.message === "NOT_ASSIGNED") {
            return res.json({
              success: false,
              notAssigned: true,
              message: `${user.name} is not assigned to this case study`,
            });
          }
          throw err;
        }
      } catch (error) {
        console.error("Case study manual check-in error:", error);
        return res
          .status(500)
          .json({ success: false, message: "Internal server error" });
      }
    },
  );

  app.delete(
    "/api/case-studies/:id/attendees/:userId",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const userRole = (req as any).userRole;
        if (userRole !== "staff" && userRole !== "admin") {
          return res.status(403).json({ message: "Staff only" });
        }
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(400).json({
            success: false,
            message: "No event is currently selected",
          });
        const caseStudy = (await storage.getAllCaseStudies(eventId)).find(
          (item) => item.id === asParam(req.params.id),
        );
        const attendee = await storage.getUserById(asParam(req.params.userId));
        if (
          !caseStudy ||
          !attendee ||
          attendee.role !== "attendee" ||
          attendee.eventId !== eventId
        ) {
          return res.status(404).json({
            success: false,
            message: "Case study attendee not found for this event",
          });
        }
        await storage.resetCaseStudyCheckIn(attendee.id, caseStudy.id);
        return res.json({
          success: true,
          message: "Attendee check-in has been reset",
        });
      } catch (error) {
        console.error("Remove case study attendee error:", error);
        return res
          .status(500)
          .json({ success: false, message: "Internal server error" });
      }
    },
  );

  app.get(
    "/api/attendees/search",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const userRole = (req as any).userRole;
        if (userRole !== "staff" && userRole !== "admin") {
          return res.status(403).json({ message: "Staff only" });
        }
        const query = (req.query.q as string) || "";
        if (query.length < 2) {
          return res.json([]);
        }
        const eventId = await resolveEventId(req);
        if (!eventId) return res.json([]);
        const results = await storage.searchAttendees(query, eventId);
        return res.json(results);
      } catch (error) {
        console.error("Search attendees error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.get(
    "/api/saved-sessions",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).userId;
        const eventId = await resolveEventId(req);
        if (!eventId) return res.json([]);
        const savedIds = await storage.getSavedSessions(userId, eventId);
        return res.json(savedIds);
      } catch (error) {
        console.error("Get saved sessions error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.post(
    "/api/saved-sessions",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).userId;
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res
            .status(400)
            .json({ message: "No event is currently selected" });
        const { sessionId } = req.body;

        if (!sessionId) {
          return res.status(400).json({ message: "Session ID is required" });
        }

        const session = (await storage.getSessions(eventId)).find(
          (item) => item.id === sessionId,
        );
        if (!session)
          return res
            .status(404)
            .json({ message: "Session not found for this event" });
        await storage.saveSession(userId, session.id);
        return res.json({ success: true });
      } catch (error) {
        console.error("Save session error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.delete(
    "/api/saved-sessions/:sessionId",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).userId;
        const sessionId = req.params.sessionId as string;
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res
            .status(400)
            .json({ message: "No event is currently selected" });

        const session = (await storage.getSessions(eventId)).find(
          (item) => item.id === sessionId,
        );
        if (!session)
          return res
            .status(404)
            .json({ message: "Session not found for this event" });
        await storage.unsaveSession(userId, session.id);
        return res.json({ success: true });
      } catch (error) {
        console.error("Unsave session error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.get(
    "/api/companies",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const eventId = await resolveEventId(req);
        if (!eventId) return res.json([]);
        const companies = await storage.getCompanies(eventId);
        return res.json(companies);
      } catch (error) {
        console.error("Get companies error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.get(
    "/api/companies/:id",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const id = req.params.id as string;
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(404).json({ message: "Company not found" });
        const company = await storage.getCompanyById(id);

        if (!company || company.eventId !== eventId) {
          return res.status(404).json({ message: "Company not found" });
        }

        return res.json(company);
      } catch (error) {
        console.error("Get company error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  // ─── Admin Middleware ────────────────────────────────────────────────────────
  // Staff and admins may view attendee/check-in data. Attendees must not be
  // able to use an authenticated session to enumerate other registrants.
  async function staffMiddleware(req: Request, res: Response, next: Function) {
    await authMiddleware(req, res, () => {
      const userRole = (req as any).userRole;
      if (userRole !== "staff" && userRole !== "admin") {
        return res.status(403).json({ message: "Staff access required" });
      }
      next();
    });
  }

  // adminMiddleware delegates to authMiddleware (which verifies user existence in the DB)
  // so that deleted admin accounts' tokens are immediately rejected, then checks role.
  async function adminMiddleware(req: Request, res: Response, next: Function) {
    await authMiddleware(req, res, () => {
      if ((req as any).userRole !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }
      next();
    });
  }

  // ─── Admin: Image Upload ─────────────────────────────────────────────────────
  // Accepts a base64 data URI and stores the compressed image inline in PostgreSQL.
  app.post(
    "/api/admin/upload-image",
    adminMiddleware,
    adminWriteRateLimit,
    async (req: Request, res: Response) => {
      try {
        const { dataUri } = req.body;
        if (!dataUri || typeof dataUri !== "string") {
          return res.status(400).json({ message: "dataUri is required" });
        }

        const match = dataUri.match(/^data:([^;]+);base64,(.+)$/s);
        if (!match) {
          return res.status(400).json({
            message: "Invalid image data — expected data:image/...;base64,...",
          });
        }
        const [, , base64Data] = match;

        // Store the compressed image inline in PostgreSQL. This keeps the Railway
        // deployment self-contained and avoids a second storage service.
        // Cap at 1 MB of base64 data (~750 KB binary) to prevent database bloat.
        // The client compresses to 800 px / 80 % JPEG so typical uploads are well under 200 KB.
        const INLINE_MAX_BYTES = 1_048_576; // 1 MB
        if (base64Data.length > INLINE_MAX_BYTES) {
          return res.status(413).json({
            message:
              "Image too large to store without cloud storage — configure hosted image storage to upload images larger than 1 MB.",
          });
        }
        return res.json({ url: dataUri, stored: "inline" });
      } catch (error) {
        console.error("Upload image error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  // ─── Admin: Stats ────────────────────────────────────────────────────────────
  app.get(
    "/api/admin/security-log",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { eventId, forbidden } = await resolveAdminReportScope(req);
        if (forbidden) {
          return res.status(403).json({
            message: "You cannot access reports for another event",
          });
        }
        const loginEvents = await storage.getLoginEvents(300, eventId);
        return res.json({ loginEvents });
      } catch (error) {
        console.error("Security log error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  // ─── Helper: resolve the only event a request is allowed to operate on ───────
  // Attendees, staff, and event-scoped admins are always constrained to their
  // own event. Global admins can explicitly manage another event through the
  // event picker. Client-provided IDs are never trusted alone.
  function requestedEventId(req: Request): string | undefined {
    const fromQuery = (req.query.eventId || req.query.event_id) as
      | string
      | undefined;
    const fromBody = req.body?.eventId as string | undefined;
    if (fromQuery && fromBody && fromQuery !== fromBody) return undefined;
    const requested = fromQuery || fromBody;
    return typeof requested === "string" && requested.trim()
      ? requested.trim()
      : undefined;
  }

  async function resolveAdminReportScope(req: Request): Promise<{
    eventId?: string;
    forbidden: boolean;
  }> {
    const requester = await storage.getUserById((req as any).userId);
    const requested = requestedEventId(req);
    if (!requester || requester.role !== "admin") {
      return { forbidden: true };
    }
    if (requester.eventId && requested && requester.eventId !== requested) {
      return { forbidden: true };
    }
    // Global admins may intentionally request an unscoped report. Event-scoped
    // admins can never widen their report beyond their own event.
    return {
      eventId: requested || requester.eventId || undefined,
      forbidden: false,
    };
  }

  async function resolveEventId(req: Request): Promise<string | undefined> {
    const requestedId = requestedEventId(req);
    const requester = await storage.getUserById((req as any).userId);
    if (!requester) return undefined;

    if (requester.role === "attendee") {
      return requester.eventId || undefined;
    }

    if (requester.role === "staff") {
      if (!requester.eventId) return undefined;
      return requestedId && requestedId !== requester.eventId
        ? undefined
        : requester.eventId;
    }
    if (requester.eventId) {
      return requestedId && requestedId !== requester.eventId
        ? undefined
        : requester.eventId;
    }
    if (!requestedId) return undefined;
    const requested = await storage.getEventById(requestedId);
    return requested?.id;
  }

  app.get(
    "/api/admin/stats",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const eventId = await resolveEventId(req);
        const stats = await storage.getAdminStats(eventId);
        return res.json(stats);
      } catch (error) {
        console.error("Admin stats error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  // ─── Admin: Users ────────────────────────────────────────────────────────────
  app.get(
    "/api/admin/users",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const eventId = await resolveEventId(req);
        if (!eventId) return res.json([]);
        const users = await storage.getAllUsers(eventId);
        const attendeeIds = users
          .filter((user) => user.role === "attendee")
          .map((user) => user.id);
        const invitationStatuses =
          await storage.getEventInvitationOutboxStatuses(eventId, attendeeIds);
        return res.json(
          users.map((user) =>
            safeAdminUser(
              user,
              invitationStatuses.get(user.id)?.status ?? null,
            ),
          ),
        );
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.get(
    "/api/admin/users/:id/case-studies",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const eventId = await resolveEventId(req);
        const user = await storage.getUserById(asParam(req.params.id));
        if (
          !eventId ||
          !user ||
          user.role !== "attendee" ||
          user.eventId !== eventId
        ) {
          return res
            .status(404)
            .json({ message: "Attendee not found for the selected event" });
        }
        const [caseStudies, assigned] = await Promise.all([
          storage.getAllCaseStudies(eventId),
          storage.getUserCaseStudies(user.id, eventId),
        ]);
        const assignedIds = new Set(assigned.map((caseStudy) => caseStudy.id));
        return res.json(
          caseStudies.map((caseStudy) => ({
            ...caseStudy,
            assigned: assignedIds.has(caseStudy.id),
          })),
        );
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.post(
    "/api/admin/users/:id/case-studies/bulk-assign",
    adminMiddleware,
    adminWriteRateLimit,
    async (req: Request, res: Response) => {
      try {
        const adminId = (req as any).userId;
        const eventId = await resolveEventId(req);
        const user = await storage.getUserById(asParam(req.params.id));
        const caseStudyIds: string[] = Array.isArray(req.body?.caseStudyIds)
          ? [
              ...new Set<string>(
                req.body.caseStudyIds.filter(
                  (id: unknown): id is string => typeof id === "string",
                ),
              ),
            ]
          : [];
        if (!eventId)
          return res.status(400).json({
            message: "Select a valid event before assigning case studies",
          });
        if (!user || user.role !== "attendee" || user.eventId !== eventId) {
          return res
            .status(404)
            .json({ message: "Attendee not found for the selected event" });
        }
        if (caseStudyIds.length === 0)
          return res
            .status(400)
            .json({ message: "Select at least one case study" });
        if (caseStudyIds.length > 100)
          return res
            .status(400)
            .json({ message: "Select no more than 100 case studies at once" });

        const allowed = new Set(
          (await storage.getAllCaseStudies(eventId)).map(
            (caseStudy) => caseStudy.id,
          ),
        );
        const invalidIds = caseStudyIds.filter((id) => !allowed.has(id));
        if (invalidIds.length > 0) {
          return res.status(400).json({
            message:
              "One or more case studies do not belong to the selected event",
          });
        }

        const results = [];
        for (const caseStudyId of caseStudyIds) {
          const [result] = await storage.bulkAssignCaseStudies(
            [user.id],
            caseStudyId,
          );
          results.push({ caseStudyId, ...result });
        }
        const created = results.filter(
          (result) => result.status === "created",
        ).length;
        const skipped = results.filter(
          (result) => result.status === "skipped",
        ).length;
        const failed = results.filter(
          (result) => result.status === "error",
        ).length;
        const admin = await storage.getUserById(adminId);
        await storage.logAuditAction(
          adminId,
          admin?.email || "unknown",
          "assign_user_case_studies",
          user.id,
          "user",
          { userId: user.id, caseStudyIds, created, skipped, failed, eventId },
        );
        return res.json({ created, skipped, failed, results });
      } catch (error: any) {
        return res
          .status(500)
          .json({ message: error?.message || "Internal server error" });
      }
    },
  );

  app.post(
    "/api/admin/users",
    adminMiddleware,
    adminWriteRateLimit,
    async (req: Request, res: Response) => {
      try {
        const adminId = (req as any).userId;
        const parsed = adminUserInputSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            message: formatZodMessage(parsed.error),
            issues: parsed.error.flatten().fieldErrors,
          });
        }
        const { name, role } = parsed.data;
        const email = normalizeAuthEmail(parsed.data.email);
        const resolvedEventId = await resolveEventId(req);
        if (!resolvedEventId) {
          return res
            .status(400)
            .json({ message: "Select a valid event before creating a user" });
        }
        const sendDuplicateUserConflict = async (): Promise<boolean> => {
          const existing = await storage.getUserByEmailAndEvent(
            email,
            resolvedEventId,
          );
          if (!existing) return false;
          const existingEvent = existing.eventId
            ? await storage.getEventById(existing.eventId)
            : undefined;
          const accountType =
            existing.role === "attendee" ? "attendee" : existing.role;
          const scope = existingEvent
            ? ` for ${existingEvent.name} (${existingEvent.year})`
            : " as the global administrator";
          res.status(409).json({
            message: `Cannot add this ${role} account: this email is already registered as a ${accountType}${scope}. Edit the existing account or use a different email.`,
          });
          return true;
        };

        if (await sendDuplicateUserConflict()) return;

        let user;
        try {
          user = await storage.createUserAdmin(
            email,
            name,
            role,
            null,
            resolvedEventId,
          );
        } catch (error) {
          // The pre-insert lookup and the event-scoped unique index can race.
          // Re-read the winner so concurrent invitations get the same actionable
          // conflict as a duplicate found by the lookup above.
          if (isPgUniqueViolation(error)) {
            if (await sendDuplicateUserConflict()) return;
          }
          throw error;
        }
        const event = await storage.getEventById(resolvedEventId);
        const eventInvitation =
          user.role === "attendee" && event
            ? await sendEventInvitationsForEvent(event, [user])
            : { attempted: 0, sent: 0, failed: 0, deferred: 0 };
        const outboxStatus =
          user.role === "attendee"
            ? await storage.getEventInvitationOutboxStatus(
                resolvedEventId,
                user.id,
              )
            : null;
        const rawInvitationStatus =
          eventInvitation.sent > 0
            ? "sent"
            : eventInvitation.deferred > 0
              ? "deferred"
              : eventInvitation.failed > 0
                ? "failed"
                : (outboxStatus?.status ??
                  (eventInvitation.attempted > 0
                    ? "queued"
                    : "not_applicable"));
        const eventInvitationStatus =
          rawInvitationStatus === "pending" ||
          rawInvitationStatus === "processing"
            ? "queued"
            : rawInvitationStatus;
        const eventInvitationDeferred = eventInvitationStatus === "deferred";
        const admin = await storage.getUserById(adminId);
        await storage.logAuditAction(
          adminId,
          admin?.email || "unknown",
          "create_user",
          user.id,
          "user",
          {
            name: user.name,
            email: user.email,
            role: user.role,
            eventId: user.eventId,
          },
        );
        return res.status(201).json({
          ...safeAdminUser(user, eventInvitationStatus),
          eventInvitationSent: eventInvitationStatus === "sent",
          eventInvitationDeferred,
          eventInvitationStatus,
          eventInvitationQueuedCount:
            eventInvitationStatus === "queued" ? 1 : 0,
        });
      } catch (error) {
        console.error("Admin create user error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.put(
    "/api/admin/users/:id",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const adminId = (req as any).userId;
        const id = asParam(req.params.id);
        const eventId = await resolveEventId(req);
        const targetUser = await storage.getUserById(id);
        if (
          !targetUser ||
          (targetUser.eventId !== null && targetUser.eventId !== eventId)
        ) {
          return res
            .status(404)
            .json({ message: "User not found for the selected event" });
        }
        if (
          targetUser.role === "admin" &&
          normalizeAuthEmail(targetUser.email) === PROTECTED_ADMIN_EMAIL
        ) {
          return res.status(403).json({
            message: "The primary admin account cannot be edited.",
          });
        }
        const parsed = adminUserUpdateSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            message: formatZodMessage(parsed.error),
            issues: parsed.error.flatten().fieldErrors,
          });
        }
        const { name, role, password } = parsed.data;
        const email =
          parsed.data.email === undefined
            ? undefined
            : normalizeAuthEmail(parsed.data.email);
        if (targetUser.eventId === null && role === "attendee") {
          return res.status(400).json({
            message: "Global admin accounts cannot become attendees",
          });
        }
        if (
          targetUser.eventId === null &&
          role !== undefined &&
          role !== "admin"
        ) {
          return res.status(400).json({
            message: "Global admin accounts must remain administrators",
          });
        }
        if (
          targetUser.eventId !== null &&
          role !== undefined &&
          role !== targetUser.role &&
          (targetUser.role === "attendee" || role === "attendee")
        ) {
          return res.status(400).json({
            message:
              "Create a separate event staff or admin account instead of changing an attendee role",
          });
        }
        if (targetUser.eventId === null && targetUser.role === "staff") {
          return res.status(409).json({
            message:
              "This legacy staff account is not assigned to an event. Create an event-scoped staff account instead.",
          });
        }
        // Event-scoped staff/admin accounts retain their existing event scope
        // when their name or email is edited.
        if (email) {
          const existing = await storage.getUserByEmailAndEvent(
            email,
            targetUser.eventId ?? undefined,
          );
          if (existing && existing.id !== id) {
            return res.status(409).json({
              message:
                "This email is already registered in the target account scope",
            });
          }
        }
        const updateData: {
          name?: string;
          email?: string;
          role?: string;
          passwordHash?: string;
        } = {};
        if (name !== undefined) updateData.name = name;
        if (email !== undefined) updateData.email = email;
        if (role !== undefined) updateData.role = role;
        if (password !== undefined) {
          if (await storage.isPasswordReused(id, password)) {
            return res.status(400).json({ message: PASSWORD_REUSE_MESSAGE });
          }
        }
        if (password !== undefined) {
          updateData.passwordHash = await bcrypt.hash(password, 10);
        }
        if (Object.keys(updateData).length === 0) {
          return res.status(400).json({ message: "No user fields to update" });
        }
        const user = await storage.updateUser(id, updateData);
        if (password !== undefined) {
          await notifyPasswordChanged(id);
        }
        const admin = await storage.getUserById(adminId);
        await storage.logAuditAction(
          adminId,
          admin?.email || "unknown",
          "update_user",
          id,
          "user",
          {
            fields: Object.keys(updateData).filter((k) => k !== "passwordHash"),
            eventId: targetUser.eventId,
          },
        );
        const invitationStatus =
          user.eventId && user.role === "attendee"
            ? await storage.getEventInvitationOutboxStatus(
                user.eventId,
                user.id,
              )
            : null;
        return res.json(safeAdminUser(user, invitationStatus?.status ?? null));
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.delete(
    "/api/admin/users/all",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const adminId = (req as any).userId;
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res
            .status(400)
            .json({ message: "Select a valid event before deleting users" });
        await storage.deleteAllNonAdminUsers(eventId);
        const admin = await storage.getUserById(adminId);
        await storage.logAuditAction(
          adminId,
          admin?.email || "unknown",
          "delete_all_users",
          undefined,
          "user",
          { eventId },
        );
        return res.json({ success: true });
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  // ─── Admin: GDPR data export ─────────────────────────────────────────────────
  app.get(
    "/api/admin/users/:id/export",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const userId = asParam(req.params.id);
        const eventId = await resolveEventId(req);
        const targetUser = await storage.getUserById(userId);
        const belongsToSelectedScope =
          targetUser?.eventId === eventId ||
          (targetUser?.eventId === null && targetUser.role === "admin");
        if (!targetUser || !belongsToSelectedScope) {
          return res
            .status(404)
            .json({ message: "User not found for the selected event" });
        }
        const data = await storage.getUserExportData(userId);
        const adminId = (req as any).userId;
        const admin = await storage.getUserById(adminId);
        await storage.logAuditAction(
          adminId,
          admin?.email || "unknown",
          "export_user_data",
          userId,
          "user",
          { eventId },
        );
        const filename = `user-export-${data.profile?.email?.replace(/[^a-z0-9]/gi, "_") || asParam(req.params.id)}.json`;
        res.setHeader("Content-Type", "application/json");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`,
        );
        return res.json(data);
      } catch (error: any) {
        if (error.message === "User not found")
          return res.status(404).json({ message: "User not found" });
        console.error("User export error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.post(
    "/api/admin/users/:id/email-export",
    adminMiddleware,
    adminWriteRateLimit,
    async (req: Request, res: Response) => {
      try {
        const userId = asParam(req.params.id);
        const eventId = await resolveEventId(req);
        const targetUser = await storage.getUserById(userId);
        const belongsToSelectedScope =
          targetUser?.eventId === eventId ||
          (targetUser?.eventId === null && targetUser.role === "admin");
        if (!targetUser || !belongsToSelectedScope) {
          return res
            .status(404)
            .json({ message: "User not found for the selected event" });
        }
        if (!gmailTransporter) {
          return res.status(503).json({
            message:
              "Email delivery is not configured. Please contact your administrator.",
          });
        }
        if (targetUser.email.trim().toLowerCase().endsWith(".test")) {
          return res.status(400).json({
            message: "Test-domain addresses are not deliverable",
          });
        }

        const exportData = await storage.getUserExportData(userId);
        const filename = `user-export-${targetUser.email.replace(/[^a-z0-9]/gi, "_")}.json`;
        await gmailTransporter.sendMail({
          from: `"Stress Congress App" <${process.env.GMAIL_USER}>`,
          to: targetUser.email,
          subject: "Your personal data export — Stress Congress App",
          html: GDPR_DATA_EXPORT_HTML(targetUser.name),
          attachments: [
            {
              filename,
              content: JSON.stringify(exportData, null, 2),
              contentType: "application/json",
            },
          ],
        });

        const adminId = (req as any).userId;
        const admin = await storage.getUserById(adminId);
        await storage.logAuditAction(
          adminId,
          admin?.email || "unknown",
          "email_user_export",
          userId,
          "user",
          { eventId, delivery: "accepted" },
        );
        console.log("[GDPR] Export attachment sent successfully.");
        return res.json({ success: true, email: targetUser.email });
      } catch (error: any) {
        if (error.message === "User not found")
          return res.status(404).json({ message: "User not found" });
        console.error("Email user export error:", error);
        return res
          .status(500)
          .json({ message: error.message || "Could not email user export" });
      }
    },
  );

  app.delete(
    "/api/admin/users/:id",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const adminId = (req as any).userId;
        const id = asParam(req.params.id);
        const eventId = await resolveEventId(req);
        const targetUser = await storage.getUserById(id);
        if (!targetUser)
          return res.status(404).json({ message: "User not found" });
        // Attendees and staff are event-scoped. Admin accounts remain
        // protected below and cannot be deleted.
        if (targetUser.eventId !== null && targetUser.eventId !== eventId)
          return res
            .status(404)
            .json({ message: "User not found for the selected event" });
        if (targetUser.eventId === null && targetUser.role === "staff") {
          return res.status(409).json({
            message:
              "This legacy staff account is not assigned to an event. Create an event-scoped staff account before deleting it.",
          });
        }
        if (targetUser.role === "admin")
          return res
            .status(403)
            .json({ message: "Admin accounts cannot be deleted." });
        await storage.deleteUser(id);
        const admin = await storage.getUserById(adminId);
        await storage.logAuditAction(
          adminId,
          admin?.email || "unknown",
          "delete_user",
          id,
          "user",
          {
            name: targetUser?.name,
            email: targetUser?.email,
            eventId: targetUser.eventId,
          },
        );
        return res.json({ success: true });
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  // ─── Admin: Speakers ─────────────────────────────────────────────────────────
  app.get(
    "/api/admin/speakers",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const eventId = await resolveEventId(req);
        if (!eventId) return res.json([]);
        const speakers = await storage.getSpeakers(eventId);
        return res.json(speakers);
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.post(
    "/api/admin/speakers",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        if (!req.body.name)
          return res.status(400).json({ message: "Name is required" });
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(400).json({
            message: "Select a valid event before creating a speaker",
          });
        const speaker = await storage.createSpeaker({ ...req.body, eventId });
        return res.json(speaker);
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.put(
    "/api/admin/speakers/reorder",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { items } = req.body;
        if (!Array.isArray(items) || items.length === 0)
          return res.status(400).json({ message: "items array required" });

        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(400).json({
            message: "Select a valid event before reordering speakers",
          });

        const speakers = await storage.getSpeakers(eventId);
        const allowedIds = new Set(speakers.map((speaker) => speaker.id));
        const submittedIds = new Set<string>();
        const invalid = items.some(
          (item: { id?: string; sortOrder?: number }) => {
            if (
              !item.id ||
              !allowedIds.has(item.id) ||
              typeof item.sortOrder !== "number" ||
              !Number.isInteger(item.sortOrder) ||
              item.sortOrder < 0 ||
              submittedIds.has(item.id)
            ) {
              return true;
            }
            submittedIds.add(item.id);
            return false;
          },
        );

        if (invalid || submittedIds.size !== speakers.length)
          return res.status(400).json({
            message: "Submit every speaker in the selected event exactly once",
          });

        const sortOrders = items
          .map((item: { sortOrder: number }) => item.sortOrder)
          .sort((a, b) => a - b);
        if (sortOrders.some((sortOrder, index) => sortOrder !== index))
          return res.status(400).json({
            message: "Speaker positions must be consecutive starting at zero",
          });

        await storage.reorderSpeakers(items, eventId);
        return res.json({ success: true });
      } catch (error) {
        console.error("Reorder speakers error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.put(
    "/api/admin/speakers/:id",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res
            .status(400)
            .json({ message: "Select a valid event before editing a speaker" });
        const existing = (await storage.getSpeakers(eventId)).find(
          (item) => item.id === asParam(req.params.id),
        );
        if (!existing)
          return res
            .status(404)
            .json({ message: "Speaker not found for the selected event" });
        const speaker = await storage.updateSpeaker(existing.id, req.body);
        return res.json(speaker);
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.delete(
    "/api/admin/speakers/all",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res
            .status(400)
            .json({ message: "Select a valid event before deleting speakers" });
        await storage.deleteAllSpeakers(eventId);
        return res.json({ success: true });
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.delete(
    "/api/admin/speakers/:id",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(400).json({
            message: "Select a valid event before deleting a speaker",
          });
        const existing = (await storage.getSpeakers(eventId)).find(
          (item) => item.id === asParam(req.params.id),
        );
        if (!existing)
          return res
            .status(404)
            .json({ message: "Speaker not found for the selected event" });
        await storage.deleteSpeaker(existing.id);
        return res.json({ success: true });
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  // ─── Admin: Companies ────────────────────────────────────────────────────────
  app.get(
    "/api/admin/companies",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const eventId = await resolveEventId(req);
        if (!eventId) return res.json([]);
        const companies = await storage.getCompanies(eventId);
        return res.json(companies);
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.post(
    "/api/admin/companies",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        if (!req.body.name || !req.body.category)
          return res
            .status(400)
            .json({ message: "Name and category are required" });
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(400).json({
            message: "Select a valid event before creating a company",
          });
        const company = await storage.createCompany({ ...req.body, eventId });
        return res.json(company);
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.put(
    "/api/admin/companies/reorder",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { items } = req.body;
        if (!Array.isArray(items))
          return res.status(400).json({ message: "items array required" });
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(400).json({
            message: "Select a valid event before reordering companies",
          });
        const allowedIds = new Set(
          (await storage.getCompanies(eventId)).map((item) => item.id),
        );
        if (
          items.some(
            (item: { id?: string; sortOrder?: number }) =>
              !item.id ||
              !allowedIds.has(item.id) ||
              !Number.isInteger(item.sortOrder),
          )
        ) {
          return res.status(400).json({
            message:
              "One or more company positions are invalid for the selected event",
          });
        }
        await storage.reorderCompanies(items);
        return res.json({ success: true });
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.put(
    "/api/admin/companies/:id",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res
            .status(400)
            .json({ message: "Select a valid event before editing a company" });
        const existing = (await storage.getCompanies(eventId)).find(
          (item) => item.id === asParam(req.params.id),
        );
        if (!existing)
          return res
            .status(404)
            .json({ message: "Company not found for the selected event" });
        const company = await storage.updateCompany(existing.id, req.body);
        return res.json(company);
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.delete(
    "/api/admin/events/all",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const events = await storage.getEvents();
        const admin = await storage.getUserById((req as any).userId);
        for (const event of events) {
          await storage.logAuditAction(
            admin?.id || (req as any).userId,
            admin?.email || "unknown",
            "delete_event",
            event.id,
            "event",
            {
              eventId: event.id,
              eventName: event.name,
              eventYear: event.year,
              eventStatus: event.status,
              deleteAll: true,
            },
          );
        }
        await storage.deleteAllEvents();
        return res.json({ success: true });
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.delete(
    "/api/admin/companies/all",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(400).json({
            message: "Select a valid event before deleting companies",
          });
        await storage.deleteAllCompanies(eventId);
        return res.json({ success: true });
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.delete(
    "/api/admin/companies/:id",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(400).json({
            message: "Select a valid event before deleting a company",
          });
        const existing = (await storage.getCompanies(eventId)).find(
          (item) => item.id === asParam(req.params.id),
        );
        if (!existing)
          return res
            .status(404)
            .json({ message: "Company not found for the selected event" });
        await storage.deleteCompany(existing.id);
        return res.json({ success: true });
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  // ─── Admin: Timetable ────────────────────────────────────────────────────────
  app.get(
    "/api/admin/timetable",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const eventId = await resolveEventId(req);
        if (!eventId) return res.json([]);
        const items = await storage.getTimetableItems(eventId);
        return res.json(items);
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.post(
    "/api/admin/timetable",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        if (!req.body.time || !req.body.activity1 || !req.body.duration) {
          return res
            .status(400)
            .json({ message: "Time, activity, and duration are required" });
        }
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(400).json({
            message: "Select a valid event before creating a timetable item",
          });
        const item = await storage.createTimetableItem({
          ...req.body,
          eventId,
        });
        return res.json(item);
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.put(
    "/api/admin/timetable/reorder",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { items } = req.body;
        if (!Array.isArray(items))
          return res.status(400).json({ message: "items array required" });
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(400).json({
            message: "Select a valid event before reordering timetable items",
          });
        const allowedIds = new Set(
          (await storage.getTimetableItems(eventId)).map((item) => item.id),
        );
        if (
          items.some(
            (item: { id?: string; sortOrder?: number }) =>
              !item.id ||
              !allowedIds.has(item.id) ||
              !Number.isInteger(item.sortOrder),
          )
        ) {
          return res.status(400).json({
            message:
              "One or more timetable positions are invalid for the selected event",
          });
        }
        await storage.reorderTimetableItems(items);
        return res.json({ success: true });
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.delete(
    "/api/admin/timetable/all",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(400).json({
            message: "Select a valid event before deleting timetable items",
          });
        await storage.deleteAllTimetableItems(eventId);
        return res.json({ success: true });
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.put(
    "/api/admin/timetable/:id",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(400).json({
            message: "Select a valid event before editing a timetable item",
          });
        const existing = (await storage.getTimetableItems(eventId)).find(
          (item) => item.id === asParam(req.params.id),
        );
        if (!existing)
          return res.status(404).json({
            message: "Timetable item not found for the selected event",
          });
        const item = await storage.updateTimetableItem(existing.id, req.body);
        return res.json(item);
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.delete(
    "/api/admin/timetable/:id",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(400).json({
            message: "Select a valid event before deleting a timetable item",
          });
        const existing = (await storage.getTimetableItems(eventId)).find(
          (item) => item.id === asParam(req.params.id),
        );
        if (!existing)
          return res.status(404).json({
            message: "Timetable item not found for the selected event",
          });
        await storage.deleteTimetableItem(existing.id);
        return res.json({ success: true });
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  // ─── Admin: Case Studies ─────────────────────────────────────────────────────
  app.get(
    "/api/admin/case-studies",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const eventId = await resolveEventId(req);
        if (!eventId) return res.json([]);
        const caseStudies = await storage.getAllCaseStudies(eventId);
        return res.json(caseStudies);
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.post(
    "/api/admin/case-studies",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { caseId, company, title, type, duration } = req.body;
        if (!caseId || !company || !title || !type || !duration) {
          return res.status(400).json({
            message: "caseId, company, title, type, and duration are required",
          });
        }
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(400).json({
            message: "Select a valid event before creating a case study",
          });
        const cs = await storage.createCaseStudy({ ...req.body, eventId });
        return res.json(cs);
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.put(
    "/api/admin/case-studies/reorder",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { items } = req.body;
        if (!Array.isArray(items))
          return res.status(400).json({ message: "items array required" });
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(400).json({
            message: "Select a valid event before reordering case studies",
          });
        const allowedIds = new Set(
          (await storage.getAllCaseStudies(eventId)).map((item) => item.id),
        );
        if (
          items.some(
            (item: { id?: string; sortOrder?: number }) =>
              !item.id ||
              !allowedIds.has(item.id) ||
              !Number.isInteger(item.sortOrder),
          )
        ) {
          return res.status(400).json({
            message:
              "One or more case study positions are invalid for the selected event",
          });
        }
        await storage.reorderCaseStudies(items);
        return res.json({ success: true });
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.delete(
    "/api/admin/case-studies/all",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(400).json({
            message: "Select a valid event before deleting case studies",
          });
        await storage.deleteAllCaseStudies(eventId);
        return res.json({ success: true });
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.put(
    "/api/admin/case-studies/:id",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(400).json({
            message: "Select a valid event before editing a case study",
          });
        const existing = (await storage.getAllCaseStudies(eventId)).find(
          (item) => item.id === asParam(req.params.id),
        );
        if (!existing)
          return res
            .status(404)
            .json({ message: "Case study not found for the selected event" });
        const cs = await storage.updateCaseStudy(existing.id, req.body);
        const adminId = (req as any).userId;
        const admin = await storage.getUserById(adminId);
        await storage.logAuditAction(
          adminId,
          admin?.email || "unknown",
          "update_case_study",
          existing.id,
          "case_study",
          { eventId, fields: Object.keys(req.body ?? {}) },
        );
        return res.json(cs);
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.delete(
    "/api/admin/case-studies/:id",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(400).json({
            message: "Select a valid event before deleting a case study",
          });
        const existing = (await storage.getAllCaseStudies(eventId)).find(
          (item) => item.id === asParam(req.params.id),
        );
        if (!existing)
          return res
            .status(404)
            .json({ message: "Case study not found for the selected event" });
        await storage.deleteCaseStudy(existing.id);
        const adminId = (req as any).userId;
        const admin = await storage.getUserById(adminId);
        await storage.logAuditAction(
          adminId,
          admin?.email || "unknown",
          "delete_case_study",
          existing.id,
          "case_study",
          { eventId },
        );
        return res.json({ success: true });
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.get(
    "/api/admin/case-studies/:id/attendees",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(400).json({
            message: "Select a valid event before viewing assignments",
          });
        const caseStudy = (await storage.getAllCaseStudies(eventId)).find(
          (item) => item.id === asParam(req.params.id),
        );
        if (!caseStudy)
          return res
            .status(404)
            .json({ message: "Case study not found for the selected event" });
        const attendees = await storage.getCaseStudyAttendees(caseStudy.id);
        return res.json(attendees);
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.post(
    "/api/admin/case-studies/:id/assign",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const adminId = (req as any).userId;
        const { userId } = req.body;
        if (!userId)
          return res.status(400).json({ message: "userId is required" });
        const caseStudyId = asParam(req.params.id);
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(400).json({
            message: "Select a valid event before assigning an attendee",
          });
        const caseStudy = (await storage.getAllCaseStudies(eventId)).find(
          (item) => item.id === caseStudyId,
        );
        const targetUser = await storage.getUserById(userId);
        if (
          !caseStudy ||
          !targetUser ||
          targetUser.role !== "attendee" ||
          targetUser.eventId !== eventId
        ) {
          return res.status(404).json({
            message: "Attendee or case study not found for the selected event",
          });
        }
        await storage.assignCaseStudy(targetUser.id, caseStudy.id);
        const admin = await storage.getUserById(adminId);
        await storage.logAuditAction(
          adminId,
          admin?.email || "unknown",
          "assign_case_study",
          caseStudy.id,
          "case_study",
          { userId, userName: targetUser.name },
        );
        return res.json({ success: true });
      } catch (error: any) {
        if (error.message === "ALREADY_ASSIGNED")
          return res.status(409).json({ message: "User already assigned" });
        if (error.message === CASE_STUDY_FULL_ERROR)
          return res.status(409).json({ message: CASE_STUDY_FULL_MESSAGE });
        return res
          .status(500)
          .json({ message: error.message || "Internal server error" });
      }
    },
  );

  app.post(
    "/api/admin/case-studies/:id/bulk-assign",
    adminMiddleware,
    adminWriteRateLimit,
    async (req: Request, res: Response) => {
      try {
        const adminId = (req as any).userId;
        const caseStudyId = asParam(req.params.id);
        const userIds = Array.isArray(req.body?.userIds)
          ? req.body.userIds.filter((id: unknown) => typeof id === "string")
          : [];
        if (userIds.length === 0)
          return res
            .status(400)
            .json({ message: "Select at least one attendee" });
        if (userIds.length > 150)
          return res.status(400).json({
            message: "A maximum of 150 attendees can be assigned at once",
          });

        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(400).json({
            message: "Select a valid event before assigning attendees",
          });
        const caseStudy = (await storage.getAllCaseStudies(eventId)).find(
          (item) => item.id === caseStudyId,
        );
        if (!caseStudy)
          return res
            .status(404)
            .json({ message: "Case study not found for the selected event" });

        const uniqueUserIds = [...new Set<string>(userIds)];
        const validUserIds: string[] = [];
        const rejected: {
          userId: string;
          status: "error";
          message: string;
        }[] = [];
        for (const userId of uniqueUserIds) {
          const user = await storage.getUserById(userId);
          if (!user || user.role !== "attendee" || user.eventId !== eventId) {
            rejected.push({
              userId,
              status: "error",
              message: "Attendee does not belong to the selected event",
            });
          } else {
            validUserIds.push(userId);
          }
        }

        const assigned = await storage.bulkAssignCaseStudies(
          validUserIds,
          caseStudy.id,
        );
        const results = [...assigned, ...rejected];
        const created = results.filter(
          (result) => result.status === "created",
        ).length;
        const skipped = results.filter(
          (result) => result.status === "skipped",
        ).length;
        const failed = results.filter(
          (result) => result.status === "error",
        ).length;

        const admin = await storage.getUserById(adminId);
        await storage.logAuditAction(
          adminId,
          admin?.email || "unknown",
          "bulk_assign_case_study",
          caseStudy.id,
          "case_study",
          {
            requested: uniqueUserIds.length,
            created,
            skipped,
            failed,
            eventId,
          },
        );
        return res.json({ created, skipped, failed, results });
      } catch (error: any) {
        return res
          .status(500)
          .json({ message: error?.message || "Internal server error" });
      }
    },
  );

  app.post(
    "/api/admin/case-studies/:id/bulk-assign-emails",
    adminMiddleware,
    adminWriteRateLimit,
    async (req: Request, res: Response) => {
      try {
        const adminId = (req as any).userId;
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(400).json({
            message: "Select a valid event before assigning attendees",
          });

        const caseStudyId = asParam(req.params.id);
        const caseStudy = (await storage.getAllCaseStudies(eventId)).find(
          (item) => item.id === caseStudyId,
        );
        if (!caseStudy)
          return res
            .status(404)
            .json({ message: "Case study not found for the selected event" });

        const rawEmails: unknown[] = Array.isArray(req.body?.emails)
          ? req.body.emails
          : typeof req.body?.emailsText === "string"
            ? req.body.emailsText.split(/[\s,;]+/)
            : [];
        const inputEmails = rawEmails
          .filter(
            (email: unknown): email is string => typeof email === "string",
          )
          .map((email: string) =>
            email
              .trim()
              .toLowerCase()
              .replace(/^[\uFEFF"'(<]+|["')>]+$/g, ""),
          )
          .filter(Boolean);
        if (inputEmails.length === 0)
          return res
            .status(400)
            .json({ message: "Add at least one attendee email address" });
        if (inputEmails.length > 500)
          return res.status(400).json({
            message: "A maximum of 500 email addresses can be assigned at once",
          });

        const results: {
          email: string;
          status:
            | "assigned"
            | "already_assigned"
            | "missing"
            | "invalid"
            | "error";
          message: string;
        }[] = [];
        const uniqueEmails = [...new Set(inputEmails)];
        const validUsers: { email: string; id: string }[] = [];
        for (const email of uniqueEmails) {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            results.push({
              email,
              status: "invalid",
              message: "Invalid email address",
            });
            continue;
          }
          const user = await storage.getUserByEmailAndEvent(email, eventId);
          if (!user || user.role !== "attendee") {
            results.push({
              email,
              status: "missing",
              message: "No registered attendee found in this event",
            });
            continue;
          }
          validUsers.push({ email, id: user.id });
        }

        const assigned = await storage.bulkAssignCaseStudies(
          validUsers.map((user) => user.id),
          caseStudy.id,
        );
        for (const result of assigned) {
          const user = validUsers.find(
            (candidate) => candidate.id === result.userId,
          );
          if (!user) continue;
          results.push({
            email: user.email,
            status:
              result.status === "created"
                ? "assigned"
                : result.status === "skipped"
                  ? "already_assigned"
                  : "error",
            message: result.message,
          });
        }
        const duplicateCount = inputEmails.length - uniqueEmails.length;
        const created = results.filter(
          (result) => result.status === "assigned",
        ).length;
        const skipped = results.filter(
          (result) => result.status === "already_assigned",
        ).length;
        const missing = results.filter(
          (result) => result.status === "missing",
        ).length;
        const invalid = results.filter(
          (result) => result.status === "invalid",
        ).length;
        const failed = results.filter(
          (result) => result.status === "error",
        ).length;
        const admin = await storage.getUserById(adminId);
        await storage.logAuditAction(
          adminId,
          admin?.email || "unknown",
          "bulk_assign_case_study_by_email",
          caseStudy.id,
          "case_study",
          {
            eventId,
            requested: inputEmails.length,
            unique: uniqueEmails.length,
            created,
            skipped,
            missing,
            invalid,
            failed,
          },
        );
        return res.json({
          created,
          skipped,
          missing,
          invalid,
          failed,
          duplicates: duplicateCount,
          missingEmails: results
            .filter((result) => result.status === "missing")
            .map((result) => result.email),
          invalidEmails: results
            .filter((result) => result.status === "invalid")
            .map((result) => result.email),
          results,
        });
      } catch (error: any) {
        return res
          .status(500)
          .json({ message: error?.message || "Internal server error" });
      }
    },
  );

  app.post(
    "/api/admin/case-studies/:id/bulk-unassign",
    adminMiddleware,
    adminWriteRateLimit,
    async (req: Request, res: Response) => {
      try {
        const adminId = (req as any).userId;
        const caseStudyId = asParam(req.params.id);
        const userIds = Array.isArray(req.body?.userIds)
          ? req.body.userIds.filter((id: unknown) => typeof id === "string")
          : [];
        if (userIds.length === 0)
          return res
            .status(400)
            .json({ message: "Select at least one attendee" });
        if (userIds.length > 150)
          return res.status(400).json({
            message: "A maximum of 150 attendees can be removed at once",
          });

        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(400).json({
            message: "Select a valid event before removing assignments",
          });
        const caseStudy = (await storage.getAllCaseStudies(eventId)).find(
          (item) => item.id === caseStudyId,
        );
        if (!caseStudy)
          return res
            .status(404)
            .json({ message: "Case study not found for the selected event" });

        const assignedIds = new Set(
          (await storage.getCaseStudyAttendees(caseStudy.id)).map(
            (attendee) => attendee.id,
          ),
        );
        const results: {
          userId: string;
          status: "removed" | "skipped" | "error";
          message: string;
        }[] = [];
        for (const userId of [...new Set<string>(userIds)]) {
          const user = await storage.getUserById(userId);
          if (!user || user.role !== "attendee" || user.eventId !== eventId) {
            results.push({
              userId,
              status: "error",
              message: "Attendee does not belong to the selected event",
            });
          } else if (!assignedIds.has(userId)) {
            results.push({
              userId,
              status: "skipped",
              message: "Attendee is not assigned",
            });
          } else {
            await storage.unassignCaseStudy(userId, caseStudy.id);
            results.push({
              userId,
              status: "removed",
              message: "Assignment removed",
            });
          }
        }

        const removed = results.filter(
          (result) => result.status === "removed",
        ).length;
        const skipped = results.filter(
          (result) => result.status === "skipped",
        ).length;
        const failed = results.filter(
          (result) => result.status === "error",
        ).length;
        const admin = await storage.getUserById(adminId);
        await storage.logAuditAction(
          adminId,
          admin?.email || "unknown",
          "bulk_unassign_case_study",
          caseStudy.id,
          "case_study",
          {
            requested: userIds.length,
            removed,
            skipped,
            failed,
            eventId,
          },
        );
        return res.json({ removed, skipped, failed, results });
      } catch (error: any) {
        return res
          .status(500)
          .json({ message: error?.message || "Internal server error" });
      }
    },
  );

  app.delete(
    "/api/admin/case-studies/:id/assign/:userId",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const adminId = (req as any).userId;
        const caseStudyId = asParam(req.params.id);
        const targetUserId = asParam(req.params.userId);
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(400).json({
            message: "Select a valid event before removing an assignment",
          });
        const caseStudy = (await storage.getAllCaseStudies(eventId)).find(
          (item) => item.id === caseStudyId,
        );
        const targetUser = await storage.getUserById(targetUserId);
        if (!caseStudy || !targetUser || targetUser.eventId !== eventId) {
          return res.status(404).json({
            message: "Attendee or case study not found for the selected event",
          });
        }
        await storage.unassignCaseStudy(targetUser.id, caseStudy.id);
        const admin = await storage.getUserById(adminId);
        await storage.logAuditAction(
          adminId,
          admin?.email || "unknown",
          "unassign_case_study",
          caseStudy.id,
          "case_study",
          { userId: targetUser.id, userName: targetUser.name },
        );
        return res.json({ success: true });
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.get(
    "/api/admin/attendees",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const eventId = await resolveEventId(req);
        if (!eventId) return res.json([]);
        const users = await storage.getAllUsers(eventId);
        return res.json(
          users
            .filter(
              (user) => user.role === "attendee" && user.eventId === eventId,
            )
            .map((user) => ({
              id: user.id,
              name: user.name,
              email: user.email,
              photoUrl: user.photoUrl,
            })),
        );
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.get(
    "/api/admin/attendees/search",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const query = (req.query.q as string) || "";
        if (query.length < 2) return res.json([]);
        const eventId = await resolveEventId(req);
        if (!eventId) return res.json([]);
        const attendees = await storage.searchAttendees(query, eventId);
        return res.json(attendees);
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  // ─── Admin: Events ───────────────────────────────────────────────────────────
  app.get(
    "/api/admin/events",
    adminMiddleware,
    async (_req: Request, res: Response) => {
      try {
        const events = await storage.getEvents();
        return res.json(events);
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.get(
    "/api/admin/audit-events",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const reportScope = await resolveAdminReportScope(req);
        if (reportScope.forbidden) {
          return res.status(403).json({
            message: "You cannot access reports for another event",
          });
        }

        const [events, auditScopes] = await Promise.all([
          storage.getEvents(),
          storage.getAuditEventScopes(),
        ]);
        const scopes = new Map(
          events.map((event) => [
            event.id,
            {
              id: event.id,
              name: event.name,
              year: event.year,
              status: event.status,
              deleted: false,
              createdAt: event.createdAt.toISOString(),
            },
          ]),
        );

        for (const scope of auditScopes) {
          if (!scopes.has(scope.id)) {
            scopes.set(scope.id, {
              ...scope,
              createdAt: scope.createdAt.toISOString(),
              status: "deleted",
              deleted: true,
            });
          }
        }

        const visibleScopes = [...scopes.values()]
          .filter(
            (scope) => !reportScope.eventId || scope.id === reportScope.eventId,
          )
          .sort(
            (a, b) =>
              new Date(b.createdAt).getTime() -
                new Date(a.createdAt).getTime() ||
              b.year - a.year ||
              a.name.localeCompare(b.name),
          );

        // Keep this endpoint strictly read-only. The existing event list stays
        // mutation-safe and never receives deleted event IDs.
        return res.json(visibleScopes);
      } catch (error) {
        console.error("Audit event scopes error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.post(
    "/api/admin/events",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { name, year } = req.body;
        if (!name || !year)
          return res
            .status(400)
            .json({ message: "Name and year are required" });
        const startDateError = validateEventStartDate(
          req.body?.startDate,
          year,
        );
        if (startDateError) {
          return res.status(400).json({ message: startDateError });
        }
        const scheduleError = validateScheduleHours(
          req.body.scheduleStart,
          req.body.scheduleEnd,
        );
        if (scheduleError)
          return res.status(400).json({ message: scheduleError });
        const event = await storage.createEvent(req.body);
        const admin = await storage.getUserById((req as any).userId);
        await storage.logAuditAction(
          admin?.id || (req as any).userId,
          admin?.email || "unknown",
          "create_event",
          event.id,
          "event",
          {
            eventId: event.id,
            eventName: event.name,
            eventYear: event.year,
            eventStatus: event.status,
          },
        );
        return res.json(event);
      } catch (error) {
        console.error("Create event error:", error);
        return res.status(500).json({
          message:
            error instanceof Error
              ? `Event creation failed: ${error.message}`
              : "Event creation failed. Please try again.",
        });
      }
    },
  );

  app.put(
    "/api/admin/events/:id",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const parsed = adminEventUpdateSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            message: formatAdminEventUpdateMessage(parsed.error),
            issues: parsed.error.flatten().fieldErrors,
          });
        }
        const updateData = { ...parsed.data };
        if (Object.keys(updateData).length === 0) {
          return res.status(400).json({ message: "No event fields to update" });
        }
        const eventId = asParam(req.params.id);
        const existingEvent = await storage.getEventById(eventId);
        if (!existingEvent) {
          return res.status(404).json({ message: "Event not found" });
        }
        if (
          Object.prototype.hasOwnProperty.call(updateData, "startDate") &&
          updateData.startDate
        ) {
          const startDateError = validateEventStartDate(
            updateData.startDate,
            updateData.year ?? existingEvent.year,
          );
          if (startDateError) {
            return res.status(400).json({ message: startDateError });
          }
        }
        if (
          Object.prototype.hasOwnProperty.call(updateData, "scheduleStart") ||
          Object.prototype.hasOwnProperty.call(updateData, "scheduleEnd")
        ) {
          const scheduleError = validateScheduleHours(
            updateData.scheduleStart,
            updateData.scheduleEnd,
          );
          if (scheduleError)
            return res.status(400).json({ message: scheduleError });
        }
        // Keep the public date badge aligned when an admin edits the primary
        // event date through the Event Details form.
        if (
          Object.prototype.hasOwnProperty.call(updateData, "startDate") &&
          !Object.prototype.hasOwnProperty.call(updateData, "displayDate")
        ) {
          updateData.displayDate = updateData.startDate;
        }
        const event = await storage.updateEvent(eventId, updateData);
        const admin = await storage.getUserById((req as any).userId);
        await storage.logAuditAction(
          admin?.id || (req as any).userId,
          admin?.email || "unknown",
          "update_event",
          event.id,
          "event",
          {
            eventId: event.id,
            eventName: event.name,
            eventYear: event.year,
            changedFields: Object.keys(updateData),
          },
        );
        return res.json(event);
      } catch (error) {
        console.error("Update event error:", error);
        return res.status(500).json({
          message:
            error instanceof Error
              ? `Event update failed: ${error.message}`
              : "Event update failed. Please try again.",
        });
      }
    },
  );

  app.post(
    "/api/admin/events/:id/publish-updates",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const eventId = asParam(req.params.id);
        const existingEvent = await storage.getEventById(eventId);
        if (!existingEvent) {
          return res.status(404).json({ message: "Event not found" });
        }
        if (existingEvent.status !== "published") {
          return res.status(400).json({
            message: "Only the live event can publish attendee updates",
          });
        }

        const event = await storage.publishEventUpdates(eventId);
        if (!event) return res.status(404).json({ message: "Event not found" });

        // Publishing the event is always required. Notifications are an
        // explicit opt-in so an admin cannot unexpectedly message attendees.
        const notifyAudience =
          req.body?.notifyAudience === true ||
          req.body?.notifyStaffAndAttendees === true ||
          req.body?.notify === true;
        let notificationId: string | null = null;
        let pushDelivery = { attempted: 0, sent: 0, failed: 0 };

        if (notifyAudience) {
          const notification = await storage.createNotification(
            "A little conference update",
            "We’ve updated the conference app with the latest information. The changes will refresh automatically, and your login is saved.",
            "announcement",
            undefined,
            event.id,
          );
          notificationId = notification.id;

          const tokens = await storage.getAttendeePushTokens(
            event.id,
            null,
            "announcement",
          );
          pushDelivery = await sendExpoPushNotifications(
            tokens,
            notification.title,
            notification.message,
            {
              screen: "Notifications",
              notificationId: notification.id,
              type: "live_update",
            },
          );
        }

        const adminId = (req as any).userId;
        const admin = await storage.getUserById(adminId);
        await storage.logAuditAction(
          adminId,
          admin?.email || "unknown",
          "publish_event_updates",
          event.id,
          "event",
          {
            eventId: event.id,
            notifyAudience,
            notificationOutcome: notifyAudience ? "sent" : "skipped",
            notificationId,
            pushAttempted: pushDelivery.attempted,
            pushSent: pushDelivery.sent,
            pushFailed: pushDelivery.failed,
          },
        );

        return res.json({
          ...event,
          notificationId,
          notificationsSent: notifyAudience,
          notificationOutcome: notifyAudience ? "sent" : "skipped",
          pushCount: pushDelivery.sent,
          pushAttempted: pushDelivery.attempted,
          pushFailed: pushDelivery.failed,
        });
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.delete(
    "/api/admin/events/:id",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const eventId = asParam(req.params.id);
        const event = await storage.getEventById(eventId);
        if (!event) return res.status(404).json({ message: "Event not found" });
        const admin = await storage.getUserById((req as any).userId);
        await storage.logAuditAction(
          admin?.id || (req as any).userId,
          admin?.email || "unknown",
          "delete_event",
          event.id,
          "event",
          {
            eventId: event.id,
            eventName: event.name,
            eventYear: event.year,
            eventStatus: event.status,
          },
        );
        await storage.deleteEvent(eventId);
        return res.json({ success: true });
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.post(
    "/api/admin/events/:id/publish",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const eventId = asParam(req.params.id);
        const existingEvent = await storage.getEventById(eventId);
        if (!existingEvent) {
          return res.status(404).json({ message: "Event not found" });
        }
        const startDateError = validateEventStartDate(
          existingEvent.startDate,
          existingEvent.year,
        );
        if (startDateError) {
          return res.status(400).json({
            code: "INVALID_START_DATE",
            message: startDateError,
          });
        }
        const starterSlots = await storage.getStarterTimetableItems(eventId);
        if (
          starterSlots.length > 0 &&
          req.body?.confirmStarterTimetable !== true
        ) {
          return res.status(409).json({
            code: "STARTER_TIMETABLE",
            message:
              "This event still contains starter timetable slots. Edit or delete them before publishing, or explicitly confirm that the template is intentional.",
            starterSlots,
          });
        }

        const event = await storage.publishEvent(eventId);
        if (!event) return res.status(404).json({ message: "Event not found" });

        const admin = await storage.getUserById((req as any).userId);
        await storage.logAuditAction(
          admin?.id || (req as any).userId,
          admin?.email || "unknown",
          "publish_event",
          event.id,
          "event",
          { eventId: event.id, previousStatus: existingEvent.status },
        );
        const eventLiveEmail =
          existingEvent.status === "published"
            ? { attempted: 0, sent: 0, failed: 0 }
            : await sendEventLiveAnnouncements(event);
        const eventInvitation = {
          attempted: 0,
          sent: 0,
          failed: 0,
          deferred: 0,
        };
        return res.json({ ...event, eventLiveEmail, eventInvitation });
      } catch (error) {
        console.error("Publish event error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.post(
    "/api/admin/events/:id/attendees/:userId/retry-invitation",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const admin = await storage.getUserById((req as any).userId);
        const eventId = asParam(req.params.id);
        const userId = asParam(req.params.userId);
        if (!admin || admin.role !== "admin") {
          return res.status(403).json({ message: "Admin access required" });
        }
        if (admin.eventId && admin.eventId !== eventId) {
          return res.status(403).json({
            message: "You cannot retry invitations for another event",
          });
        }
        const [event, user] = await Promise.all([
          storage.getEventById(eventId),
          storage.getUserById(userId),
        ]);
        if (!event) return res.status(404).json({ message: "Event not found" });
        if (!user || user.eventId !== eventId || user.role !== "attendee") {
          return res.status(404).json({ message: "Event attendee not found" });
        }
        if (event.status !== "published") {
          return res
            .status(409)
            .json({ message: "The event must be live to send invitations" });
        }
        if (user.eventInvitationSentAt) {
          return res
            .status(409)
            .json({ message: "This invitation has already been sent" });
        }
        const previous = await storage.getEventInvitationOutboxStatus(
          eventId,
          userId,
        );
        if (!previous) {
          return res.status(409).json({
            message:
              "Only invitations for attendees added while the event is live can be retried",
          });
        }
        if (user.email.trim().toLowerCase().endsWith(".test")) {
          return res
            .status(400)
            .json({ message: "Test-domain addresses are not deliverable" });
        }
        if (previous?.status === "sent") {
          return res
            .status(409)
            .json({ message: "This invitation has already been sent" });
        }
        if (
          previous &&
          !["failed", "needs_review", "skipped"].includes(previous.status)
        ) {
          return res
            .status(409)
            .json({ message: "This invitation is already queued" });
        }
        const queued = await storage.enqueueEventEmail(
          event,
          user,
          "attendee_added",
          Boolean(previous),
        );
        if (!queued) {
          return res
            .status(409)
            .json({ message: "This invitation could not be queued for retry" });
        }
        return res.status(202).json({ status: "queued" });
      } catch (error) {
        console.error("Retry event invitation error:", error);
        return res
          .status(500)
          .json({ message: "Unable to queue invitation retry" });
      }
    },
  );

  app.post(
    "/api/admin/events/:id/archive",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const eventId = asParam(req.params.id);
        const event = await storage.archiveEvent(eventId);
        const admin = await storage.getUserById((req as any).userId);
        await storage.logAuditAction(
          admin?.id || (req as any).userId,
          admin?.email || "unknown",
          "archive_event",
          eventId,
          "event",
          { eventId },
        );
        return res.json(event);
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  // ─── Admin: Notifications ────────────────────────────────────────────────────
  app.get(
    "/api/admin/notifications",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const eventId = await resolveEventId(req);
        if (!eventId) {
          return res.status(400).json({
            message: "Select a valid event before viewing notifications",
          });
        }
        const notifications = await storage.getNotifications(
          undefined,
          eventId,
        );
        return res.json(notifications);
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.post(
    "/api/admin/notifications",
    adminMiddleware,
    adminWriteRateLimit,
    async (req: Request, res: Response) => {
      try {
        const adminId = (req as any).userId;
        const { title, message, type, targetRole } = req.body;
        if (type === "event_reminder") {
          return res.status(400).json({
            message: "Countdown notifications are no longer supported",
          });
        }
        if (!title || !message)
          return res
            .status(400)
            .json({ message: "Title and message are required" });
        const allowedTargetRoles = [
          null,
          undefined,
          "all",
          "attendee",
          "staff",
        ];
        if (!allowedTargetRoles.includes(targetRole)) {
          return res
            .status(400)
            .json({ message: "Target must be everyone, attendees, or staff" });
        }
        const normalisedTargetRole = targetRole === "all" ? null : targetRole;
        const eventId = await resolveEventId(req);
        if (!eventId) {
          return res.status(400).json({
            message: "Select a valid event before publishing a notification",
          });
        }
        const notification = await storage.createNotification(
          title,
          message,
          type || "announcement",
          normalisedTargetRole,
          eventId,
        );
        const admin = await storage.getUserById(adminId);
        await storage.logAuditAction(
          adminId,
          admin?.email || "unknown",
          "publish_notification",
          notification.id,
          "notification",
          {
            title,
            targetRole: normalisedTargetRole || "all",
            eventId,
          },
        );

        // Fan out real push notifications to registered devices, respecting targetRole
        const tokens = await storage.getAttendeePushTokens(
          eventId,
          normalisedTargetRole,
          type || "announcement",
        );
        const pushDelivery = await sendExpoPushNotifications(
          tokens,
          title,
          message,
          { screen: "Notifications", notificationId: notification.id },
        );
        return res.json({
          ...notification,
          pushCount: pushDelivery.sent,
          pushAttempted: pushDelivery.attempted,
          pushFailed: pushDelivery.failed,
        });
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  // ─── Admin: Audit Log ────────────────────────────────────────────────────────
  app.get(
    "/api/admin/audit-log",
    adminMiddleware,
    async (req: Request, res: Response) => {
      try {
        const queryNumber = (value: unknown, fallback: number) => {
          const parsed = Number(value);
          return Number.isFinite(parsed) ? parsed : fallback;
        };
        const queryDate = (value: unknown) => {
          if (typeof value !== "string" || !value) return undefined;
          if (
            !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
            Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
          ) {
            return null;
          }
          return value;
        };
        const dateFrom = queryDate(req.query.dateFrom);
        const dateTo = queryDate(req.query.dateTo);
        if (dateFrom === null || dateTo === null) {
          return res
            .status(400)
            .json({ message: "Dates must use YYYY-MM-DD format" });
        }
        const eventId = requestedEventId(req) || null;
        if (!eventId) {
          return res.status(400).json({
            message: "Select an event before viewing audit history",
          });
        }
        const reportScope = await resolveAdminReportScope(req);
        if (reportScope.forbidden || reportScope.eventId !== eventId) {
          return res.status(403).json({
            message: "You cannot access reports for another event",
          });
        }
        const result = await storage.getAuditLogPage({
          search:
            typeof req.query.search === "string" ? req.query.search : undefined,
          event: eventId,
          action:
            typeof req.query.action === "string" ? req.query.action : undefined,
          outcome:
            typeof req.query.outcome === "string"
              ? req.query.outcome
              : undefined,
          dateFrom,
          dateTo,
          page: queryNumber(req.query.page, 1),
          pageSize: queryNumber(req.query.pageSize, 25),
        });
        return res.json(result);
      } catch (error) {
        console.error("Audit log error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.get(
    "/api/admin/security-log/export",
    adminMiddleware,
    async (req, res) => {
      try {
        const { eventId, forbidden } = await resolveAdminReportScope(req);
        if (forbidden) {
          return res.status(403).json({
            message: "You cannot access reports for another event",
          });
        }
        const loginEvents = await storage.getLoginEvents(5000, eventId);
        const adminId = (req as any).userId;
        const admin = await storage.getUserById(adminId);
        await storage.logAuditAction(
          adminId,
          admin?.email || "unknown",
          "export_security_log",
          undefined,
          "security_log",
          { eventId, recordCount: loginEvents.length },
        );
        return csvResponse(
          res,
          "stress-congress-security-log.csv",
          [
            "record_type",
            "email",
            "event_type",
            "requested_at",
            "status",
            "completed_at",
          ],
          [
            ...loginEvents.map((e) => [
              "login",
              e.email,
              e.eventType,
              e.createdAt,
              "",
              "",
            ]),
          ],
        );
      } catch (error) {
        console.error("Security export error:", error);
        return res
          .status(500)
          .json({ message: "Unable to export security log" });
      }
    },
  );

  app.get("/api/admin/gdpr/export", adminMiddleware, async (req, res) => {
    try {
      const { eventId, forbidden } = await resolveAdminReportScope(req);
      if (forbidden) {
        return res.status(403).json({
          message: "You cannot access reports for another event",
        });
      }
      const requests = await storage.getGdprRequests("all", eventId);
      const adminId = (req as any).userId;
      const admin = await storage.getUserById(adminId);
      await storage.logAuditAction(
        adminId,
        admin?.email || "unknown",
        "export_gdpr_history",
        undefined,
        "gdpr_request",
        { eventId, recordCount: requests.length },
      );
      return csvResponse(
        res,
        "stress-congress-gdpr-requests.csv",
        [
          "request_id",
          "event_id",
          "user_email",
          "user_name",
          "type",
          "status",
          "created_at",
          "resolved_at",
          "resolved_by",
        ],
        requests.map((r) => [
          r.id,
          r.eventId,
          r.userEmail,
          r.userName,
          r.type,
          r.status,
          r.createdAt.toISOString(),
          r.resolvedAt?.toISOString(),
          r.resolvedBy,
        ]),
      );
    } catch (error) {
      console.error("GDPR export error:", error);
      return res.status(500).json({ message: "Unable to export GDPR history" });
    }
  });

  app.get("/api/admin/audit-log/export", adminMiddleware, async (req, res) => {
    try {
      const eventId =
        typeof req.query.eventId === "string" && req.query.eventId.trim()
          ? req.query.eventId.trim()
          : null;
      if (!eventId) {
        return res.status(400).json({
          message: "Select an event before exporting audit history",
        });
      }
      const reportScope = await resolveAdminReportScope(req);
      if (reportScope.forbidden || reportScope.eventId !== eventId) {
        return res.status(403).json({
          message: "You cannot access reports for another event",
        });
      }
      const entries = await storage.getAuditLog(5000, eventId);
      const adminId = (req as any).userId;
      const admin = await storage.getUserById(adminId);
      await storage.logAuditAction(
        adminId,
        admin?.email || "unknown",
        "export_audit_log",
        undefined,
        "audit_log",
        { eventId, recordCount: entries.length },
      );
      return csvResponse(
        res,
        "stress-congress-audit-log.csv",
        [
          "timestamp",
          "actor_email",
          "action",
          "target_type",
          "target_id",
          "metadata",
        ],
        entries.map((e) => [
          e.createdAt.toISOString(),
          e.adminEmail,
          e.action,
          e.targetType,
          e.targetId,
          e.metadata,
        ]),
      );
    } catch (error) {
      console.error("Audit export error:", error);
      return res.status(500).json({ message: "Unable to export audit log" });
    }
  });

  // ─── Admin: Bulk User Import ─────────────────────────────────────────────────
  app.post(
    "/api/admin/users/import",
    adminMiddleware,
    adminWriteRateLimit,
    async (req: Request, res: Response) => {
      try {
        const adminId = (req as any).userId;
        const { rows } = req.body;
        if (!Array.isArray(rows) || rows.length === 0) {
          return res.status(400).json({ message: "No rows provided" });
        }
        if (rows.length > 5000) {
          return res
            .status(400)
            .json({ message: "Import files are limited to 5,000 rows" });
        }

        const defaultEventId = await resolveEventId(req);
        if (!defaultEventId) {
          return res.status(400).json({
            message: "Select a valid event before importing attendees",
          });
        }

        const allEvents = await storage.getEvents();
        const eventByYear = new Map<number, (typeof allEvents)[number]>();
        for (const event of allEvents) {
          if (!eventByYear.has(event.year)) eventByYear.set(event.year, event);
        }

        const validRows: {
          sourceRow: number;
          name: string;
          email: string;
          role: "attendee" | "staff" | "admin";
          eventId?: string;
        }[] = [];
        const invalidResults: {
          row: number;
          email: string;
          status: "error";
          message: string;
          eventId: string | null;
        }[] = [];

        rows.forEach((rawRow: unknown, index: number) => {
          const sourceRow = index + 2;
          if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) {
            invalidResults.push({
              row: sourceRow,
              email: "",
              status: "error",
              message: "Row must contain user fields",
              eventId: defaultEventId,
            });
            return;
          }

          const row = rawRow as Record<string, unknown>;
          const name = String(row.name ?? "").trim();
          const email = String(row.email ?? "")
            .trim()
            .toLowerCase();
          const roleValue = String(row.role ?? "attendee")
            .trim()
            .toLowerCase();
          const roleResult = importedUserRoleSchema.safeParse(roleValue);
          const baseResult = z
            .object({
              name: z
                .string()
                .min(1, "Name is required")
                .max(200, "Name is too long"),
              email: z.string().email("Enter a valid email address"),
            })
            .safeParse({ name, email });

          if (!baseResult.success || !roleResult.success) {
            const message = !baseResult.success
              ? formatZodMessage(baseResult.error)
              : "Role must be attendee, staff, or admin";
            invalidResults.push({
              row: sourceRow,
              email,
              status: "error",
              message,
              eventId: defaultEventId,
            });
            return;
          }

          let rowEventId = defaultEventId;
          const rawYear = row.event_year ?? row.eventYear ?? row.year;
          if (rawYear !== undefined && String(rawYear).trim() !== "") {
            const year = Number(String(rawYear).trim());
            const event = Number.isInteger(year)
              ? eventByYear.get(year)
              : undefined;
            if (!event) {
              invalidResults.push({
                row: sourceRow,
                email,
                status: "error",
                message: `No event exists for year ${String(rawYear).trim()}`,
                eventId: null,
              });
              return;
            }
            if (event.id !== defaultEventId) {
              invalidResults.push({
                row: sourceRow,
                email,
                status: "error",
                message: "Row event does not match the selected event",
                eventId: defaultEventId,
              });
              return;
            }
            rowEventId = event.id;
          }

          validRows.push({
            sourceRow,
            name,
            email,
            role: roleResult.data,
            eventId: rowEventId,
          });
        });

        const stored = await storage.bulkCreateUsers(validRows, defaultEventId);
        const createdUsers = (
          await Promise.all(
            stored.results
              .filter((result) => result.status === "created" && result.userId)
              .map((result) => storage.getUserById(result.userId!)),
          )
        ).filter((user): user is NonNullable<typeof user> => Boolean(user));
        const invitationsByEvent = await Promise.all(
          allEvents
            .filter((event) =>
              createdUsers.some((user) => user.eventId === event.id),
            )
            .map(async (event) => {
              const delivery = await sendEventInvitationsForEvent(
                event,
                createdUsers.filter((user) => user.eventId === event.id),
              );
              return delivery;
            }),
        );
        const eventInvitation = invitationsByEvent.reduce(
          (total, delivery) => ({
            attempted: total.attempted + delivery.attempted,
            sent: total.sent + delivery.sent,
            failed: total.failed + delivery.failed,
            deferred: total.deferred + delivery.deferred,
          }),
          { attempted: 0, sent: 0, failed: 0, deferred: 0 },
        );
        const invitationStatusesByEvent = await Promise.all(
          allEvents
            .filter((event) =>
              createdUsers.some(
                (user) => user.eventId === event.id && user.role === "attendee",
              ),
            )
            .map(async (event) => ({
              eventId: event.id,
              statuses: await storage.getEventInvitationOutboxStatuses(
                event.id,
                createdUsers
                  .filter(
                    (user) =>
                      user.eventId === event.id && user.role === "attendee",
                  )
                  .map((user) => user.id),
              ),
            })),
        );
        const queuedInvitationCount = invitationStatusesByEvent.reduce(
          (count, entry) =>
            count +
            [...entry.statuses.values()].filter(
              (status) =>
                status.status === "pending" || status.status === "processing",
            ).length,
          0,
        );
        const allInvitationStatuses = invitationStatusesByEvent.flatMap(
          (entry) =>
            [...entry.statuses.values()].map((status) => status.status),
        );
        const eventInvitationStatus = allInvitationStatuses.includes("sent")
          ? "sent"
          : queuedInvitationCount > 0
            ? "queued"
            : allInvitationStatuses.includes("failed")
              ? "failed"
              : allInvitationStatuses.includes("needs_review")
                ? "needs_review"
                : eventInvitation.deferred > 0
                  ? "deferred"
                  : eventInvitation.attempted > 0
                    ? "skipped"
                    : "not_applicable";
        const results = [...stored.results, ...invalidResults].sort(
          (a, b) => a.row - b.row,
        );
        const failed = stored.failed + invalidResults.length;
        const eventYearById = new Map(
          allEvents.map((event) => [event.id, event.year]),
        );
        const enrichedResults = results.map((result) => ({
          ...result,
          eventYear: result.eventId
            ? (eventYearById.get(result.eventId) ?? null)
            : null,
        }));
        const errors = enrichedResults
          .filter((result) => result.status === "error")
          .map(
            (result) =>
              `Row ${result.row}${result.email ? ` (${result.email})` : ""}: ${result.message}`,
          );

        const admin = await storage.getUserById(adminId);
        await storage.logAuditAction(
          adminId,
          admin?.email || "unknown",
          "import_users",
          defaultEventId,
          "event",
          {
            created: stored.created,
            skipped: stored.skipped,
            failed,
          },
        );

        return res.json({
          created: stored.created,
          skipped: stored.skipped,
          failed,
          errors,
          results: enrichedResults,
          eventInvitation: {
            ...eventInvitation,
            status: eventInvitationStatus,
            queuedCount: queuedInvitationCount,
            deferredCount: eventInvitation.deferred,
          },
        });
      } catch (error) {
        console.error("Admin user import error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  // ─── GDPR: Email helpers ──────────────────────────────────────────────────────
  async function sendGdprEmail(
    to: string,
    subject: string,
    html: string,
    attachments?: nodemailer.SendMailOptions["attachments"],
  ): Promise<void> {
    if (!gmailTransporter) {
      console.warn("[GDPR] Gmail not configured; delivery skipped.");
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          "Email delivery is not configured. Cannot process GDPR request without sending notification.",
        );
      }
      return;
    }
    if (to.trim().toLowerCase().endsWith(".test")) {
      console.info("[GDPR] Skipping test-domain email recipient.");
      return;
    }
    await gmailTransporter.sendMail({
      from: `"Stress Congress App" <${process.env.GMAIL_USER}>`,
      to,
      subject,
      html,
      attachments,
    });
    console.log("[GDPR] Email delivery completed.");
  }

  const GDPR_CONFIRM_DATA_HTML = (name: string) => `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;">
      <h2 style="color:#0c0057;">Data Request Received</h2>
      <p style="color:#444;">Hi ${name},</p>
      <p style="color:#444;">We have received your request to access your personal data. An administrator will review and send your data export within <strong>30 days</strong>, as required by GDPR.</p>
      <p style="color:#888;font-size:13px;">If you have questions, contact your event administrator.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" /><p style="color:#aaa;font-size:12px;">Stress Congress App</p>
    </div>`;

  const GDPR_CONFIRM_DELETION_HTML = (name: string) => `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;">
      <h2 style="color:#0c0057;">Account Deletion Request Received</h2>
      <p style="color:#444;">Hi ${name},</p>
      <p style="color:#444;">We have received your request to delete your account and personal data. An administrator will review and process it within <strong>30 days</strong>, as required by GDPR. You can continue using the app until your account is deleted.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" /><p style="color:#aaa;font-size:12px;">Stress Congress App</p>
    </div>`;

  const GDPR_ADMIN_ALERT_HTML = (
    adminName: string,
    userName: string,
    userEmail: string,
    type: string,
  ) => `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;">
      <h2 style="color:#0c0057;">New GDPR ${type === "data" ? "Data Access" : "Deletion"} Request</h2>
      <p style="color:#444;">Hi ${adminName},</p>
      <div style="background:#f4f3ff;border-radius:12px;padding:20px;margin:20px 0;">
        <p style="margin:0;color:#444;"><strong>Name:</strong> ${userName}</p>
        <p style="margin:8px 0 0;color:#444;"><strong>Email:</strong> ${userEmail}</p>
        <p style="margin:8px 0 0;color:#444;"><strong>Type:</strong> ${type === "data" ? "Data Access (Right of Access)" : "Account Deletion (Right to Erasure)"}</p>
      </div>
      <p style="color:#444;">Please log into the Admin Panel → GDPR Requests to process this request within 30 days.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" /><p style="color:#aaa;font-size:12px;">Stress Congress App</p>
    </div>`;

  const GDPR_DATA_EXPORT_HTML = (name: string) => `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;">
      <h2 style="color:#0c0057;">Your Personal Data Export</h2>
      <p style="color:#444;">Hi ${name}, your requested personal data export is attached to this email as a JSON file.</p>
      <p style="color:#888;font-size:13px;">Please keep this file secure. It contains personal information.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" /><p style="color:#aaa;font-size:12px;">Stress Congress App</p>
    </div>`;

  /** Sent before the deletion transaction starts — truthful ("processing") */
  const GDPR_DELETION_PROCESSING_HTML = (name: string) => `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;">
      <h2 style="color:#0c0057;">Your Account Deletion is Being Processed</h2>
      <p style="color:#444;">Hi ${name},</p>
      <p style="color:#444;">An administrator has approved your deletion request. Your account and all associated personal data are now being permanently deleted from the Stress Congress app.</p>
      <p style="color:#444;">You will receive a final confirmation once the deletion is complete. If you do not receive one within a few minutes, please contact your event administrator.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" /><p style="color:#aaa;font-size:12px;">Stress Congress App</p>
    </div>`;

  /** Sent after the deletion transaction commits — final confirmation */
  const GDPR_DELETED_HTML = (name: string) => `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;">
      <h2 style="color:#0c0057;">Account Permanently Deleted</h2>
      <p style="color:#444;">Hi ${name},</p>
      <p style="color:#444;">Your account and all associated personal data have been permanently deleted from the Stress Congress app, as per your GDPR deletion request.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" /><p style="color:#aaa;font-size:12px;">Stress Congress App</p>
    </div>`;

  // ─── GDPR: Attendee self-service ──────────────────────────────────────────────
  //
  // Ordering guarantee: confirmation email is sent BEFORE the request is persisted.
  // If email delivery fails the endpoint returns 500 and no pending request is created,
  // so the attendee can safely retry without hitting a 409.
  // Admin alerts are best-effort after the request is saved (non-blocking for the attendee).
  //
  /** Returns true if `err` is a PostgreSQL unique-constraint violation (23505) */
  function isPgUniqueViolation(err: unknown): boolean {
    return (
      typeof err === "object" && err !== null && (err as any).code === "23505"
    );
  }

  const publicDeletionSchema = z.object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email("Enter a valid email address")
      .max(320),
    reason: z.string().trim().max(2000).optional(),
  });
  const publicDeletionConfirmation =
    "If an account matches the information provided, your deletion request has been received and will be reviewed within 30 days.";

  // Deliberately returns the same response whether or not an account exists.
  // This prevents the public form from becoming an account-enumeration oracle.
  const publicDeletionHandler = async (req: Request, res: Response) => {
    const parsed = publicDeletionSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: "Enter a valid email address." });
    try {
      const activeEvent = await storage.getActiveEvent();
      const user = await storage.getUserByEmailAndEvent(
        parsed.data.email,
        activeEvent?.id,
      );
      if (user?.role === "attendee" && user.eventId) {
        try {
          await storage.createGdprRequest(
            user.id,
            user.eventId,
            user.email,
            user.name,
            "deletion",
            parsed.data.reason,
          );
        } catch (error) {
          if (!isPgUniqueViolation(error)) throw error;
          // Duplicate requests intentionally have the same generic response.
          return res.status(202).json({ message: publicDeletionConfirmation });
        }
        try {
          await storage.createNotification(
            "GDPR deletion request requires review",
            `${user.name} (${user.email}) requested permanent account deletion. Review it in Admin → GDPR Requests.`,
            "gdpr",
            "admin",
            user.eventId,
          );
        } catch (error) {
          console.error(
            "[GDPR] Failed to notify admins about public deletion request:",
            error,
          );
        }
      }
      return res.status(202).json({ message: publicDeletionConfirmation });
    } catch (error) {
      console.error("Public GDPR deletion request error:", error);
      return res
        .status(500)
        .json({ message: "Unable to process your request. Please try again." });
    }
  };
  app.post("/api/data-deletion", publicDeletionHandler);
  app.post("/api/gdpr/deletion-request", publicDeletionHandler);

  app.post(
    "/api/auth/request-data",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).userId;
        const user = await storage.getUserById(userId);
        if (!user) return res.status(404).json({ message: "User not found" });
        if (user.role !== "attendee")
          return res
            .status(403)
            .json({ message: "Only attendees can submit GDPR requests" });

        // Step 1: persist the request — the admin panel reads from the DB, so this
        // must succeed regardless of email delivery. Unique index catches duplicates.
        try {
          if (!user.eventId)
            return res.status(400).json({
              message: "Your account is not associated with an event.",
            });
          await storage.createGdprRequest(
            userId,
            user.eventId,
            user.email,
            user.name,
            "data",
          );
        } catch (e) {
          if (isPgUniqueViolation(e)) {
            return res
              .status(409)
              .json({ message: "You already have a pending data request." });
          }
          throw e;
        }

        try {
          await storage.createNotification(
            "GDPR data request requires review",
            `${user.name} (${user.email}) requested a copy of their personal data. Review it in Admin → GDPR Requests.`,
            "gdpr",
            "admin",
            user.eventId,
          );
        } catch (e) {
          console.error(
            "[GDPR] Failed to create admin data-request notification:",
            e,
          );
        }
        await storage.logAuditAction(
          userId,
          user.email,
          "gdpr_data_request_created",
          userId,
          "user",
          { eventId: user.eventId },
        );

        // Step 2: confirmation email to the user — best-effort, never blocks the response
        sendGdprEmail(
          user.email,
          "Your data request has been received",
          GDPR_CONFIRM_DATA_HTML(user.name),
        ).catch((e) =>
          console.warn("[GDPR] Confirmation email delivery failed:", e),
        );

        // Step 3: notify admins — best-effort
        storage
          .getAllUsers(user.eventId)
          .then((all) => {
            all
              .filter((u) => u.role === "admin")
              .forEach((admin) => {
                sendGdprEmail(
                  admin.email,
                  `GDPR Data Request from ${user.name}`,
                  GDPR_ADMIN_ALERT_HTML(
                    admin.name,
                    user.name,
                    user.email,
                    "data",
                  ),
                ).catch((e) =>
                  console.warn("[GDPR] Admin alert email delivery failed:", e),
                );
              });
          })
          .catch((e) =>
            console.warn("[GDPR] Could not fetch admin list for alert:", e),
          );

        return res.json({ message: "Data request submitted successfully." });
      } catch (error: any) {
        console.error("GDPR data request error:", error);
        return res
          .status(500)
          .json({ message: error.message || "Internal server error" });
      }
    },
  );

  app.post(
    "/api/auth/request-deletion",
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).userId;
        const user = await storage.getUserById(userId);
        if (!user) return res.status(404).json({ message: "User not found" });
        if (user.role !== "attendee")
          return res
            .status(403)
            .json({ message: "Only attendees can submit GDPR requests" });

        // Step 1: persist — admin panel reads from DB; must succeed before emails
        try {
          if (!user.eventId)
            return res.status(400).json({
              message: "Your account is not associated with an event.",
            });
          await storage.createGdprRequest(
            userId,
            user.eventId,
            user.email,
            user.name,
            "deletion",
          );
        } catch (e) {
          if (isPgUniqueViolation(e)) {
            return res.status(409).json({
              message: "You already have a pending deletion request.",
            });
          }
          throw e;
        }

        try {
          await storage.createNotification(
            "GDPR deletion request requires review",
            `${user.name} (${user.email}) requested permanent account deletion. Review it in Admin → GDPR Requests.`,
            "gdpr",
            "admin",
            user.eventId,
          );
        } catch (e) {
          console.error(
            "[GDPR] Failed to create admin deletion-request notification:",
            e,
          );
        }
        await storage.logAuditAction(
          userId,
          user.email,
          "gdpr_deletion_request_created",
          userId,
          "user",
          { eventId: user.eventId },
        );

        // Step 2: confirmation email to the user — best-effort
        sendGdprEmail(
          user.email,
          "Your account deletion request has been received",
          GDPR_CONFIRM_DELETION_HTML(user.name),
        ).catch((e) =>
          console.warn("[GDPR] Confirmation email delivery failed:", e),
        );

        // Step 3: notify admins — best-effort
        storage
          .getAllUsers(user.eventId)
          .then((all) => {
            all
              .filter((u) => u.role === "admin")
              .forEach((admin) => {
                sendGdprEmail(
                  admin.email,
                  `GDPR Deletion Request from ${user.name}`,
                  GDPR_ADMIN_ALERT_HTML(
                    admin.name,
                    user.name,
                    user.email,
                    "deletion",
                  ),
                ).catch((e) =>
                  console.warn("[GDPR] Admin alert email delivery failed:", e),
                );
              });
          })
          .catch((e) =>
            console.warn("[GDPR] Could not fetch admin list for alert:", e),
          );

        return res.json({
          message: "Deletion request submitted successfully.",
        });
      } catch (error: any) {
        console.error("GDPR deletion request error:", error);
        return res
          .status(500)
          .json({ message: error.message || "Internal server error" });
      }
    },
  );

  // ─── GDPR: Admin management ───────────────────────────────────────────────────
  function adminMiddlewareGdpr(req: Request, res: Response, next: Function) {
    authMiddleware(req, res, () => {
      if ((req as any).userRole !== "admin")
        return res.status(403).json({ message: "Admin access required" });
      next();
    });
  }

  app.get(
    "/api/admin/gdpr-requests/count",
    adminMiddlewareGdpr,
    async (_req: Request, res: Response) => {
      try {
        const reportScope = await resolveAdminReportScope(_req);
        if (reportScope.forbidden) {
          return res.status(403).json({
            message: "You cannot access reports for another event",
          });
        }
        const eventId = reportScope.eventId;
        if (!eventId) return res.json({ count: 0 });
        const count = await storage.getPendingGdprCount(eventId);
        return res.json({ count });
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.get(
    "/api/admin/gdpr-requests",
    adminMiddlewareGdpr,
    async (req: Request, res: Response) => {
      try {
        const status =
          typeof req.query.status === "string" ? req.query.status : "pending";
        const reportScope = await resolveAdminReportScope(req);
        if (reportScope.forbidden) {
          return res.status(403).json({
            message: "You cannot access reports for another event",
          });
        }
        const eventId = reportScope.eventId;
        if (!eventId) return res.json([]);
        const requests = await storage.getGdprRequests(status, eventId);
        return res.json(requests);
      } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  /** Thrown when a GDPR request is no longer in the expected state for an operation. Maps to HTTP 409. */
  class GdprConflictError extends Error {
    readonly statusCode = 409;
    constructor(message: string) {
      super(message);
      this.name = "GdprConflictError";
    }
  }

  /**
   * Process a single GDPR request atomically.
   *
   * Step 0 (both types): Atomically claim the request by flipping status pending→in_progress.
   *   Throws GdprConflictError (409) if already claimed/resolved by a concurrent admin action.
   *   On any subsequent failure the claim is released back to pending so admin can retry.
   *
   * Data requests:
   *   1. Claim
   *   2. Generate export (throws if user not found)
   *   3. Email export (throws in production if Gmail unconfigured)
   *   4. Conditional finalize: resolveInProgressGdprRequest (WHERE in_progress) — throws GdprConflictError if a
   *      concurrent deny raced between claim and finalize
   *
   * Deletion requests:
   *   1. Claim
   *   2. Attempt a truthful "processing" notification; delivery failure is logged but
   *      does not block the requested account deletion
   *   3. deleteUserAndResolveGdprRequest: delete user + mark approved (WHERE in_progress) + cancel sibling
   *      requests — all in one DB transaction; throws if the in_progress condition is not met
   *   4. Send final "permanently deleted" confirmation best-effort after commit
   *
   * Throws on failure; GdprConflictError signals HTTP 409.
   */
  async function processGdprApproval(
    gdprReq: {
      id: string;
      userId: string;
      userEmail: string;
      userName: string;
      type: string;
      eventId: string | null;
    },
    adminEmailOrId: string,
  ): Promise<void> {
    // Guard: never allow deletion of an admin account via GDPR
    if (gdprReq.type === "deletion") {
      const targetUser = await storage.getUserById(gdprReq.userId);
      if (targetUser?.role === "admin") {
        throw new Error("Admin accounts cannot be deleted via GDPR.");
      }
    }

    // Step 0: Claim atomically — generates a unique claimToken bound to this worker
    const claimed = await storage.claimGdprRequest(gdprReq.id);
    if (!claimed) {
      throw new GdprConflictError(
        "Request is no longer pending (already being processed or resolved by another admin).",
      );
    }
    const { claimToken } = claimed;
    let dataExportDelivered = false;

    try {
      if (gdprReq.type === "data") {
        // If the process crashed after SMTP accepted the message but before the
        // request was finalized, do not send a second copy.
        if (claimed.request.deliveryStatus === "delivered") {
          const resolved = await storage.resolveInProgressGdprRequest(
            gdprReq.id,
            claimToken,
            "approved",
            adminEmailOrId,
          );
          if (!resolved) {
            throw new GdprConflictError(
              "Claim token mismatch while finalizing the delivered export.",
            );
          }
          return;
        }

        // Mark the attempt before doing any work so failures are visible and retryable.
        await storage.markGdprDeliveryAttempt(gdprReq.id);

        // Generate the export only for this delivery attempt. It is sent as a
        // protected attachment, never included in the response or logs.
        const exportData = await storage.getUserExportData(gdprReq.userId);
        const exportJson = JSON.stringify(exportData, null, 2);
        await sendGdprEmail(
          gdprReq.userEmail,
          "Your personal data export — Stress Congress App",
          GDPR_DATA_EXPORT_HTML(gdprReq.userName),
          [
            {
              filename: "stress-congress-personal-data.json",
              content: exportJson,
              contentType: "application/json",
            },
          ],
        );
        dataExportDelivered = true;
        await storage.markGdprDeliverySuccess(gdprReq.id);

        // Conditional finalization — requires claimToken so a manual release-and-reclaim
        // by another admin cannot silently succeed; returns null → 409 if token mismatch
        const resolved = await storage.resolveInProgressGdprRequest(
          gdprReq.id,
          claimToken,
          "approved",
          adminEmailOrId,
        );
        if (!resolved) {
          throw new GdprConflictError(
            "Claim token mismatch — request was released or reclaimed. Export email already sent; admin should verify state.",
          );
        }
      } else if (gdprReq.type === "deletion") {
        // Step 1: Send a truthful "processing" notification before deletion begins
        // Email delivery must not prevent the legally requested account deletion.
        try {
          await sendGdprEmail(
            gdprReq.userEmail,
            "Your account deletion is being processed — Stress Congress App",
            GDPR_DELETION_PROCESSING_HTML(gdprReq.userName),
          );
        } catch {
          console.warn(
            "[GDPR] Deletion processing notification failed; continuing with account deletion.",
          );
        }
        // Step 2: Delete user + mark approved (WHERE in_progress AND claimToken) + cancel siblings
        // in a single DB transaction; throws if claim token mismatch
        const userExists = await storage.getUserById(gdprReq.userId);
        if (userExists) {
          await storage.deleteUserAndResolveGdprRequest(
            gdprReq.userId,
            gdprReq.id,
            adminEmailOrId,
            claimToken,
          );
        } else {
          // User already gone — just finalize with claim token check
          const resolved = await storage.resolveInProgressGdprRequest(
            gdprReq.id,
            claimToken,
            "approved",
            adminEmailOrId,
          );
          if (!resolved) {
            throw new GdprConflictError(
              "Claim token mismatch during deletion finalization.",
            );
          }
        }
        // Step 3: Send final "permanently deleted" confirmation after transaction commits (best-effort)
        sendGdprEmail(
          gdprReq.userEmail,
          "Your account has been permanently deleted — Stress Congress App",
          GDPR_DELETED_HTML(gdprReq.userName),
        ).catch((e) =>
          Promise.resolve().then(async () => {
            console.warn(
              "[GDPR] Final deletion confirmation email failed:",
              e instanceof Error ? e.name : "unknown",
            );
            try {
              await storage.logAuditAction(
                adminEmailOrId,
                adminEmailOrId,
                "gdpr_deletion_confirmation_failed",
                gdprReq.id,
                "gdpr_request",
                {
                  eventId: gdprReq.eventId,
                  email: gdprReq.userEmail,
                  error: e instanceof Error ? e.message : String(e),
                },
              );
            } catch (auditError) {
              console.error(
                "[GDPR] Could not record final confirmation failure audit:",
                auditError instanceof Error ? auditError.name : "unknown",
              );
            }
          }),
        );
      } else {
        throw new Error(`Unknown GDPR request type: ${gdprReq.type}`);
      }
    } catch (e) {
      const safeError =
        (e instanceof Error ? e.message : String(e))
          .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted]")
          .slice(0, 500) || "Delivery failed";
      if (gdprReq.type === "data" && !dataExportDelivered) {
        await storage.markGdprDeliveryFailure(gdprReq.id, safeError);
      }
      let auditWriteError: unknown;
      try {
        await storage.logAuditAction(
          adminEmailOrId,
          adminEmailOrId,
          `gdpr_${gdprReq.type}_processing_failed`,
          gdprReq.id,
          "gdpr_request",
          {
            eventId: gdprReq.eventId,
            error: safeError,
          },
        );
      } catch (error) {
        auditWriteError = error;
      }
      // Release the claim (using the bound token) so the admin can retry.
      // Skip for GdprConflictError — the token is already invalid.
      let claimReleaseError: unknown;
      if (!(e instanceof GdprConflictError)) {
        try {
          await storage.releaseGdprClaim(gdprReq.id, claimToken);
        } catch (releaseError) {
          claimReleaseError = releaseError;
          console.error(
            "[GDPR] Failed to release claim:",
            releaseError instanceof Error ? releaseError.name : "unknown",
          );
        }
      }
      throw auditWriteError || claimReleaseError || e;
    }
  }

  app.post(
    "/api/admin/gdpr-requests/approve-all",
    adminMiddlewareGdpr,
    async (req: Request, res: Response) => {
      try {
        const adminId = (req as any).userId;
        const admin = await storage.getUserById(adminId);
        const adminRef = admin?.email || adminId;
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(400).json({ message: "Event context is required" });
        const pending = await storage.getPendingGdprRequests(eventId);

        let approved = 0;
        const errors: { id: string; error: string }[] = [];

        for (const gdprReq of pending) {
          try {
            await processGdprApproval(gdprReq, adminRef);
            await storage.logAuditAction(
              adminId,
              adminRef,
              `gdpr_${gdprReq.type}_approved`,
              gdprReq.userId,
              "user",
              { eventId: gdprReq.eventId, email: gdprReq.userEmail },
            );
            approved++;
          } catch (e: any) {
            console.error(
              "GDPR approve-all failed for request:",
              e instanceof Error ? e.message : "unknown error",
            );
            errors.push({
              id: gdprReq.id,
              error:
                e instanceof Error
                  ? e.message.replace(
                      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
                      "[redacted]",
                    )
                  : "Unknown error",
            });
          }
        }

        return res.json({
          approved,
          failed: errors.length,
          errors: errors.length > 0 ? errors : undefined,
        });
      } catch (error) {
        console.error("GDPR approve-all error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.post(
    "/api/admin/gdpr-requests/:id/approve",
    adminMiddlewareGdpr,
    async (req: Request, res: Response) => {
      let requestType: "data" | "deletion" | undefined;
      try {
        const adminId = (req as any).userId;
        const id = asParam(req.params.id);
        const admin = await storage.getUserById(adminId);
        const adminRef = admin?.email || adminId;

        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(404).json({ message: "Event context is required" });
        const requests = await storage.getGdprRequests(undefined, eventId);
        const gdprReq = requests.find((r) => r.id === id);
        if (!gdprReq)
          return res.status(404).json({ message: "Request not found" });
        requestType = gdprReq.type === "deletion" ? "deletion" : "data";
        if (gdprReq.status !== "pending")
          return res
            .status(409)
            .json({ message: "Request is already resolved" });

        // Atomic — throws if any step fails; request stays pending (claim released) on non-conflict error
        await processGdprApproval(gdprReq, adminRef);
        await storage.logAuditAction(
          adminId,
          adminRef,
          `gdpr_${gdprReq.type}_approved`,
          gdprReq.userId,
          "user",
          { eventId: gdprReq.eventId, deliveryStatus: "delivered" },
        );
        return res.json({ success: true });
      } catch (error: any) {
        console.error(
          "GDPR approve error:",
          error instanceof Error ? error.message : "unknown error",
        );
        const status = error instanceof GdprConflictError ? 409 : 500;
        return res.status(status).json({
          message:
            status === 409
              ? error.message
              : requestType === "deletion"
                ? "Could not delete the account. The request remains available to retry."
                : "Could not deliver the requested data export. The request remains available to retry.",
        });
      }
    },
  );

  app.post(
    "/api/admin/gdpr-requests/:id/retry",
    adminMiddlewareGdpr,
    async (req: Request, res: Response) => {
      try {
        const adminId = (req as any).userId;
        const id = asParam(req.params.id);
        const eventId = await resolveEventId(req);
        if (!eventId) {
          return res.status(404).json({ message: "Event context is required" });
        }
        const requests = await storage.getGdprRequests("all", eventId);
        const gdprReq = requests.find((r) => r.id === id);
        if (!gdprReq)
          return res.status(404).json({ message: "Request not found" });
        if (gdprReq.type !== "data" || gdprReq.deliveryStatus !== "failed") {
          return res
            .status(409)
            .json({ message: "Only failed data exports can be retried" });
        }
        const admin = await storage.getUserById(adminId);
        await processGdprApproval(gdprReq, admin?.email || adminId);
        return res.json({ success: true });
      } catch (error: any) {
        console.error(
          "GDPR export retry failed:",
          error instanceof Error ? error.message : "unknown error",
        );
        const status = error instanceof GdprConflictError ? 409 : 500;
        return res.status(status).json({
          message:
            status === 409 ? error.message : "Could not deliver data export",
        });
      }
    },
  );

  app.post(
    "/api/admin/gdpr-requests/:id/release",
    adminMiddlewareGdpr,
    async (req: Request, res: Response) => {
      try {
        const id = asParam(req.params.id);
        // Force-release: resets a specific in_progress claim back to pending without needing
        // the claimToken (break-glass for stuck requests where the original worker is gone).
        // Safe because any live worker's conditional finalization checks claimToken and will
        // get a token-mismatch 409 if it tries to finalize after the force-release.
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(404).json({ message: "Event context is required" });
        const requests = await storage.getGdprRequests("pending", eventId);
        if (
          !requests.some(
            (request) => request.id === id && request.status === "in_progress",
          )
        ) {
          return res
            .status(404)
            .json({ message: "In-progress request not found" });
        }
        await storage.forceReleaseGdprClaim(id, eventId);
        return res.json({ success: true });
      } catch (error) {
        console.error("GDPR force-release error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  app.post(
    "/api/admin/gdpr-requests/:id/deny",
    adminMiddlewareGdpr,
    async (req: Request, res: Response) => {
      try {
        const adminId = (req as any).userId;
        const id = asParam(req.params.id);
        const admin = await storage.getUserById(adminId);
        const adminRef = admin?.email || adminId;

        // Fetch just to obtain the type for audit logging; existence check is implicit below
        const eventId = await resolveEventId(req);
        if (!eventId)
          return res.status(404).json({ message: "Event context is required" });
        const requests = await storage.getGdprRequests("all", eventId);
        const gdprReq = requests.find((r) => r.id === id);
        if (!gdprReq)
          return res.status(404).json({ message: "Request not found" });

        // Conditional transition: only succeeds if still 'pending'.
        // A concurrent claim (in_progress) or prior resolution returns null → 409.
        const denied = await storage.denyPendingGdprRequest(id, adminRef);
        if (!denied) {
          return res.status(409).json({
            message:
              "Request is no longer pending (already being processed or resolved).",
          });
        }

        await storage.logAuditAction(
          adminId,
          adminRef,
          `gdpr_${gdprReq.type}_denied`,
          gdprReq.userId,
          "user",
          { eventId: gdprReq.eventId, email: gdprReq.userEmail },
        );
        return res.json({ success: true });
      } catch (error) {
        console.error("GDPR deny error:", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    },
  );

  startEventEmailOutboxWorker();
  const httpServer = createServer(app);
  return httpServer;
}
