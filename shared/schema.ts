import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  boolean,
  timestamp,
  integer,
  uniqueIndex,
  bigserial,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const STARTER_TIMETABLE_PREFIX = "Template slot —";

export const events = pgTable("events", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  year: integer("year").notNull(),
  status: text("status").notNull().default("draft"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  scheduleStart: text("schedule_start"),
  scheduleEnd: text("schedule_end"),
  location: text("location"),
  description: text("description"),
  // Per-year theming
  logoUrl: text("logo_url"),
  logoShape: text("logo_shape").notNull().default("square"),
  logoZoom: integer("logo_zoom").notNull().default(100),
  logoOffsetX: integer("logo_offset_x").notNull().default(0),
  logoOffsetY: integer("logo_offset_y").notNull().default(0),
  primaryColor: text("primary_color").default("#0c0057"),
  accentColor: text("accent_color").default("#f78f1e"),
  gradientStart: text("gradient_start").default("#0c0057"),
  gradientEnd: text("gradient_end").default("#1a0a7a"),
  tagline: text("tagline"),
  displayDate: text("display_date"),
  showYearOnLogin: boolean("show_year_on_login").notNull().default(true),
  lastPublishedAt: timestamp("last_published_at"),
  createdAt: timestamp("created_at")
    .notNull()
    .default(sql`now()`),
});

export const users = pgTable("users", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  // Staff and attendees may use the same email in different event years. The
  // database migration enforces uniqueness per event, while global admin
  // accounts remain unique through a shared global scope.
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("attendee"),
  qrCodeValue: text("qr_code_value").notNull().unique(),
  checkedIn: boolean("checked_in").notNull().default(false),
  checkedInAt: timestamp("checked_in_at"),
  passwordHash: text("password_hash"),
  passwordVersion: integer("password_version").notNull().default(0),
  activationInvitationSentAt: timestamp("activation_invitation_sent_at"),
  eventInvitationSentAt: timestamp("event_invitation_sent_at"),
  eventId: text("event_id"), // null = global admin; set = event-scoped attendee/staff
  photoUrl: text("photo_url"),
  pushToken: text("push_token"), // Expo push token for real push notifications; null if not registered
  createdAt: timestamp("created_at")
    .notNull()
    .default(sql`now()`),
});

export const eventEmailOutbox = pgTable(
  "event_email_outbox",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    eventId: text("event_id").notNull(),
    userId: varchar("user_id").notNull(),
    kind: text("kind").notNull(),
    recipientEmail: text("recipient_email").notNull(),
    recipientName: text("recipient_name").notNull(),
    eventName: text("event_name").notNull(),
    eventYear: integer("event_year").notNull(),
    eventStartDate: text("event_start_date"),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    nextAttemptAt: timestamp("next_attempt_at")
      .notNull()
      .default(sql`now()`),
    leaseUntil: timestamp("lease_until"),
    claimToken: text("claim_token"),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    eventUserKindUnique: uniqueIndex("event_email_outbox_once").on(
      table.eventId,
      table.userId,
      table.kind,
    ),
  }),
);

export const eventEmailSendGate = pgTable("event_email_send_gate", {
  id: integer("id").primaryKey(),
  nextSendAt: timestamp("next_send_at")
    .notNull()
    .default(sql`now()`),
  leaseUntil: timestamp("lease_until"),
  leaseToken: text("lease_token"),
  circuitBreakerUntil: timestamp("circuit_breaker_until"),
});

export const eventEmailUrgentRequests = pgTable("event_email_urgent_requests", {
  token: text("token").primaryKey(),
  requestedAt: timestamp("requested_at")
    .notNull()
    .default(sql`now()`),
  leaseUntil: timestamp("lease_until").notNull(),
});

export const notificationDevices = pgTable(
  "notification_devices",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull(),
    pushToken: text("push_token"),
    pushEnabled: boolean("push_enabled").notNull().default(true),
    eventReminders: boolean("event_reminders").notNull().default(true),
    sessionAlerts: boolean("session_alerts").notNull().default(true),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    userDeviceUnique: uniqueIndex("notification_devices_user_device_unique").on(
      table.userId,
      table.deviceId,
    ),
  }),
);

export const authSessions = pgTable("auth_sessions", {
  id: varchar("id").primaryKey(),
  userId: varchar("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  deviceId: text("device_id").notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at")
    .notNull()
    .default(sql`now()`),
  lastSeenAt: timestamp("last_seen_at")
    .notNull()
    .default(sql`now()`),
  revokedAt: timestamp("revoked_at"),
});
export const sessions = pgTable("sessions", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description"),
  speakerId: varchar("speaker_id").references(() => speakers.id),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),
  location: text("location"),
  track: text("track"),
  day: integer("day").notNull().default(1),
  eventId: text("event_id"), // which event year this session belongs to
});

export const speakers = pgTable("speakers", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  title: text("title"),
  bio: text("bio"),
  photoUrl: text("photo_url"),
  company: text("company"),
  email: text("email"),
  phone: text("phone"),
  linkedin: text("linkedin"),
  sortOrder: integer("sort_order").notNull().default(0),
  eventId: text("event_id"), // which event year this speaker belongs to
});

export const savedSessions = pgTable(
  "saved_sessions",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id),
    sessionId: varchar("session_id")
      .notNull()
      .references(() => sessions.id),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    userSessionUnique: uniqueIndex("saved_sessions_user_session_unique").on(
      table.userId,
      table.sessionId,
    ),
  }),
);

export const notifications = pgTable("notifications", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  message: text("message").notNull(),
  type: text("type").notNull().default("announcement"),
  createdAt: timestamp("created_at")
    .notNull()
    .default(sql`now()`),
  targetRole: text("target_role"),
  eventId: text("event_id"), // which event year this notification belongs to
});

export const userNotifications = pgTable(
  "user_notifications",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id),
    notificationId: varchar("notification_id")
      .notNull()
      .references(() => notifications.id),
    read: boolean("read").notNull().default(false),
    dismissed: boolean("dismissed").notNull().default(false),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    userNotificationUnique: uniqueIndex(
      "user_notifications_user_notification_unique",
    ).on(table.userId, table.notificationId),
  }),
);

export const companies = pgTable("companies", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  category: text("category").notNull(),
  description: text("description"),
  logoUrl: text("logo_url"),
  websiteUrl: text("website_url"),
  sortOrder: integer("sort_order").notNull().default(0),
  eventId: text("event_id"), // which event year this company belongs to
  createdAt: timestamp("created_at")
    .notNull()
    .default(sql`now()`),
});

export const timetableItems = pgTable("timetable_items", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  time: text("time").notNull(),
  activity1: text("activity1").notNull(),
  activity2: text("activity2"),
  duration: text("duration").notNull(),
  location: text("location"),
  category: text("category").notNull().default("session"),
  sortOrder: integer("sort_order").notNull().default(0),
  eventId: text("event_id"), // which event year this slot belongs to
});

export const caseStudies = pgTable("case_studies", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  caseId: text("case_id").notNull(), // unique per event, but not globally
  company: text("company").notNull(),
  title: text("title").notNull(),
  type: text("type").notNull(),
  duration: text("duration").notNull(),
  description: text("description"),
  room: text("room"),
  sortOrder: integer("sort_order").notNull().default(0),
  eventId: text("event_id"), // which event year this case study belongs to
});

export const userCaseStudies = pgTable("user_case_studies", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: varchar("user_id")
    .notNull()
    .references(() => users.id),
  caseStudyId: varchar("case_study_id")
    .notNull()
    .references(() => caseStudies.id),
  assignedAt: timestamp("assigned_at")
    .notNull()
    .default(sql`now()`),
  checkedIn: boolean("checked_in").notNull().default(false),
  checkedInAt: timestamp("checked_in_at"),
});

export const dinnerInvites = pgTable("dinner_invites", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: varchar("user_id")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at")
    .notNull()
    .default(sql`now()`),
});

export const supportContacts = pgTable("support_contacts", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  type: text("type").notNull(),
  name: text("name"),
  email: text("email"),
  phone: text("phone"),
  description: text("description"),
  websiteUrl: text("website_url"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: varchar("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  code: text("code").notNull(),
  purpose: text("purpose").notNull().default("reset"),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").notNull().default(false),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at")
    .notNull()
    .default(sql`now()`),
});
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

export const passwordHistory = pgTable("password_history", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: varchar("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at")
    .notNull()
    .default(sql`now()`),
});
export type PasswordHistory = typeof passwordHistory.$inferSelect;

export const loginEvents = pgTable("login_events", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  email: text("email").notNull(),
  eventType: text("event_type").notNull(),
  eventId: text("event_id"),
  createdAt: timestamp("created_at")
    .notNull()
    .default(sql`now()`),
});
export type LoginEvent = typeof loginEvents.$inferSelect;

export const adminAuditLog = pgTable("admin_audit_log", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  adminId: varchar("admin_id").notNull(),
  adminEmail: text("admin_email").notNull(),
  action: text("action").notNull(), // e.g. "create_user", "delete_user"
  targetId: text("target_id"), // id of affected record
  targetType: text("target_type"), // "user", "case_study", "notification"
  metadata: text("metadata"), // JSON string with extra context
  createdAt: timestamp("created_at")
    .notNull()
    .default(sql`now()`),
});
export type AdminAuditLog = typeof adminAuditLog.$inferSelect;

export const gdprRequests = pgTable("gdpr_requests", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  eventId: varchar("event_id"),
  userEmail: text("user_email").notNull(),
  userName: text("user_name").notNull(),
  type: text("type").notNull(), // 'data' | 'deletion'
  reason: text("reason"),
  status: text("status").notNull().default("pending"), // 'pending' | 'in_progress' | 'approved' | 'denied' | 'cancelled'
  claimToken: text("claim_token"), // set when status='in_progress'; required for release/finalization
  deliveryStatus: text("delivery_status").notNull().default("not_started"), // 'not_started' | 'sending' | 'failed' | 'delivered'
  deliveryAttempts: integer("delivery_attempts").notNull().default(0),
  deliveryError: text("delivery_error"),
  createdAt: timestamp("created_at")
    .notNull()
    .default(sql`now()`),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: text("resolved_by"),
});
export type GdprRequest = typeof gdprRequests.$inferSelect;

export const insertUserSchema = createInsertSchema(users).pick({
  email: true,
  name: true,
  role: true,
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).optional(),
});

export const checkInSchema = z.object({
  qrCodeValue: z.string(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Session = typeof sessions.$inferSelect;
export type Speaker = typeof speakers.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type SavedSession = typeof savedSessions.$inferSelect;
export type Company = typeof companies.$inferSelect;
export type TimetableItem = typeof timetableItems.$inferSelect;
export type CaseStudy = typeof caseStudies.$inferSelect;
export type UserCaseStudy = typeof userCaseStudies.$inferSelect;
export type SupportContact = typeof supportContacts.$inferSelect;
export type Event = typeof events.$inferSelect;
export type NotificationDevice = typeof notificationDevices.$inferSelect;

export type AuthSession = typeof authSessions.$inferSelect;
