import { drizzle } from "drizzle-orm/node-postgres";
import {
  eq,
  and,
  desc,
  sql,
  like,
  or,
  isNull,
  ne,
  ilike,
  count,
  gte,
  lte,
  gt,
  lt,
  inArray,
} from "drizzle-orm";
import pg from "pg";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import * as schema from "@shared/schema";
import { writeAuditRecord } from "./audit";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("sslmode")
    ? { rejectUnauthorized: false }
    : undefined,
});
let migrationsReady = false;

export const db = drizzle(pool, { schema });

function normalizeStoredEmail(email: string): string {
  return email.trim().toLowerCase().replace(/\.+$/, "");
}

export const CASE_STUDY_FULL_ERROR = "CASE_STUDY_FULL";
export const CASE_STUDY_FULL_MESSAGE =
  "Case study is full. Choose another case study.";

export type EventEmailKind = "event_live" | "attendee_added";
export type EventEmailOutboxItem = {
  id: number;
  eventId: string;
  userId: string;
  kind: EventEmailKind;
  recipientEmail: string;
  recipientName: string;
  eventName: string;
  eventYear: number;
  eventStartDate: string | null;
  attempts: number;
  claimToken: string;
};

export function eventEmailRecipientIsCurrent(input: {
  kind: EventEmailKind;
  eventId: string;
  userEventId: string | null;
  role: string;
  eventStatus: string;
  invitationSentAt: Date | null;
}): boolean {
  const validRole =
    input.kind === "event_live"
      ? input.role === "attendee" || input.role === "staff"
      : input.role === "attendee";
  return (
    input.userEventId === input.eventId &&
    input.eventStatus === "published" &&
    validRole &&
    !(input.kind === "attendee_added" && input.invitationSentAt)
  );
}

const STARTER_TIMETABLE = [
  {
    time: "09:00",
    activity1: `${schema.STARTER_TIMETABLE_PREFIX} Registration`,
    activity2: "Replace with your arrival details",
    duration: "30 min",
    location: "",
    category: "registration",
    sortOrder: 0,
  },
  {
    time: "09:30",
    activity1: `${schema.STARTER_TIMETABLE_PREFIX} Opening session`,
    activity2: "Replace with your opening programme",
    duration: "60 min",
    location: "",
    category: "session",
    sortOrder: 1,
  },
  {
    time: "12:00",
    activity1: `${schema.STARTER_TIMETABLE_PREFIX} Break`,
    activity2: "Replace with your break or lunch details",
    duration: "60 min",
    location: "",
    category: "break",
    sortOrder: 2,
  },
  {
    time: "17:00",
    activity1: `${schema.STARTER_TIMETABLE_PREFIX} Closing`,
    activity2: "Replace with your closing programme",
    duration: "30 min",
    location: "",
    category: "session",
    sortOrder: 3,
  },
] as const;

export type BulkUserImportRow = {
  sourceRow: number;
  email: string;
  name: string;
  role: "attendee" | "staff" | "admin";
  eventId?: string;
};

export type BulkUserImportResult = {
  row: number;
  email: string;
  status: "created" | "skipped" | "error";
  message: string;
  userId?: string;
  eventId?: string | null;
};

export type BulkUserImportSummary = {
  created: number;
  skipped: number;
  failed: number;
  errors: string[];
  results: BulkUserImportResult[];
};

export type AuditLogQuery = {
  search?: string;
  event?: string;
  action?: string;
  outcome?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
};

export type AuditLogPage = {
  entries: schema.AdminAuditLog[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type AuditEventScope = {
  id: string;
  name: string;
  year: number;
  createdAt: Date;
};

export interface IStorage {
  getUserByEmail(email: string): Promise<schema.User | undefined>;
  getUsersByEmail(email: string): Promise<schema.User[]>;
  getUserByEmailAndEvent(
    email: string,
    eventId?: string,
  ): Promise<schema.User | undefined>;
  getUserById(id: string): Promise<schema.User | undefined>;
  createAuthSession(
    userId: string,
    sessionId: string,
    deviceId: string,
    userAgent?: string,
  ): Promise<void>;
  getAuthSession(sessionId: string): Promise<schema.AuthSession | undefined>;
  touchAuthSession(sessionId: string): Promise<void>;
  getAuthSessions(userId: string): Promise<schema.AuthSession[]>;
  revokeAuthSession(userId: string, sessionId: string): Promise<boolean>;
  getUserByQRCode(
    qrCodeValue: string,
    eventId?: string,
  ): Promise<schema.User | undefined>;
  createUser(
    email: string,
    name: string,
    role: string,
    passwordHash: string,
  ): Promise<schema.User>;
  createUserAdmin(
    email: string,
    name: string,
    role: string,
    passwordHash: string | null,
    eventId?: string,
  ): Promise<schema.User>;
  updateUser(
    id: string,
    data: {
      name?: string;
      email?: string;
      role?: string;
      passwordHash?: string | null;
      photoUrl?: string | null;
    },
  ): Promise<schema.User>;
  deleteUser(id: string): Promise<void>;
  getUserExportData(id: string): Promise<Record<string, any>>;
  deleteAllNonAdminUsers(eventId?: string): Promise<void>;
  updateUserPassword(id: string, passwordHash: string): Promise<void>;
  isPasswordReused(userId: string, password: string): Promise<boolean>;
  setInitialUserPassword(id: string, passwordHash: string): Promise<boolean>;
  checkInUser(id: string, eventId: string): Promise<boolean>;
  checkOutUser(id: string, eventId: string): Promise<boolean>;
  getAllUsers(eventId?: string): Promise<schema.User[]>;
  getStats(eventId?: string): Promise<{
    totalRegistered: number;
    checkedIn: number;
    pending: number;
    attendeeCount: number;
    staffCount: number;
  }>;
  getRecentCheckIns(
    limit?: number,
    eventId?: string,
  ): Promise<
    { id: string; name: string; email: string; checkedInAt: string }[]
  >;
  getSessions(
    eventId?: string,
  ): Promise<(schema.Session & { speakerName?: string | null })[]>;
  getSpeakers(eventId?: string): Promise<schema.Speaker[]>;
  createSpeaker(data: {
    name: string;
    title?: string | null;
    bio?: string | null;
    photoUrl?: string | null;
    company?: string | null;
    email?: string | null;
    linkedin?: string | null;
    sortOrder?: number;
    eventId?: string;
  }): Promise<schema.Speaker>;
  updateSpeaker(
    id: string,
    data: {
      name?: string;
      title?: string | null;
      bio?: string | null;
      photoUrl?: string | null;
      company?: string | null;
      email?: string | null;
      linkedin?: string | null;
    },
  ): Promise<schema.Speaker>;
  reorderSpeakers(
    items: { id: string; sortOrder: number }[],
    eventId: string,
  ): Promise<void>;
  deleteSpeaker(id: string): Promise<void>;
  deleteAllSpeakers(eventId?: string): Promise<void>;
  getNotifications(
    role?: string,
    eventId?: string,
  ): Promise<schema.Notification[]>;
  getUserNotifications(
    userId: string,
    role: string,
    eventId: string,
  ): Promise<(schema.Notification & { read: boolean })[]>;
  markNotificationRead(
    userId: string,
    notificationId: string,
  ): Promise<boolean>;
  markAllNotificationsRead(
    userId: string,
    role: string,
    eventId: string,
  ): Promise<number>;
  dismissNotification(userId: string, notificationId: string): Promise<boolean>;
  getSavedSessions(userId: string, eventId?: string): Promise<string[]>;
  saveSession(userId: string, sessionId: string): Promise<void>;
  unsaveSession(userId: string, sessionId: string): Promise<void>;
  getCompanies(eventId?: string): Promise<schema.Company[]>;
  getCompanyById(id: string): Promise<schema.Company | undefined>;
  createCompany(data: {
    name: string;
    category: string;
    description?: string | null;
    logoUrl?: string | null;
    websiteUrl?: string | null;
    sortOrder?: number;
    eventId?: string;
  }): Promise<schema.Company>;
  updateCompany(
    id: string,
    data: {
      name?: string;
      category?: string;
      description?: string | null;
      logoUrl?: string | null;
      logoShape?: "circle" | "square";
      websiteUrl?: string | null;
    },
  ): Promise<schema.Company>;
  deleteCompany(id: string): Promise<void>;
  deleteAllCompanies(eventId?: string): Promise<void>;
  reorderCompanies(items: { id: string; sortOrder: number }[]): Promise<void>;
  deleteAllEvents(): Promise<void>;
  getTimetableItems(eventId?: string): Promise<schema.TimetableItem[]>;
  getStarterTimetableItems(eventId: string): Promise<schema.TimetableItem[]>;
  createTimetableItem(data: {
    time: string;
    activity1: string;
    activity2?: string | null;
    duration: string;
    location?: string | null;
    category?: string;
    sortOrder?: number;
    eventId?: string;
  }): Promise<schema.TimetableItem>;
  updateTimetableItem(
    id: string,
    data: {
      time?: string;
      activity1?: string;
      activity2?: string | null;
      duration?: string;
      location?: string | null;
      category?: string;
      sortOrder?: number;
    },
  ): Promise<schema.TimetableItem>;
  deleteTimetableItem(id: string): Promise<void>;
  deleteAllTimetableItems(eventId?: string): Promise<void>;
  reorderTimetableItems(
    items: { id: string; sortOrder: number }[],
  ): Promise<void>;
  isInvitedToDinner(userId: string): Promise<boolean>;
  createNotification(
    title: string,
    message: string,
    type: string,
    targetRole?: string,
    eventId?: string,
  ): Promise<schema.Notification>;
  getUserCaseStudies(
    userId: string,
    eventId?: string,
  ): Promise<schema.CaseStudy[]>;
  getUserCaseStudiesWithStatus(
    userId: string,
    eventId?: string,
  ): Promise<(schema.CaseStudy & { userCheckedIn: boolean })[]>;
  checkInUserCaseStudy(
    userId: string,
    caseStudyId: string,
    eventId?: string,
  ): Promise<{ userName: string; alreadyCheckedIn: boolean }>;
  getAllCaseStudies(eventId?: string): Promise<schema.CaseStudy[]>;
  createCaseStudy(data: {
    caseId: string;
    company: string;
    title: string;
    type: string;
    duration: string;
    description?: string | null;
    room?: string | null;
    sortOrder?: number;
    eventId?: string;
  }): Promise<schema.CaseStudy>;
  updateCaseStudy(
    id: string,
    data: {
      company?: string;
      title?: string;
      type?: string;
      duration?: string;
      description?: string | null;
      room?: string | null;
    },
  ): Promise<schema.CaseStudy>;
  deleteCaseStudy(id: string): Promise<void>;
  deleteAllCaseStudies(eventId?: string): Promise<void>;
  deleteAllNotifications(eventId: string): Promise<void>;
  reorderCaseStudies(items: { id: string; sortOrder: number }[]): Promise<void>;
  assignCaseStudy(userId: string, caseStudyId: string): Promise<void>;
  bulkAssignCaseStudies(
    userIds: string[],
    caseStudyId: string,
  ): Promise<
    {
      userId: string;
      status: "created" | "skipped" | "error";
      message: string;
    }[]
  >;
  removeCaseStudyAssignment(userId: string, caseStudyId: string): Promise<void>;
  unassignCaseStudy(userId: string, caseStudyId: string): Promise<void>;
  getCaseStudyAttendees(caseStudyId: string): Promise<
    {
      id: string;
      name: string;
      email: string;
      assignedAt: string;
      checkedIn: boolean;
    }[]
  >;
  searchAttendees(
    query: string,
    eventId?: string,
  ): Promise<
    { id: string; name: string; email: string; photoUrl: string | null }[]
  >;
  getSupportContacts(): Promise<schema.SupportContact[]>;
  getAdminStats(eventId?: string): Promise<{
    users: number;
    speakers: number;
    companies: number;
    caseStudies: number;
    timetable: number;
    notifications: number;
  }>;
  seedData(): Promise<void>;
  // Events
  getEvents(): Promise<schema.Event[]>;
  getEventById(id: string): Promise<schema.Event | undefined>;
  getActiveEvent(): Promise<schema.Event | undefined>;
  createEvent(data: {
    name: string;
    year: number;
    startDate?: string;
    endDate?: string;
    scheduleStart?: string;
    scheduleEnd?: string;
    location?: string;
    description?: string;
  }): Promise<schema.Event>;
  updateEvent(
    id: string,
    data: {
      name?: string;
      year?: number;
      startDate?: string | null;
      endDate?: string | null;
      scheduleStart?: string | null;
      scheduleEnd?: string | null;
      location?: string | null;
      description?: string | null;
      logoUrl?: string | null;
      logoShape?: "circle" | "square";
      logoZoom?: number;
      logoOffsetX?: number;
      logoOffsetY?: number;
      primaryColor?: string | null;
      accentColor?: string | null;
      gradientStart?: string | null;
      gradientEnd?: string | null;
      tagline?: string | null;
      displayDate?: string | null;
      showYearOnLogin?: boolean;
    },
  ): Promise<schema.Event>;
  publishEventUpdates(id: string): Promise<schema.Event>;
  deleteEvent(id: string): Promise<void>;
  publishEvent(id: string): Promise<schema.Event>;
  archiveEvent(id: string): Promise<schema.Event>;
  // Bulk user import
  bulkCreateUsers(
    rows: BulkUserImportRow[],
    eventId?: string,
  ): Promise<BulkUserImportSummary>;
  createResetToken(
    userId: string,
    email: string,
    code: string,
    expiresAt: Date,
    purpose?: "reset" | "activation",
  ): Promise<void>;
  deleteResetTokens(
    userId: string,
    purpose?: "reset" | "activation",
  ): Promise<void>;
  getResetTokenCooldownSeconds(
    userId: string,
    purpose?: "reset" | "activation",
  ): Promise<number>;
  verifyResetToken(
    userId: string,
    email: string,
    code: string,
    purpose?: "reset" | "activation",
  ): Promise<ResetTokenVerification>;
  markResetTokenUsed(
    userId: string,
    email: string,
    code: string,
    purpose?: "reset" | "activation",
  ): Promise<boolean>;
  consumeResetTokenAndSetPassword(
    userId: string,
    email: string,
    code: string,
    passwordHash: string,
    purpose: "reset" | "activation",
    requireUninitializedAccount: boolean,
  ): Promise<boolean>;
  getSecurityLog(limit?: number): Promise<
    {
      email: string;
      requestedAt: string;
      status: string;
      completedAt: string | null;
    }[]
  >;
  logLoginEvent(
    email: string,
    eventType: string,
    eventId?: string | null,
  ): Promise<void>;
  getLoginEvents(
    limit?: number,
    eventId?: string,
  ): Promise<schema.LoginEvent[]>;
  getUsersWithoutPasswords(): Promise<schema.User[]>;
  markActivationInvitationSent(userId: string): Promise<boolean>;
  markEventInvitationSent(userId: string): Promise<boolean>;
  logAuditAction(
    adminId: string,
    adminEmail: string,
    action: string,
    targetId?: string,
    targetType?: string,
    metadata?: Record<string, any>,
  ): Promise<void>;
  getAuditLog(
    limit?: number,
    eventId?: string,
  ): Promise<schema.AdminAuditLog[]>;
  getAuditEventScopes(): Promise<AuditEventScope[]>;
  getAuditLogPage(options: AuditLogQuery): Promise<AuditLogPage>;
  // Push notifications
  savePushToken(userId: string, token: string | null): Promise<void>;
  saveDevicePushToken(
    userId: string,
    deviceId: string,
    token: string | null,
  ): Promise<void>;
  getNotificationPreferences(
    userId: string,
    deviceId: string,
  ): Promise<{
    pushEnabled: boolean;
    sessionAlerts: boolean;
  }>;
  updateNotificationPreferences(
    userId: string,
    deviceId: string,
    preferences: {
      pushEnabled?: boolean;
      sessionAlerts?: boolean;
    },
  ): Promise<schema.NotificationDevice>;
  getAttendeePushTokens(
    eventId?: string,
    roleFilter?: string | null,
    notificationType?: string,
  ): Promise<{ userId: string; token: string }[]>;
  getUserPushTokens(
    userId: string,
  ): Promise<{ userId: string; token: string }[]>;
  clearInvalidPushToken(token: string): Promise<void>;
  // GDPR
  createGdprRequest(
    userId: string,
    eventId: string,
    userEmail: string,
    userName: string,
    type: "data" | "deletion",
    reason?: string,
  ): Promise<schema.GdprRequest>;
  getGdprRequests(
    status?: string,
    eventId?: string,
  ): Promise<schema.GdprRequest[]>;
  getPendingGdprCount(eventId?: string): Promise<number>;
  resolveGdprRequest(
    id: string,
    status: "approved" | "denied",
    resolvedBy: string,
  ): Promise<schema.GdprRequest>;
  getPendingGdprRequests(eventId?: string): Promise<schema.GdprRequest[]>;
  /** Delete user + mark GDPR request approved (WHERE in_progress AND claimToken) + cancel sibling requests — all in one transaction */
  deleteUserAndResolveGdprRequest(
    userId: string,
    requestId: string,
    resolvedBy: string,
    claimToken: string,
  ): Promise<void>;
  /**
   * Atomically claim a pending request: sets status='in_progress' and generates a unique claimToken.
   * Returns { request, claimToken }, or null if already claimed/resolved.
   */
  claimGdprRequest(
    id: string,
  ): Promise<{ request: schema.GdprRequest; claimToken: string } | null>;
  /** Release a claim back to pending. Requires claimToken — cannot release another worker's active claim. */
  releaseGdprClaim(id: string, claimToken: string): Promise<void>;
  /** Force-release a specific in_progress claim (admin break-glass); does not check claimToken */
  forceReleaseGdprClaim(id: string, eventId?: string): Promise<void>;
  /** Reset all in_progress GDPR requests to pending — call on startup to recover abandoned claims */
  reconcileAbandonedGdprClaims(): Promise<void>;
  markGdprDeliveryAttempt(id: string): Promise<void>;
  markGdprDeliverySuccess(id: string): Promise<void>;
  markGdprDeliveryFailure(id: string, error: string): Promise<void>;
  /**
   * Conditional approval finalization: updates WHERE in_progress AND claimToken.
   * Returns null if claim was released/reclaimed by another worker.
   */
  resolveInProgressGdprRequest(
    id: string,
    claimToken: string,
    status: "approved",
    resolvedBy: string,
  ): Promise<schema.GdprRequest | null>;
  /**
   * Conditional denial: updates WHERE status='pending' — concurrent claim prevents double-resolution.
   * Returns null if request is no longer pending.
   */
  denyPendingGdprRequest(
    id: string,
    resolvedBy: string,
  ): Promise<schema.GdprRequest | null>;
  /** Apply pending additive migrations (idempotent, runs on startup) */
  runStartupMigrations(): Promise<void>;
  checkDatabaseReady(): Promise<boolean>;
  areMigrationsReady(): boolean;
}

export type ResetTokenVerification =
  | { valid: true }
  | {
      valid: false;
      reason: "not_found" | "expired" | "attempts_exceeded" | "invalid_code";
      attemptsRemaining?: number;
    };

export class DatabaseStorage implements IStorage {
  async checkDatabaseReady(): Promise<boolean> {
    try {
      await Promise.race([
        pool.query("SELECT 1"),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("database readiness timeout")),
            3000,
          ),
        ),
      ]);
      return true;
    } catch {
      return false;
    }
  }

  areMigrationsReady(): boolean {
    return migrationsReady;
  }

  async getUserByEmail(email: string): Promise<schema.User | undefined> {
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, normalizeStoredEmail(email)));
    return user;
  }

  async getUsersByEmail(email: string): Promise<schema.User[]> {
    return db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, normalizeStoredEmail(email)))
      .orderBy(desc(schema.users.createdAt));
  }

  async getUserByEmailAndEvent(
    email: string,
    eventId?: string,
  ): Promise<schema.User | undefined> {
    const normalizedEmail = normalizeStoredEmail(email);
    if (!eventId) {
      const [globalAdmin] = await db
        .select()
        .from(schema.users)
        .where(
          and(
            eq(schema.users.email, normalizedEmail),
            isNull(schema.users.eventId),
            eq(schema.users.role, "admin"),
          ),
        );
      return globalAdmin;
    }
    const [eventUser] = await db
      .select()
      .from(schema.users)
      .where(
        and(
          eq(schema.users.email, normalizedEmail),
          eq(schema.users.eventId, eventId),
        ),
      );
    if (eventUser) return eventUser;
    const [globalUser] = await db
      .select()
      .from(schema.users)
      .where(
        and(
          eq(schema.users.email, normalizedEmail),
          isNull(schema.users.eventId),
          eq(schema.users.role, "admin"),
        ),
      );
    return globalUser;
  }

  async getUserById(id: string): Promise<schema.User | undefined> {
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id));
    return user;
  }

  async createAuthSession(
    userId: string,
    sessionId: string,
    deviceId: string,
    userAgent?: string,
  ): Promise<void> {
    await db.insert(schema.authSessions).values({
      id: sessionId,
      userId,
      deviceId,
      userAgent: userAgent || null,
    });
  }

  async getAuthSession(
    sessionId: string,
  ): Promise<schema.AuthSession | undefined> {
    const [session] = await db
      .select()
      .from(schema.authSessions)
      .where(eq(schema.authSessions.id, sessionId));
    return session;
  }

  async touchAuthSession(sessionId: string): Promise<void> {
    await db
      .update(schema.authSessions)
      .set({ lastSeenAt: new Date() })
      .where(
        and(
          eq(schema.authSessions.id, sessionId),
          isNull(schema.authSessions.revokedAt),
        ),
      );
  }

  async getAuthSessions(userId: string): Promise<schema.AuthSession[]> {
    return db
      .select()
      .from(schema.authSessions)
      .where(
        and(
          eq(schema.authSessions.userId, userId),
          isNull(schema.authSessions.revokedAt),
        ),
      )
      .orderBy(desc(schema.authSessions.lastSeenAt));
  }

  async revokeAuthSession(userId: string, sessionId: string): Promise<boolean> {
    const result = await db
      .update(schema.authSessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.authSessions.id, sessionId),
          eq(schema.authSessions.userId, userId),
          isNull(schema.authSessions.revokedAt),
        ),
      )
      .returning({
        id: schema.authSessions.id,
        deviceId: schema.authSessions.deviceId,
      });
    if (result[0]) {
      // A revoked session must not keep receiving notifications. The legacy
      // user-level token cannot be tied to a specific device, so clear it too.
      await db
        .update(schema.notificationDevices)
        .set({ pushToken: null })
        .where(
          and(
            eq(schema.notificationDevices.userId, userId),
            eq(schema.notificationDevices.deviceId, result[0].deviceId),
          ),
        );
      await db
        .update(schema.users)
        .set({ pushToken: null })
        .where(eq(schema.users.id, userId));
    }
    return result.length > 0;
  }

  async getUserByQRCode(
    qrCodeValue: string,
    eventId?: string,
  ): Promise<schema.User | undefined> {
    const conditions = [eq(schema.users.qrCodeValue, qrCodeValue)];
    if (eventId) {
      conditions.push(
        eq(schema.users.eventId, eventId),
        eq(schema.users.role, "attendee"),
      );
    }
    const [user] = await db
      .select()
      .from(schema.users)
      .where(and(...conditions));
    return user;
  }

  async createUser(
    email: string,
    name: string,
    role: string,
    passwordHash: string,
  ): Promise<schema.User> {
    if (role !== "admin") {
      throw new Error(
        "An event is required when creating an attendee or staff member",
      );
    }
    const crypto = await import("crypto");
    const qrCodeValue = `SC2026-${crypto.randomUUID()}`;
    const [user] = await db
      .insert(schema.users)
      .values({
        email: normalizeStoredEmail(email),
        name,
        role,
        qrCodeValue,
        passwordHash,
      })
      .returning();
    return user;
  }

  async updateUserPassword(id: string, passwordHash: string): Promise<void> {
    await db.transaction(async (tx) => {
      const [currentUser] = await tx
        .select({ passwordHash: schema.users.passwordHash })
        .from(schema.users)
        .where(eq(schema.users.id, id));
      if (currentUser?.passwordHash) {
        await tx.insert(schema.passwordHistory).values({
          userId: id,
          passwordHash: currentUser.passwordHash,
        });
      }
      await tx
        .update(schema.users)
        .set({
          passwordHash,
          passwordVersion: sql`${schema.users.passwordVersion} + 1`,
        })
        .where(eq(schema.users.id, id));
    });
  }

  async isPasswordReused(userId: string, password: string): Promise<boolean> {
    const [user, history] = await Promise.all([
      db
        .select({ passwordHash: schema.users.passwordHash })
        .from(schema.users)
        .where(eq(schema.users.id, userId)),
      db
        .select({ passwordHash: schema.passwordHistory.passwordHash })
        .from(schema.passwordHistory)
        .where(eq(schema.passwordHistory.userId, userId)),
    ]);
    const hashes = [
      user[0]?.passwordHash,
      ...history.map((entry) => entry.passwordHash),
    ].filter((hash): hash is string => Boolean(hash));
    for (const hash of hashes) {
      if (await bcrypt.compare(password, hash)) return true;
    }
    return false;
  }

  async setInitialUserPassword(
    id: string,
    passwordHash: string,
  ): Promise<boolean> {
    const updated = await db
      .update(schema.users)
      .set({
        passwordHash,
        passwordVersion: sql`${schema.users.passwordVersion} + 1`,
      })
      .where(and(eq(schema.users.id, id), isNull(schema.users.passwordHash)))
      .returning({ id: schema.users.id });
    return updated.length > 0;
  }

  async checkInUser(id: string, eventId: string): Promise<boolean> {
    const updated = await db
      .update(schema.users)
      .set({ checkedIn: true, checkedInAt: new Date() })
      .where(
        and(
          eq(schema.users.id, id),
          eq(schema.users.eventId, eventId),
          eq(schema.users.checkedIn, false),
          ne(schema.users.role, "admin"),
        ),
      )
      .returning({ id: schema.users.id });
    return updated.length > 0;
  }

  async checkOutUser(id: string, eventId: string): Promise<boolean> {
    const updated = await db
      .update(schema.users)
      .set({ checkedIn: false, checkedInAt: null })
      .where(
        and(
          eq(schema.users.id, id),
          eq(schema.users.eventId, eventId),
          eq(schema.users.checkedIn, true),
          ne(schema.users.role, "admin"),
        ),
      )
      .returning({ id: schema.users.id });
    return updated.length > 0;
  }

  async getAllUsers(eventId?: string): Promise<schema.User[]> {
    if (eventId) {
      return db
        .select()
        .from(schema.users)
        .where(
          or(
            eq(schema.users.eventId, eventId),
            and(isNull(schema.users.eventId), eq(schema.users.role, "admin")),
          ),
        )
        .orderBy(schema.users.name);
    }
    return db.select().from(schema.users).orderBy(schema.users.name);
  }

  async markActivationInvitationSent(userId: string): Promise<boolean> {
    const [updated] = await db
      .update(schema.users)
      .set({ activationInvitationSentAt: new Date() })
      .where(
        and(
          eq(schema.users.id, userId),
          eq(schema.users.role, "attendee"),
          isNull(schema.users.passwordHash),
          isNull(schema.users.activationInvitationSentAt),
        ),
      )
      .returning({ id: schema.users.id });
    return Boolean(updated);
  }

  async markEventInvitationSent(userId: string): Promise<boolean> {
    const [updated] = await db
      .update(schema.users)
      .set({ eventInvitationSentAt: new Date() })
      .where(
        and(
          eq(schema.users.id, userId),
          eq(schema.users.role, "attendee"),
          isNull(schema.users.eventInvitationSentAt),
        ),
      )
      .returning({ id: schema.users.id });
    return Boolean(updated);
  }

  async enqueueEventEmail(
    event: schema.Event,
    user: schema.User,
    kind: EventEmailKind,
    resetFailed = false,
  ): Promise<boolean> {
    const status = user.email.trim().toLowerCase().endsWith(".test")
      ? "skipped"
      : "pending";
    const { rowCount } = await pool.query(
      `INSERT INTO event_email_outbox
         (event_id, user_id, kind, recipient_email, recipient_name,
          event_name, event_year, event_start_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (event_id, user_id, kind) DO NOTHING`,
      [
        event.id,
        user.id,
        kind,
        user.email,
        user.name,
        event.name,
        event.year,
        event.startDate ?? null,
        status,
      ],
    );
    if (rowCount) return true;
    if (!resetFailed) return false;
    const updated = await pool.query(
      `UPDATE event_email_outbox
       SET status = $1, attempts = 0, max_attempts = 5,
           next_attempt_at = now(), lease_until = NULL, last_error = NULL,
           sent_at = NULL, recipient_email = $2, recipient_name = $3,
           event_name = $4, event_year = $5, event_start_date = $6,
           updated_at = now()
       WHERE event_id = $7 AND user_id = $8 AND kind = $9
         AND status IN ('failed', 'needs_review', 'skipped', 'cancelled')`,
      [
        status,
        user.email,
        user.name,
        event.name,
        event.year,
        event.startDate ?? null,
        event.id,
        user.id,
        kind,
      ],
    );
    return Boolean(updated.rowCount);
  }

  async enqueueEventEmailsForEvent(
    event: schema.Event,
    kind: EventEmailKind,
    userIds?: string[],
  ): Promise<number> {
    if (userIds && userIds.length === 0) return 0;
    const result = await pool.query(
      `INSERT INTO event_email_outbox
         (event_id, user_id, kind, recipient_email, recipient_name,
          event_name, event_year, event_start_date, status)
       SELECT $1, u.id, $2, u.email, u.name, $3, $4, $5,
              CASE WHEN lower(trim(u.email)) LIKE '%.test' THEN 'skipped' ELSE 'pending' END
       FROM users u
       WHERE u.event_id = $1
         AND (($2 = 'event_live' AND u.role IN ('attendee', 'staff'))
           OR ($2 = 'attendee_added' AND u.role = 'attendee'
               AND u.event_invitation_sent_at IS NULL))
         AND ($6::varchar[] IS NULL OR u.id = ANY($6::varchar[]))
       ON CONFLICT (event_id, user_id, kind) DO UPDATE
       SET status = EXCLUDED.status,
           attempts = 0, next_attempt_at = now(), lease_until = NULL,
           claim_token = NULL, last_error = NULL, sent_at = NULL,
           recipient_email = EXCLUDED.recipient_email,
           recipient_name = EXCLUDED.recipient_name,
           event_name = EXCLUDED.event_name, event_year = EXCLUDED.event_year,
           event_start_date = EXCLUDED.event_start_date, updated_at = now()
       WHERE event_email_outbox.status = 'cancelled'`,
      [
        event.id,
        kind,
        event.name,
        event.year,
        event.startDate ?? null,
        userIds ?? null,
      ],
    );
    return result.rowCount ?? 0;
  }

  async claimEventEmail(): Promise<EventEmailOutboxItem | null> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "DELETE FROM event_email_urgent_requests WHERE lease_until <= now()",
      );
      await client.query(
        `UPDATE event_email_outbox
         SET status = 'needs_review', lease_until = NULL, claim_token = NULL,
             last_error = 'Worker lease expired; delivery outcome is ambiguous',
             updated_at = now()
         WHERE status = 'processing' AND lease_until <= now()`,
      );
      const gate = await client.query(
        `SELECT next_send_at, lease_until, lease_token, circuit_breaker_until
         FROM event_email_send_gate WHERE id = 1 FOR UPDATE`,
      );
      if (!gate.rows[0]) {
        await client.query("COMMIT");
        return null;
      }
      if (
        gate.rows[0].lease_until &&
        new Date(gate.rows[0].lease_until).getTime() <= Date.now()
      ) {
        await client.query(
          `UPDATE event_email_send_gate
           SET lease_until = NULL, lease_token = NULL
           WHERE id = 1 AND lease_token = $1`,
          [gate.rows[0].lease_token],
        );
      }
      if (
        (gate.rows[0].lease_until &&
          new Date(gate.rows[0].lease_until).getTime() > Date.now()) ||
        (gate.rows[0].circuit_breaker_until &&
          new Date(gate.rows[0].circuit_breaker_until).getTime() >
            Date.now()) ||
        new Date(gate.rows[0].next_send_at).getTime() > Date.now()
      ) {
        await client.query("COMMIT");
        return null;
      }
      const urgent = await client.query(
        "SELECT 1 FROM event_email_urgent_requests WHERE lease_until > now() LIMIT 1",
      );
      if (urgent.rowCount) {
        await client.query("COMMIT");
        return null;
      }
      const claimed = await client.query(
        `SELECT id, event_id AS "eventId", user_id AS "userId", kind,
                recipient_email AS "recipientEmail",
                recipient_name AS "recipientName", event_name AS "eventName",
                event_year AS "eventYear", event_start_date AS "eventStartDate",
                attempts
         FROM event_email_outbox
         WHERE status = 'pending'
           AND next_attempt_at <= now() AND attempts < max_attempts
         ORDER BY CASE kind WHEN 'attendee_added' THEN 0 ELSE 1 END, id
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
      );
      const row = claimed.rows[0];
      if (!row) {
        await client.query("COMMIT");
        return null;
      }
      const claimToken = randomUUID();
      await client.query(
        `UPDATE event_email_outbox
         SET status = 'processing', attempts = attempts + 1,
              claim_token = $2, lease_until = now() + interval '5 minutes',
             updated_at = now()
         WHERE id = $1`,
        [row.id, claimToken],
      );
      await client.query(
        `UPDATE event_email_send_gate
         SET next_send_at = now() + interval '10 seconds',
              lease_until = now() + interval '6 minutes', lease_token = $1
         WHERE id = 1`,
        [claimToken],
      );
      await client.query("COMMIT");
      return {
        ...row,
        id: Number(row.id),
        attempts: Number(row.attempts) + 1,
        claimToken,
      } as EventEmailOutboxItem;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async getValidatedEventEmailClaim(
    item: EventEmailOutboxItem,
  ): Promise<EventEmailOutboxItem | null> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query(
        `SELECT o.id, o.event_id AS "eventId", o.user_id AS "userId", o.kind,
                u.email AS "recipientEmail", u.name AS "recipientName",
                e.name AS "eventName", e.year AS "eventYear",
                e.start_date AS "eventStartDate", u.role,
                u.event_id AS "userEventId", e.status AS "eventStatus",
                u.event_invitation_sent_at AS "invitationSentAt",
                o.lease_until AS "leaseUntil"
         FROM event_email_outbox o
         JOIN users u ON u.id = o.user_id
         JOIN events e ON e.id = o.event_id
         WHERE o.id = $1 AND o.status = 'processing' AND o.claim_token = $2
         FOR UPDATE OF o`,
        [item.id, item.claimToken],
      );
      const row = selected.rows[0];
      if (!row) {
        await client.query(
          `UPDATE event_email_send_gate
           SET lease_until = NULL, lease_token = NULL
           WHERE id = 1 AND lease_token = $1`,
          [item.claimToken],
        );
        await client.query("COMMIT");
        return null;
      }
      if (new Date(row.leaseUntil).getTime() <= Date.now()) {
        await client.query(
          `UPDATE event_email_outbox
           SET status = 'needs_review', lease_until = NULL, claim_token = NULL,
               last_error = 'Worker lease expired before SMTP; delivery outcome is ambiguous',
               updated_at = now()
           WHERE id = $1 AND claim_token = $2`,
          [item.id, item.claimToken],
        );
        await client.query(
          `UPDATE event_email_send_gate
           SET lease_until = NULL, lease_token = NULL
           WHERE id = 1 AND lease_token = $1`,
          [item.claimToken],
        );
        await client.query("COMMIT");
        return null;
      }
      const stillValid = eventEmailRecipientIsCurrent({
        kind: row.kind,
        eventId: row.eventId,
        userEventId: row.userEventId,
        role: row.role,
        eventStatus: row.eventStatus,
        invitationSentAt: row.invitationSentAt,
      });
      if (!stillValid) {
        await client.query(
          `UPDATE event_email_outbox
           SET status = 'cancelled', lease_until = NULL, claim_token = NULL,
               last_error = 'Recipient or event no longer meets delivery conditions',
               updated_at = now()
           WHERE id = $1 AND claim_token = $2`,
          [item.id, item.claimToken],
        );
        await client.query(
          `UPDATE event_email_send_gate
           SET lease_until = NULL, lease_token = NULL
           WHERE id = 1 AND lease_token = $1`,
          [item.claimToken],
        );
        await client.query("COMMIT");
        return null;
      }
      await client.query(
        `UPDATE event_email_outbox
         SET recipient_email = $3, recipient_name = $4, event_name = $5,
             event_year = $6, event_start_date = $7, updated_at = now()
         WHERE id = $1 AND claim_token = $2`,
        [
          item.id,
          item.claimToken,
          row.recipientEmail,
          row.recipientName,
          row.eventName,
          row.eventYear,
          row.eventStartDate,
        ],
      );
      await client.query("COMMIT");
      return {
        ...item,
        recipientEmail: row.recipientEmail,
        recipientName: row.recipientName,
        eventName: row.eventName,
        eventYear: row.eventYear,
        eventStartDate: row.eventStartDate,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async withLockedEventEmailRecipient(
    item: EventEmailOutboxItem,
    deliver: (current: EventEmailOutboxItem) => Promise<void>,
  ): Promise<EventEmailOutboxItem | null> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Keep both rows locked while SMTP is in progress. All edits, archives,
      // and deletes of these rows must wait, regardless of which route made
      // the change. The claim lease is longer than the SMTP timeout.
      const selected = await client.query(
        `SELECT o.event_id AS "eventId", o.kind,
                u.email AS "recipientEmail", u.name AS "recipientName",
                u.role, u.event_id AS "userEventId",
                u.event_invitation_sent_at AS "invitationSentAt",
                e.name AS "eventName", e.year AS "eventYear",
                e.start_date AS "eventStartDate", e.status AS "eventStatus"
         FROM event_email_outbox o
         JOIN users u ON u.id = o.user_id
         JOIN events e ON e.id = o.event_id
         WHERE o.id = $1 AND o.status = 'processing' AND o.claim_token = $2
           AND o.lease_until > now()
         FOR SHARE OF u, e`,
        [item.id, item.claimToken],
      );
      const row = selected.rows[0];
      if (
        !row ||
        !eventEmailRecipientIsCurrent({
          kind: row.kind,
          eventId: row.eventId,
          userEventId: row.userEventId,
          role: row.role,
          eventStatus: row.eventStatus,
          invitationSentAt: row.invitationSentAt,
        })
      ) {
        if (row) {
          await client.query(
            `UPDATE event_email_outbox
             SET status = 'cancelled', claim_token = NULL, lease_until = NULL,
                 last_error = 'Recipient or event changed before delivery',
                 updated_at = now()
             WHERE id = $1 AND status = 'processing' AND claim_token = $2`,
            [item.id, item.claimToken],
          );
        }
        await client.query(
          `UPDATE event_email_send_gate
           SET lease_until = NULL, lease_token = NULL
           WHERE id = 1 AND lease_token = $1`,
          [item.claimToken],
        );
        await client.query("COMMIT");
        return null;
      }
      const current: EventEmailOutboxItem = {
        ...item,
        recipientEmail: row.recipientEmail,
        recipientName: row.recipientName,
        eventName: row.eventName,
        eventYear: row.eventYear,
        eventStartDate: row.eventStartDate,
      };
      await client.query(
        `UPDATE event_email_outbox
         SET recipient_email = $3, recipient_name = $4,
             event_name = $5, event_year = $6, event_start_date = $7,
             updated_at = now()
         WHERE id = $1 AND status = 'processing' AND claim_token = $2`,
        [
          item.id,
          item.claimToken,
          current.recipientEmail,
          current.recipientName,
          current.eventName,
          current.eventYear,
          current.eventStartDate,
        ],
      );
      await deliver(current);
      await client.query("COMMIT");
      return current;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async completeEventEmail(item: EventEmailOutboxItem): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const completed = await client.query(
        `UPDATE event_email_outbox
         SET status = 'sent', sent_at = now(), lease_until = NULL,
             claim_token = NULL, last_error = NULL, updated_at = now()
         WHERE id = $1 AND status = 'processing' AND claim_token = $2
           AND lease_until > now()
         RETURNING user_id`,
        [item.id, item.claimToken],
      );
      if (!completed.rowCount) {
        await client.query("COMMIT");
        return;
      }
      if (item.kind === "attendee_added") {
        await client.query(
          `UPDATE users SET event_invitation_sent_at = COALESCE(event_invitation_sent_at, now())
           WHERE id = $1 AND event_id = $2 AND role = 'attendee'`,
          [item.userId, item.eventId],
        );
      }
      await client.query(
        `UPDATE event_email_send_gate
         SET next_send_at = GREATEST(next_send_at, now() + interval '10 seconds'),
             lease_until = NULL, lease_token = NULL
         WHERE id = 1 AND lease_token = $1`,
        [item.claimToken],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async skipEventEmail(item: EventEmailOutboxItem): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE event_email_outbox
         SET status = 'skipped', lease_until = NULL,
             claim_token = NULL,
             last_error = 'Skipped test-domain address; SMTP was not opened',
             updated_at = now()
         WHERE id = $1 AND status = 'processing' AND claim_token = $2
           AND lease_until > now()`,
        [item.id, item.claimToken],
      );
      await client.query(
        `UPDATE event_email_send_gate
         SET lease_until = NULL, lease_token = NULL
         WHERE id = 1 AND lease_token = $1`,
        [item.claimToken],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async failEventEmail(
    item: EventEmailOutboxItem,
    errorMessage: string,
    isSmtp454: boolean,
    deliveryOutcomeUncertain = false,
  ): Promise<void> {
    const terminal = item.attempts >= 5;
    const retryMs = isSmtp454
      ? 30 * 60_000
      : Math.min(60_000 * 2 ** Math.max(0, item.attempts - 1), 30 * 60_000);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(
        `UPDATE event_email_outbox
         SET status = $1, next_attempt_at = now() + ($2 * interval '1 millisecond'),
             lease_until = NULL, claim_token = NULL,
             last_error = $3, updated_at = now()
         WHERE id = $4 AND status = 'processing' AND claim_token = $5
           AND lease_until > now()
         RETURNING id`,
        [
          deliveryOutcomeUncertain
            ? "needs_review"
            : terminal
              ? "failed"
              : "pending",
          retryMs,
          errorMessage.slice(0, 2000),
          item.id,
          item.claimToken,
        ],
      );
      if (updated.rowCount) {
        await client.query(
          `UPDATE event_email_send_gate
           SET next_send_at = GREATEST(next_send_at, now() + interval '10 seconds'),
               lease_until = NULL, lease_token = NULL,
               circuit_breaker_until = CASE WHEN $2 THEN now() + interval '30 minutes'
                                             ELSE circuit_breaker_until END
           WHERE id = 1 AND lease_token = $1`,
          [item.claimToken, isSmtp454],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async acquireUrgentEventEmailSlot(): Promise<string> {
    const token = randomUUID();
    await pool.query(
      `INSERT INTO event_email_urgent_requests (token, lease_until)
       VALUES ($1, now() + interval '75 seconds')`,
      [token],
    );
    const deadline = Date.now() + 65_000;
    while (Date.now() < deadline) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const gate = await client.query(
          `SELECT next_send_at, lease_until, circuit_breaker_until
           FROM event_email_send_gate WHERE id = 1 FOR UPDATE`,
        );
        if (!gate.rows[0]) {
          throw new Error("Email send gate is unavailable");
        }
        if (
          gate.rows[0]?.circuit_breaker_until &&
          new Date(gate.rows[0].circuit_breaker_until).getTime() > Date.now()
        ) {
          await client.query(
            "DELETE FROM event_email_urgent_requests WHERE token = $1",
            [token],
          );
          await client.query("COMMIT");
          throw new Error(
            "Email temporarily unavailable due to SMTP rate limiting",
          );
        }
        await client.query(
          "DELETE FROM event_email_urgent_requests WHERE lease_until <= now()",
        );
        const first = await client.query(
          `SELECT token FROM event_email_urgent_requests
           WHERE lease_until > now() ORDER BY requested_at, token LIMIT 1`,
        );
        if (
          first.rows[0]?.token === token &&
          (!gate.rows[0]?.lease_until ||
            new Date(gate.rows[0].lease_until).getTime() <= Date.now()) &&
          new Date(gate.rows[0].next_send_at).getTime() <= Date.now()
        ) {
          await client.query(
            `UPDATE event_email_send_gate
             SET lease_until = now() + interval '6 minutes', lease_token = $1,
                 next_send_at = now() + interval '10 seconds'
             WHERE id = 1`,
            [token],
          );
          await client.query(
            "DELETE FROM event_email_urgent_requests WHERE token = $1",
            [token],
          );
          await client.query("COMMIT");
          return token;
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        if (
          !(error instanceof Error) ||
          !error.message.includes("SMTP rate limiting")
        ) {
          await pool
            .query("DELETE FROM event_email_urgent_requests WHERE token = $1", [
              token,
            ])
            .catch(() => {});
        }
        throw error;
      } finally {
        client.release();
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await pool.query(
      "DELETE FROM event_email_urgent_requests WHERE token = $1",
      [token],
    );
    throw new Error("Email send slot is busy; please retry shortly");
  }

  async releaseUrgentEventEmailSlot(
    token: string,
    isSmtp454: boolean,
  ): Promise<void> {
    await pool.query(
      `UPDATE event_email_send_gate
       SET lease_until = NULL, lease_token = NULL,
           next_send_at = GREATEST(next_send_at, now() + interval '10 seconds'),
           circuit_breaker_until = CASE WHEN $2 THEN now() + interval '30 minutes'
                                        ELSE circuit_breaker_until END
       WHERE id = 1 AND lease_token = $1`,
      [token, isSmtp454],
    );
  }

  async getEventInvitationOutboxStatus(
    eventId: string,
    userId: string,
  ): Promise<{ status: string; attempts: number } | null> {
    const result = await pool.query(
      `SELECT status, attempts FROM event_email_outbox
       WHERE event_id = $1 AND user_id = $2 AND kind = 'attendee_added'`,
      [eventId, userId],
    );
    return result.rows[0] ?? null;
  }

  async getEventInvitationOutboxStatuses(
    eventId: string,
    userIds: string[],
  ): Promise<Map<string, { status: string; attempts: number }>> {
    if (userIds.length === 0) return new Map();
    const result = await pool.query(
      `SELECT user_id, status, attempts FROM event_email_outbox
       WHERE event_id = $1 AND user_id = ANY($2::varchar[])
         AND kind = 'attendee_added'`,
      [eventId, userIds],
    );
    return new Map(
      result.rows.map((row) => [
        row.user_id as string,
        { status: row.status as string, attempts: Number(row.attempts) },
      ]),
    );
  }

  async getStats(eventId?: string): Promise<{
    totalRegistered: number;
    checkedIn: number;
    pending: number;
    attendeeCount: number;
    staffCount: number;
  }> {
    let query = db
      .select({
        total: sql<number>`count(*) filter (where role <> 'admin')::int`,
        checkedInCount: sql<number>`count(*) filter (where role <> 'admin' and checked_in = true)::int`,
        attendees: sql<number>`count(*) filter (where role = 'attendee')::int`,
        staff: sql<number>`count(*) filter (where role = 'staff')::int`,
      })
      .from(schema.users);

    let totals: {
      total: number;
      checkedInCount: number;
      attendees: number;
      staff: number;
    };
    if (eventId) {
      const [result] = await (query as any).where(
        eq(schema.users.eventId, eventId),
      );
      totals = result;
    } else {
      const [result] = await query;
      totals = result;
    }
    const totalRegistered = totals.total;
    const checkedIn = totals.checkedInCount;
    return {
      totalRegistered,
      checkedIn,
      pending: totalRegistered - checkedIn,
      attendeeCount: totals.attendees,
      staffCount: totals.staff,
    };
  }

  async getRecentCheckIns(
    limit = 10,
    eventId?: string,
  ): Promise<
    { id: string; name: string; email: string; checkedInAt: string }[]
  > {
    const conditions = [
      eq(schema.users.checkedIn, true),
      ne(schema.users.role, "admin"),
    ];
    if (eventId) {
      conditions.push(eq(schema.users.eventId, eventId));
    }
    const users = await db
      .select()
      .from(schema.users)
      .where(and(...conditions))
      .orderBy(desc(schema.users.checkedInAt))
      .limit(limit);
    return users.map((u: schema.User) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      checkedInAt: u.checkedInAt?.toISOString() || new Date().toISOString(),
    }));
  }

  async getSessions(
    eventId?: string,
  ): Promise<(schema.Session & { speakerName?: string | null })[]> {
    let query = db
      .select({
        id: schema.sessions.id,
        title: schema.sessions.title,
        description: schema.sessions.description,
        speakerId: schema.sessions.speakerId,
        startTime: schema.sessions.startTime,
        endTime: schema.sessions.endTime,
        location: schema.sessions.location,
        track: schema.sessions.track,
        day: schema.sessions.day,
        eventId: schema.sessions.eventId,
        speakerName: schema.speakers.name,
      })
      .from(schema.sessions)
      .leftJoin(
        schema.speakers,
        eq(schema.sessions.speakerId, schema.speakers.id),
      );
    if (eventId) {
      query = query.where(eq(schema.sessions.eventId, eventId)) as typeof query;
    }
    return query.orderBy(schema.sessions.startTime);
  }

  async getSpeakers(eventId?: string): Promise<schema.Speaker[]> {
    if (eventId) {
      return db
        .select()
        .from(schema.speakers)
        .where(eq(schema.speakers.eventId, eventId))
        .orderBy(schema.speakers.sortOrder);
    }
    return db.select().from(schema.speakers).orderBy(schema.speakers.sortOrder);
  }

  async reorderSpeakers(
    items: { id: string; sortOrder: number }[],
    eventId: string,
  ): Promise<void> {
    await Promise.all(
      items.map(({ id, sortOrder }) =>
        db
          .update(schema.speakers)
          .set({ sortOrder })
          .where(
            and(
              eq(schema.speakers.id, id),
              eq(schema.speakers.eventId, eventId),
            ),
          ),
      ),
    );
  }

  async getNotifications(
    role?: string,
    eventId?: string,
  ): Promise<schema.Notification[]> {
    const conditions: any[] = [];
    if (role) {
      conditions.push(
        or(
          eq(schema.notifications.targetRole, role),
          isNull(schema.notifications.targetRole),
        ),
      );
    }
    conditions.push(ne(schema.notifications.type, "event_reminder"));
    if (eventId) {
      conditions.push(eq(schema.notifications.eventId, eventId));
    }

    if (conditions.length === 0) {
      return db
        .select()
        .from(schema.notifications)
        .orderBy(desc(schema.notifications.createdAt));
    }
    if (conditions.length === 1) {
      return db
        .select()
        .from(schema.notifications)
        .where(conditions[0])
        .orderBy(desc(schema.notifications.createdAt));
    }
    return db
      .select()
      .from(schema.notifications)
      .where(and(...conditions))
      .orderBy(desc(schema.notifications.createdAt));
  }

  async getUserNotifications(
    userId: string,
    role: string,
    eventId: string,
  ): Promise<(schema.Notification & { read: boolean })[]> {
    const rows = await db
      .select({
        notification: schema.notifications,
        read: sql<boolean>`coalesce(${schema.userNotifications.read}, false)`,
        dismissed: sql<boolean>`coalesce(${schema.userNotifications.dismissed}, false)`,
      })
      .from(schema.notifications)
      .leftJoin(
        schema.userNotifications,
        and(
          eq(schema.userNotifications.notificationId, schema.notifications.id),
          eq(schema.userNotifications.userId, userId),
        ),
      )
      .where(
        and(
          eq(schema.notifications.eventId, eventId),
          or(
            eq(schema.notifications.targetRole, role),
            isNull(schema.notifications.targetRole),
          ),
          or(
            isNull(schema.userNotifications.dismissed),
            eq(schema.userNotifications.dismissed, false),
          ),
          ne(schema.notifications.type, "event_reminder"),
        ),
      )
      .orderBy(desc(schema.notifications.createdAt));

    return rows.map(({ notification, read }) => ({
      ...notification,
      read: Boolean(read),
    }));
  }

  async markNotificationRead(
    userId: string,
    notificationId: string,
  ): Promise<boolean> {
    await db
      .insert(schema.userNotifications)
      .values({ userId, notificationId, read: true, dismissed: false })
      .onConflictDoUpdate({
        target: [
          schema.userNotifications.userId,
          schema.userNotifications.notificationId,
        ],
        set: { read: true, dismissed: false },
      });
    return true;
  }

  async markAllNotificationsRead(
    userId: string,
    role: string,
    eventId: string,
  ): Promise<number> {
    const visible = await this.getUserNotifications(userId, role, eventId);
    if (!visible.length) return 0;
    await db
      .insert(schema.userNotifications)
      .values(
        visible.map((notification) => ({
          userId,
          notificationId: notification.id,
          read: true,
          dismissed: false,
        })),
      )
      .onConflictDoUpdate({
        target: [
          schema.userNotifications.userId,
          schema.userNotifications.notificationId,
        ],
        set: { read: true, dismissed: false },
      });
    return visible.length;
  }

  async dismissNotification(
    userId: string,
    notificationId: string,
  ): Promise<boolean> {
    await db
      .insert(schema.userNotifications)
      .values({
        userId,
        notificationId,
        read: true,
        dismissed: true,
      })
      .onConflictDoUpdate({
        target: [
          schema.userNotifications.userId,
          schema.userNotifications.notificationId,
        ],
        set: { read: true, dismissed: true },
      });
    return true;
  }

  async getSavedSessions(userId: string, eventId?: string): Promise<string[]> {
    const saved = await db
      .select({ sessionId: schema.savedSessions.sessionId })
      .from(schema.savedSessions)
      .innerJoin(
        schema.sessions,
        eq(schema.savedSessions.sessionId, schema.sessions.id),
      )
      .where(
        eventId
          ? and(
              eq(schema.savedSessions.userId, userId),
              eq(schema.sessions.eventId, eventId),
            )
          : eq(schema.savedSessions.userId, userId),
      );
    return saved.map((s) => s.sessionId);
  }

  async saveSession(userId: string, sessionId: string): Promise<void> {
    await db
      .insert(schema.savedSessions)
      .values({ userId, sessionId })
      .onConflictDoNothing();
  }

  async unsaveSession(userId: string, sessionId: string): Promise<void> {
    await db
      .delete(schema.savedSessions)
      .where(
        and(
          eq(schema.savedSessions.userId, userId),
          eq(schema.savedSessions.sessionId, sessionId),
        ),
      );
  }

  async getCompanies(eventId?: string): Promise<schema.Company[]> {
    if (eventId) {
      return db
        .select()
        .from(schema.companies)
        .where(eq(schema.companies.eventId, eventId))
        .orderBy(schema.companies.sortOrder, schema.companies.name);
    }
    return db
      .select()
      .from(schema.companies)
      .orderBy(schema.companies.sortOrder, schema.companies.name);
  }

  async getCompanyById(id: string): Promise<schema.Company | undefined> {
    const [company] = await db
      .select()
      .from(schema.companies)
      .where(eq(schema.companies.id, id));
    return company;
  }

  async getUserCaseStudies(
    userId: string,
    eventId?: string,
  ): Promise<schema.CaseStudy[]> {
    const assignments = await db
      .select({ caseStudy: schema.caseStudies })
      .from(schema.userCaseStudies)
      .innerJoin(
        schema.caseStudies,
        eq(schema.userCaseStudies.caseStudyId, schema.caseStudies.id),
      )
      .where(
        eventId
          ? and(
              eq(schema.userCaseStudies.userId, userId),
              eq(schema.caseStudies.eventId, eventId),
            )
          : eq(schema.userCaseStudies.userId, userId),
      )
      .orderBy(schema.caseStudies.sortOrder);
    return assignments.map((a) => a.caseStudy);
  }

  async getUserCaseStudiesWithStatus(
    userId: string,
    eventId?: string,
  ): Promise<(schema.CaseStudy & { userCheckedIn: boolean })[]> {
    const assignments = await db
      .select({
        caseStudy: schema.caseStudies,
        checkedIn: schema.userCaseStudies.checkedIn,
      })
      .from(schema.userCaseStudies)
      .innerJoin(
        schema.caseStudies,
        eq(schema.userCaseStudies.caseStudyId, schema.caseStudies.id),
      )
      .where(
        eventId
          ? and(
              eq(schema.userCaseStudies.userId, userId),
              eq(schema.caseStudies.eventId, eventId),
            )
          : eq(schema.userCaseStudies.userId, userId),
      )
      .orderBy(schema.caseStudies.sortOrder);
    return assignments.map((a) => ({
      ...a.caseStudy,
      userCheckedIn: a.checkedIn,
    }));
  }

  async checkInUserCaseStudy(
    userId: string,
    caseStudyId: string,
    eventId?: string,
  ): Promise<{ userName: string; alreadyCheckedIn: boolean }> {
    const [assignment] = await db
      .select({
        id: schema.userCaseStudies.id,
        checkedIn: schema.userCaseStudies.checkedIn,
        userName: schema.users.name,
      })
      .from(schema.userCaseStudies)
      .innerJoin(
        schema.users,
        eq(schema.userCaseStudies.userId, schema.users.id),
      )
      .innerJoin(
        schema.caseStudies,
        eq(schema.userCaseStudies.caseStudyId, schema.caseStudies.id),
      )
      .where(
        and(
          eq(schema.userCaseStudies.userId, userId),
          eq(schema.userCaseStudies.caseStudyId, caseStudyId),
          ...(eventId ? [eq(schema.caseStudies.eventId, eventId)] : []),
        ),
      );
    if (!assignment) {
      throw new Error("NOT_ASSIGNED");
    }
    if (assignment.checkedIn) {
      return {
        userName: assignment.userName || "Unknown",
        alreadyCheckedIn: true,
      };
    }
    const updated = await db
      .update(schema.userCaseStudies)
      .set({ checkedIn: true, checkedInAt: new Date() })
      .where(
        and(
          eq(schema.userCaseStudies.id, assignment.id),
          eq(schema.userCaseStudies.checkedIn, false),
        ),
      )
      .returning({ id: schema.userCaseStudies.id });
    return {
      userName: assignment.userName || "Unknown",
      alreadyCheckedIn: updated.length === 0,
    };
  }

  async getAllCaseStudies(eventId?: string): Promise<schema.CaseStudy[]> {
    if (eventId) {
      return db
        .select()
        .from(schema.caseStudies)
        .where(eq(schema.caseStudies.eventId, eventId))
        .orderBy(schema.caseStudies.sortOrder);
    }
    return db
      .select()
      .from(schema.caseStudies)
      .orderBy(schema.caseStudies.sortOrder);
  }

  async assignCaseStudy(userId: string, caseStudyId: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const userResult = await client.query<{
        event_id: string | null;
        role: string;
      }>("SELECT event_id, role FROM users WHERE id = $1", [userId]);
      if (!userResult.rows[0] || userResult.rows[0].role !== "attendee") {
        throw new Error("Attendee not found");
      }

      // Lock the case-study row so every assignment to this case study performs
      // the capacity check and insert serially, even when admins submit at once.
      const caseStudyResult = await client.query<{ event_id: string | null }>(
        "SELECT event_id FROM case_studies WHERE id = $1 FOR UPDATE",
        [caseStudyId],
      );
      if (!caseStudyResult.rows[0]) throw new Error("Case study not found");
      if (
        !userResult.rows[0].event_id ||
        userResult.rows[0].event_id !== caseStudyResult.rows[0].event_id
      ) {
        throw new Error(
          "Attendee and case study must belong to the same event",
        );
      }

      const duplicate = await client.query(
        "SELECT 1 FROM user_case_studies WHERE user_id = $1 AND case_study_id = $2",
        [userId, caseStudyId],
      );
      if (duplicate.rowCount) throw new Error("ALREADY_ASSIGNED");

      const capacity = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM user_case_studies WHERE case_study_id = $1",
        [caseStudyId],
      );
      if (Number(capacity.rows[0]?.count || 0) >= 150) {
        throw new Error(CASE_STUDY_FULL_ERROR);
      }

      await client.query(
        "INSERT INTO user_case_studies (user_id, case_study_id) VALUES ($1, $2)",
        [userId, caseStudyId],
      );
      await client.query("COMMIT");
    } catch (error: any) {
      await client.query("ROLLBACK").catch(() => {});
      if (error?.code === "23505") throw new Error("ALREADY_ASSIGNED");
      throw error;
    } finally {
      client.release();
    }
  }

  async bulkAssignCaseStudies(
    userIds: string[],
    caseStudyId: string,
  ): Promise<
    {
      userId: string;
      status: "created" | "skipped" | "error";
      message: string;
    }[]
  > {
    const uniqueUserIds = [...new Set(userIds)];
    const results: {
      userId: string;
      status: "created" | "skipped" | "error";
      message: string;
    }[] = [];
    for (const userId of uniqueUserIds) {
      try {
        await this.assignCaseStudy(userId, caseStudyId);
        results.push({
          userId,
          status: "created",
          message: "Assigned",
        });
      } catch (error: any) {
        if (error?.message === "ALREADY_ASSIGNED") {
          results.push({
            userId,
            status: "skipped",
            message: "Already assigned",
          });
        } else if (error?.message === CASE_STUDY_FULL_ERROR) {
          results.push({
            userId,
            status: "error",
            message: CASE_STUDY_FULL_MESSAGE,
          });
        } else {
          results.push({
            userId,
            status: "error",
            message: error?.message || "Could not assign attendee",
          });
        }
      }
    }
    return results;
  }

  async resetCaseStudyCheckIn(
    userId: string,
    caseStudyId: string,
  ): Promise<void> {
    await db
      .update(schema.userCaseStudies)
      .set({ checkedIn: false, checkedInAt: null })
      .where(
        and(
          eq(schema.userCaseStudies.userId, userId),
          eq(schema.userCaseStudies.caseStudyId, caseStudyId),
        ),
      );
  }

  async getCaseStudyAttendees(caseStudyId: string): Promise<
    {
      id: string;
      name: string;
      email: string;
      assignedAt: string;
      checkedIn: boolean;
    }[]
  > {
    const results = await db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        assignedAt: schema.userCaseStudies.assignedAt,
        checkedIn: schema.userCaseStudies.checkedIn,
      })
      .from(schema.userCaseStudies)
      .innerJoin(
        schema.users,
        eq(schema.userCaseStudies.userId, schema.users.id),
      )
      .where(eq(schema.userCaseStudies.caseStudyId, caseStudyId))
      .orderBy(desc(schema.userCaseStudies.assignedAt));
    return results.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      assignedAt: r.assignedAt?.toISOString() || new Date().toISOString(),
      checkedIn: r.checkedIn,
    }));
  }

  async searchAttendees(
    query: string,
    eventId?: string,
  ): Promise<
    { id: string; name: string; email: string; photoUrl: string | null }[]
  > {
    const nameOrEmail = or(
      like(schema.users.name, `%${query}%`),
      like(schema.users.email, `%${query}%`),
    );
    const conditions = eventId
      ? and(
          eq(schema.users.role, "attendee"),
          eq(schema.users.eventId, eventId),
          nameOrEmail,
        )
      : and(eq(schema.users.role, "attendee"), nameOrEmail);

    const results = await db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        photoUrl: schema.users.photoUrl,
      })
      .from(schema.users)
      .where(conditions)
      .limit(20);
    return results;
  }

  async getTimetableItems(eventId?: string): Promise<schema.TimetableItem[]> {
    if (eventId) {
      return db
        .select()
        .from(schema.timetableItems)
        .where(eq(schema.timetableItems.eventId, eventId))
        .orderBy(schema.timetableItems.sortOrder);
    }
    return db
      .select()
      .from(schema.timetableItems)
      .orderBy(schema.timetableItems.sortOrder);
  }

  async getStarterTimetableItems(
    eventId: string,
  ): Promise<schema.TimetableItem[]> {
    return await db
      .select()
      .from(schema.timetableItems)
      .where(
        and(
          eq(schema.timetableItems.eventId, eventId),
          like(
            schema.timetableItems.activity1,
            `${schema.STARTER_TIMETABLE_PREFIX}%`,
          ),
        ),
      )
      .orderBy(schema.timetableItems.sortOrder);
  }

  async getSupportContacts(): Promise<schema.SupportContact[]> {
    return db
      .select()
      .from(schema.supportContacts)
      .orderBy(schema.supportContacts.sortOrder);
  }

  async isInvitedToDinner(userId: string): Promise<boolean> {
    const [invite] = await db
      .select()
      .from(schema.dinnerInvites)
      .where(eq(schema.dinnerInvites.userId, userId));
    return !!invite;
  }

  async createNotification(
    title: string,
    message: string,
    type: string,
    targetRole?: string,
    eventId?: string,
  ): Promise<schema.Notification> {
    const [notification] = await db
      .insert(schema.notifications)
      .values({
        title,
        message,
        type,
        targetRole: targetRole || null,
        eventId: eventId || null,
      })
      .returning();
    return notification;
  }

  async createUserAdmin(
    email: string,
    name: string,
    role: string,
    passwordHash: string | null,
    eventId?: string,
  ): Promise<schema.User> {
    if (role !== "admin" && !eventId) {
      throw new Error(
        "An event is required when creating an attendee or staff member",
      );
    }
    const qrCodeValue = `SC-${role.toUpperCase().slice(0, 3)}-${randomUUID()}`;
    const [user] = await db
      .insert(schema.users)
      .values({
        email: normalizeStoredEmail(email),
        name: name.trim(),
        role,
        qrCodeValue,
        passwordHash,
        eventId: eventId || null,
      })
      .returning();
    return user;
  }

  async updateUser(
    id: string,
    data: {
      name?: string;
      email?: string;
      role?: string;
      passwordHash?: string | null;
      photoUrl?: string | null;
    },
  ): Promise<schema.User> {
    const normalizedData =
      data.email !== undefined
        ? { ...data, email: normalizeStoredEmail(data.email) }
        : data;
    return db.transaction(async (tx) => {
      const [currentUser] = await tx
        .select({
          role: schema.users.role,
          eventId: schema.users.eventId,
        })
        .from(schema.users)
        .where(eq(schema.users.id, id));
      if (
        currentUser?.eventId === null &&
        data.role !== undefined &&
        data.role !== "admin"
      ) {
        throw new Error("Global admin accounts must remain administrators");
      }
      if (normalizedData.passwordHash !== undefined) {
        const [passwordRecord] = await tx
          .select({ passwordHash: schema.users.passwordHash })
          .from(schema.users)
          .where(eq(schema.users.id, id));
        if (passwordRecord?.passwordHash) {
          await tx.insert(schema.passwordHistory).values({
            userId: id,
            passwordHash: passwordRecord.passwordHash,
          });
        }
      }
      const updateData =
        normalizedData.passwordHash !== undefined
          ? {
              ...normalizedData,
              passwordVersion: sql`${schema.users.passwordVersion} + 1`,
            }
          : normalizedData;
      const [user] = await tx
        .update(schema.users)
        .set(updateData)
        .where(eq(schema.users.id, id))
        .returning();
      return user;
    });
  }

  async deleteUser(id: string): Promise<void> {
    await db.transaction(async (tx) => {
      // Delete active sessions explicitly so deletion remains revoking even if
      // an older database was created before the cascade constraint existed.
      await tx
        .delete(schema.authSessions)
        .where(eq(schema.authSessions.userId, id));
      await tx
        .delete(schema.userCaseStudies)
        .where(eq(schema.userCaseStudies.userId, id));
      await tx
        .delete(schema.savedSessions)
        .where(eq(schema.savedSessions.userId, id));
      await tx
        .delete(schema.userNotifications)
        .where(eq(schema.userNotifications.userId, id));
      await tx
        .delete(schema.dinnerInvites)
        .where(eq(schema.dinnerInvites.userId, id));
      // Compliance and security history is retained permanently, even when
      // the user account is removed. Reset/password history cascades safely.
      await tx.delete(schema.users).where(eq(schema.users.id, id));
    });
  }

  async getUserExportData(id: string): Promise<Record<string, any>> {
    const user = await this.getUserById(id);
    if (!user) throw new Error("User not found");

    const caseStudies = await db
      .select({
        caseStudy: schema.caseStudies,
        assignedAt: schema.userCaseStudies.assignedAt,
        checkedIn: schema.userCaseStudies.checkedIn,
        checkedInAt: schema.userCaseStudies.checkedInAt,
      })
      .from(schema.userCaseStudies)
      .innerJoin(
        schema.caseStudies,
        eq(schema.userCaseStudies.caseStudyId, schema.caseStudies.id),
      )
      .where(eq(schema.userCaseStudies.userId, id));

    const loginEventsData = await db
      .select()
      .from(schema.loginEvents)
      .where(
        and(
          eq(schema.loginEvents.email, user.email),
          user.eventId
            ? eq(schema.loginEvents.eventId, user.eventId)
            : isNull(schema.loginEvents.eventId),
        ),
      )
      .orderBy(desc(schema.loginEvents.createdAt));

    const notificationsData = await db
      .select({
        notification: schema.notifications,
        read: schema.userNotifications.read,
        createdAt: schema.userNotifications.createdAt,
      })
      .from(schema.userNotifications)
      .innerJoin(
        schema.notifications,
        eq(schema.userNotifications.notificationId, schema.notifications.id),
      )
      .where(eq(schema.userNotifications.userId, id))
      .orderBy(desc(schema.userNotifications.createdAt));

    return {
      exportedAt: new Date().toISOString(),
      profile: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        checkedIn: user.checkedIn,
        checkedInAt: user.checkedInAt?.toISOString() || null,
        createdAt: user.createdAt?.toISOString() || null,
        eventId: user.eventId || null,
      },
      caseStudyAssignments: caseStudies.map((c) => ({
        caseId: c.caseStudy.caseId,
        company: c.caseStudy.company,
        title: c.caseStudy.title,
        type: c.caseStudy.type,
        room: c.caseStudy.room || null,
        assignedAt: c.assignedAt?.toISOString() || null,
        checkedIn: c.checkedIn,
        checkedInAt: c.checkedInAt?.toISOString() || null,
      })),
      loginHistory: loginEventsData.map((e) => ({
        eventType: e.eventType,
        createdAt: e.createdAt.toISOString(),
      })),
      notifications: notificationsData.map((n) => ({
        title: n.notification.title,
        message: n.notification.message,
        type: n.notification.type,
        read: n.read,
        createdAt: n.createdAt?.toISOString() || null,
      })),
    };
  }

  async deleteAllNonAdminUsers(eventId?: string): Promise<void> {
    let q = db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(ne(schema.users.role, "admin"));
    if (eventId) {
      q = (q as any).where(
        and(ne(schema.users.role, "admin"), eq(schema.users.eventId, eventId)),
      );
    }
    const nonAdmins = await q;
    for (const { id } of nonAdmins) {
      await this.deleteUser(id);
    }
  }

  async createSpeaker(data: {
    name: string;
    title?: string | null;
    bio?: string | null;
    photoUrl?: string | null;
    company?: string | null;
    email?: string | null;
    linkedin?: string | null;
    sortOrder?: number;
    eventId?: string;
  }): Promise<schema.Speaker> {
    const [speaker] = await db
      .insert(schema.speakers)
      .values({
        ...data,
        sortOrder: data.sortOrder ?? 0,
        eventId: data.eventId || null,
      })
      .returning();
    return speaker;
  }

  async updateSpeaker(
    id: string,
    data: {
      name?: string;
      title?: string | null;
      bio?: string | null;
      photoUrl?: string | null;
      company?: string | null;
      email?: string | null;
      linkedin?: string | null;
    },
  ): Promise<schema.Speaker> {
    const [speaker] = await db
      .update(schema.speakers)
      .set(data)
      .where(eq(schema.speakers.id, id))
      .returning();
    return speaker;
  }

  async deleteSpeaker(id: string): Promise<void> {
    await db.delete(schema.speakers).where(eq(schema.speakers.id, id));
  }

  async deleteAllSpeakers(eventId?: string): Promise<void> {
    if (eventId) {
      await db
        .delete(schema.speakers)
        .where(eq(schema.speakers.eventId, eventId));
    } else {
      await db.delete(schema.speakers);
    }
  }

  async createCompany(data: {
    name: string;
    category: string;
    description?: string | null;
    logoUrl?: string | null;
    websiteUrl?: string | null;
    sortOrder?: number;
    eventId?: string;
  }): Promise<schema.Company> {
    const [company] = await db
      .insert(schema.companies)
      .values({
        ...data,
        sortOrder: data.sortOrder ?? 0,
        eventId: data.eventId || null,
      })
      .returning();
    return company;
  }

  async updateCompany(
    id: string,
    data: {
      name?: string;
      category?: string;
      description?: string | null;
      logoUrl?: string | null;
      websiteUrl?: string | null;
    },
  ): Promise<schema.Company> {
    const [company] = await db
      .update(schema.companies)
      .set(data)
      .where(eq(schema.companies.id, id))
      .returning();
    return company;
  }

  async deleteCompany(id: string): Promise<void> {
    await db.delete(schema.companies).where(eq(schema.companies.id, id));
  }

  async deleteAllCompanies(eventId?: string): Promise<void> {
    if (eventId) {
      await db
        .delete(schema.companies)
        .where(eq(schema.companies.eventId, eventId));
    } else {
      await db.delete(schema.companies);
    }
  }

  async reorderCompanies(
    items: { id: string; sortOrder: number }[],
  ): Promise<void> {
    await Promise.all(
      items.map(({ id, sortOrder }) =>
        db
          .update(schema.companies)
          .set({ sortOrder })
          .where(eq(schema.companies.id, id)),
      ),
    );
  }

  async deleteAllEvents(): Promise<void> {
    const events = await db
      .select({ id: schema.events.id })
      .from(schema.events);
    for (const event of events) {
      await this.deleteEvent(event.id);
    }
  }

  async createTimetableItem(data: {
    time: string;
    activity1: string;
    activity2?: string | null;
    duration: string;
    location?: string | null;
    category?: string;
    sortOrder?: number;
    eventId?: string;
  }): Promise<schema.TimetableItem> {
    const [item] = await db
      .insert(schema.timetableItems)
      .values({
        ...data,
        category: data.category ?? "session",
        sortOrder: data.sortOrder ?? 0,
        eventId: data.eventId || null,
      })
      .returning();
    return item;
  }

  async updateTimetableItem(
    id: string,
    data: {
      time?: string;
      activity1?: string;
      activity2?: string | null;
      duration?: string;
      location?: string | null;
      category?: string;
      sortOrder?: number;
    },
  ): Promise<schema.TimetableItem> {
    const [item] = await db
      .update(schema.timetableItems)
      .set(data)
      .where(eq(schema.timetableItems.id, id))
      .returning();
    return item;
  }

  async deleteTimetableItem(id: string): Promise<void> {
    await db
      .delete(schema.timetableItems)
      .where(eq(schema.timetableItems.id, id));
  }

  async deleteAllTimetableItems(eventId?: string): Promise<void> {
    if (eventId) {
      await db
        .delete(schema.timetableItems)
        .where(eq(schema.timetableItems.eventId, eventId));
    } else {
      await db.delete(schema.timetableItems);
    }
  }

  async reorderTimetableItems(
    items: { id: string; sortOrder: number }[],
  ): Promise<void> {
    await Promise.all(
      items.map(({ id, sortOrder }) =>
        db
          .update(schema.timetableItems)
          .set({ sortOrder })
          .where(eq(schema.timetableItems.id, id)),
      ),
    );
  }

  async createCaseStudy(data: {
    caseId: string;
    company: string;
    title: string;
    type: string;
    duration: string;
    description?: string | null;
    room?: string | null;
    sortOrder?: number;
    eventId?: string;
  }): Promise<schema.CaseStudy> {
    const [cs] = await db
      .insert(schema.caseStudies)
      .values({
        ...data,
        sortOrder: data.sortOrder ?? 0,
        eventId: data.eventId || null,
      })
      .returning();
    return cs;
  }

  async updateCaseStudy(
    id: string,
    data: {
      company?: string;
      title?: string;
      type?: string;
      duration?: string;
      description?: string | null;
      room?: string | null;
    },
  ): Promise<schema.CaseStudy> {
    const [cs] = await db
      .update(schema.caseStudies)
      .set(data)
      .where(eq(schema.caseStudies.id, id))
      .returning();
    return cs;
  }

  async deleteCaseStudy(id: string): Promise<void> {
    await db
      .delete(schema.userCaseStudies)
      .where(eq(schema.userCaseStudies.caseStudyId, id));
    await db.delete(schema.caseStudies).where(eq(schema.caseStudies.id, id));
  }

  async deleteAllCaseStudies(eventId?: string): Promise<void> {
    if (eventId) {
      const css = await db
        .select({ id: schema.caseStudies.id })
        .from(schema.caseStudies)
        .where(eq(schema.caseStudies.eventId, eventId));
      for (const { id } of css) {
        await db
          .delete(schema.userCaseStudies)
          .where(eq(schema.userCaseStudies.caseStudyId, id));
      }
      await db
        .delete(schema.caseStudies)
        .where(eq(schema.caseStudies.eventId, eventId));
    } else {
      await db.delete(schema.userCaseStudies);
      await db.delete(schema.caseStudies);
    }
  }

  async reorderCaseStudies(
    items: { id: string; sortOrder: number }[],
  ): Promise<void> {
    await Promise.all(
      items.map(({ id, sortOrder }) =>
        db
          .update(schema.caseStudies)
          .set({ sortOrder })
          .where(eq(schema.caseStudies.id, id)),
      ),
    );
  }

  async unassignCaseStudy(userId: string, caseStudyId: string): Promise<void> {
    await db
      .delete(schema.userCaseStudies)
      .where(
        and(
          eq(schema.userCaseStudies.userId, userId),
          eq(schema.userCaseStudies.caseStudyId, caseStudyId),
        ),
      );
  }

  async removeCaseStudyAssignment(
    userId: string,
    caseStudyId: string,
  ): Promise<void> {
    return this.unassignCaseStudy(userId, caseStudyId);
  }

  async getAdminStats(eventId?: string): Promise<{
    users: number;
    speakers: number;
    companies: number;
    caseStudies: number;
    timetable: number;
    notifications: number;
  }> {
    if (eventId) {
      const [u] = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.users)
        .where(
          or(
            eq(schema.users.eventId, eventId),
            and(isNull(schema.users.eventId), eq(schema.users.role, "admin")),
          ),
        );
      const [sp] = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.speakers)
        .where(eq(schema.speakers.eventId, eventId));
      const [co] = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.companies)
        .where(eq(schema.companies.eventId, eventId));
      const [cs] = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.caseStudies)
        .where(eq(schema.caseStudies.eventId, eventId));
      const [ti] = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.timetableItems)
        .where(eq(schema.timetableItems.eventId, eventId));
      const [no] = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.notifications)
        .where(
          or(
            eq(schema.notifications.eventId, eventId),
            isNull(schema.notifications.eventId),
          ),
        );
      return {
        users: Number(u.count),
        speakers: Number(sp.count),
        companies: Number(co.count),
        caseStudies: Number(cs.count),
        timetable: Number(ti.count),
        notifications: Number(no.count),
      };
    }
    const [u] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.users);
    const [sp] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.speakers);
    const [co] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.companies);
    const [cs] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.caseStudies);
    const [ti] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.timetableItems);
    const [no] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.notifications);
    return {
      users: Number(u.count),
      speakers: Number(sp.count),
      companies: Number(co.count),
      caseStudies: Number(cs.count),
      timetable: Number(ti.count),
      notifications: Number(no.count),
    };
  }

  async seedData(): Promise<void> {
    // ── Admin bootstrap from environment variables ────────────────────────────
    // ADMIN_EMAIL + ADMIN_PASSWORD are the single source of truth for the admin
    // account. On every startup:
    //   • Any admin with a different email is deleted.
    //   • If an admin with the right email exists, their password is updated.
    //   • If no admin exists yet, one is created.
    // Credentials are NEVER stored in code — they come from environment secrets.
    const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD?.trim();

    if (adminEmail && adminPassword) {
      // Remove any admin accounts that don't match the configured email
      await db
        .delete(schema.users)
        .where(
          and(
            eq(schema.users.role, "admin"),
            ne(schema.users.email, adminEmail),
          ),
        );

      const hash = await bcrypt.hash(adminPassword, 12);
      const [existing] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, adminEmail))
        .limit(1);

      if (existing) {
        // Update email (already matches) and refresh password hash
        await db
          .update(schema.users)
          .set({ passwordHash: hash, role: "admin" })
          .where(eq(schema.users.id, existing.id));
        console.log(
          JSON.stringify({ event: "admin_bootstrap", outcome: "synced" }),
        );
      } else {
        await db.insert(schema.users).values({
          email: adminEmail,
          name: "Admin",
          role: "admin",
          passwordHash: hash,
          qrCodeValue: `admin-${randomUUID()}`,
          eventId: null,
        });
        console.log(
          JSON.stringify({ event: "admin_bootstrap", outcome: "created" }),
        );
      }
    } else {
      console.log(
        "Database ready — set ADMIN_EMAIL + ADMIN_PASSWORD env vars to configure the admin account",
      );
    }

    const [legacyGlobalStaff] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.users)
      .where(and(eq(schema.users.role, "staff"), isNull(schema.users.eventId)));
    if (Number(legacyGlobalStaff?.count ?? 0) > 0) {
      console.warn(
        JSON.stringify({
          event: "legacy_global_staff_accounts_detected",
          count: Number(legacyGlobalStaff.count),
          action: "not_modified",
          remediation:
            "Create an event-scoped replacement account before removing the legacy record.",
        }),
      );
    }
  }

  // ─── Events ───────────────────────────────────────────────────────────────────
  async getEvents(): Promise<schema.Event[]> {
    return db.select().from(schema.events).orderBy(desc(schema.events.year));
  }

  async getEventById(id: string): Promise<schema.Event | undefined> {
    const [ev] = await db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, id));
    return ev;
  }

  async getActiveEvent(): Promise<schema.Event | undefined> {
    const [ev] = await db
      .select()
      .from(schema.events)
      .where(eq(schema.events.status, "published"))
      .orderBy(desc(schema.events.lastPublishedAt), desc(schema.events.year));
    return ev;
  }

  async createEvent(data: {
    name: string;
    year: number;
    startDate?: string;
    endDate?: string;
    scheduleStart?: string | null;
    scheduleEnd?: string | null;
    location?: string;
    description?: string;
    logoUrl?: string | null;
    logoShape?: "circle" | "square";
    logoZoom?: number;
    logoOffsetX?: number;
    logoOffsetY?: number;
    primaryColor?: string;
    accentColor?: string;
    gradientStart?: string;
    gradientEnd?: string;
    tagline?: string;
    displayDate?: string;
    showYearOnLogin?: boolean;
  }): Promise<schema.Event> {
    const [ev] = await db
      .insert(schema.events)
      .values({
        name: data.name,
        year: data.year,
        startDate: data.startDate ?? null,
        endDate: data.endDate ?? null,
        scheduleStart: data.scheduleStart ?? null,
        scheduleEnd: data.scheduleEnd ?? null,
        location: data.location ?? null,
        description: data.description ?? null,
        logoUrl: data.logoUrl ?? null,
        logoShape: data.logoShape === "circle" ? "circle" : "square",
        logoZoom: data.logoZoom ?? 100,
        logoOffsetX: data.logoOffsetX ?? 0,
        logoOffsetY: data.logoOffsetY ?? 0,
        primaryColor: data.primaryColor ?? "#0c0057",
        accentColor: data.accentColor ?? "#f78f1e",
        gradientStart: data.gradientStart ?? "#0c0057",
        gradientEnd: data.gradientEnd ?? "#1a0a7a",
        tagline: data.tagline ?? null,
        displayDate: data.displayDate ?? null,
        showYearOnLogin: data.showYearOnLogin ?? true,
        status: "draft",
      })
      .returning();
    await db
      .insert(schema.timetableItems)
      .values(STARTER_TIMETABLE.map((item) => ({ ...item, eventId: ev.id })));
    return ev;
  }

  async updateEvent(
    id: string,
    data: {
      name?: string;
      year?: number;
      startDate?: string | null;
      endDate?: string | null;
      scheduleStart?: string | null;
      scheduleEnd?: string | null;
      location?: string | null;
      description?: string | null;
      logoUrl?: string | null;
      logoShape?: "circle" | "square";
      logoZoom?: number;
      logoOffsetX?: number;
      logoOffsetY?: number;
      primaryColor?: string | null;
      accentColor?: string | null;
      gradientStart?: string | null;
      gradientEnd?: string | null;
      tagline?: string | null;
      displayDate?: string | null;
      showYearOnLogin?: boolean;
    },
  ): Promise<schema.Event> {
    const [ev] = await db
      .update(schema.events)
      .set(data)
      .where(eq(schema.events.id, id))
      .returning();
    return ev;
  }

  async publishEventUpdates(id: string): Promise<schema.Event> {
    const [ev] = await db
      .update(schema.events)
      .set({ lastPublishedAt: new Date() })
      .where(eq(schema.events.id, id))
      .returning();
    return ev;
  }

  async deleteAllNotifications(eventId: string): Promise<void> {
    // Delete read-receipts first (foreign key on notification id), then the notifications
    const notifIds = await db
      .select({ id: schema.notifications.id })
      .from(schema.notifications)
      .where(eq(schema.notifications.eventId, eventId));
    for (const { id } of notifIds) {
      await db
        .delete(schema.userNotifications)
        .where(eq(schema.userNotifications.notificationId, id));
    }
    await db
      .delete(schema.notifications)
      .where(eq(schema.notifications.eventId, eventId));
  }

  async deleteEvent(id: string): Promise<void> {
    // Delete the complete event tree in one transaction. GDPR requests,
    // audit logs, login events, and reset-token history intentionally do not
    // participate in this cleanup.
    await db.transaction(async (tx) => {
      const eventUserIds = tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(
          and(eq(schema.users.eventId, id), ne(schema.users.role, "admin")),
        );
      const eventCaseStudyIds = tx
        .select({ id: schema.caseStudies.id })
        .from(schema.caseStudies)
        .where(eq(schema.caseStudies.eventId, id));
      const eventNotificationIds = tx
        .select({ id: schema.notifications.id })
        .from(schema.notifications)
        .where(eq(schema.notifications.eventId, id));
      const eventSessionIds = tx
        .select({ id: schema.sessions.id })
        .from(schema.sessions)
        .where(eq(schema.sessions.eventId, id));

      await tx
        .delete(schema.userNotifications)
        .where(
          or(
            inArray(schema.userNotifications.userId, eventUserIds),
            inArray(
              schema.userNotifications.notificationId,
              eventNotificationIds,
            ),
          ),
        );
      await tx
        .delete(schema.userCaseStudies)
        .where(
          or(
            inArray(schema.userCaseStudies.userId, eventUserIds),
            inArray(schema.userCaseStudies.caseStudyId, eventCaseStudyIds),
          ),
        );
      await tx
        .delete(schema.savedSessions)
        .where(
          or(
            inArray(schema.savedSessions.userId, eventUserIds),
            inArray(schema.savedSessions.sessionId, eventSessionIds),
          ),
        );
      await tx
        .delete(schema.dinnerInvites)
        .where(inArray(schema.dinnerInvites.userId, eventUserIds));
      await tx.delete(schema.sessions).where(eq(schema.sessions.eventId, id));
      await tx.delete(schema.speakers).where(eq(schema.speakers.eventId, id));
      await tx
        .delete(schema.caseStudies)
        .where(eq(schema.caseStudies.eventId, id));
      await tx
        .delete(schema.timetableItems)
        .where(eq(schema.timetableItems.eventId, id));
      await tx
        .delete(schema.notifications)
        .where(eq(schema.notifications.eventId, id));
      await tx.delete(schema.companies).where(eq(schema.companies.eventId, id));
      await tx
        .delete(schema.users)
        .where(
          and(eq(schema.users.eventId, id), ne(schema.users.role, "admin")),
        );
      await tx.delete(schema.events).where(eq(schema.events.id, id));
    });
  }

  async publishEvent(id: string): Promise<schema.Event> {
    return db.transaction(async (tx) => {
      // Serialize the archive-and-publish sequence across all application
      // workers. The unique partial index added by migration 0030 remains the
      // final guard for writers that bypass this method.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext('stress-congress:publish-event'))`,
      );
      await tx
        .update(schema.events)
        .set({ status: "archived" })
        .where(eq(schema.events.status, "published"));
      const [ev] = await tx
        .update(schema.events)
        .set({ status: "published", lastPublishedAt: new Date() })
        .where(eq(schema.events.id, id))
        .returning();
      if (!ev) throw new Error("Event not found");
      return ev;
    });
  }

  async archiveEvent(id: string): Promise<schema.Event> {
    const [ev] = await db
      .update(schema.events)
      .set({ status: "archived" })
      .where(eq(schema.events.id, id))
      .returning();
    return ev;
  }

  async createResetToken(
    userId: string,
    email: string,
    code: string,
    expiresAt: Date,
    purpose: "reset" | "activation" = "reset",
  ): Promise<void> {
    await db
      .delete(schema.passwordResetTokens)
      .where(
        and(
          eq(schema.passwordResetTokens.userId, userId),
          eq(schema.passwordResetTokens.purpose, purpose),
        ),
      );
    await db.insert(schema.passwordResetTokens).values({
      userId,
      email,
      code: await bcrypt.hash(code, 10),
      expiresAt,
      purpose,
      attempts: 0,
    });
  }

  async deleteResetTokens(
    userId: string,
    purpose?: "reset" | "activation",
  ): Promise<void> {
    await db
      .delete(schema.passwordResetTokens)
      .where(
        purpose
          ? and(
              eq(schema.passwordResetTokens.userId, userId),
              eq(schema.passwordResetTokens.purpose, purpose),
            )
          : eq(schema.passwordResetTokens.userId, userId),
      );
  }

  async getResetTokenCooldownSeconds(
    userId: string,
    purpose: "reset" | "activation" = "reset",
  ): Promise<number> {
    const [token] = await db
      .select({ createdAt: schema.passwordResetTokens.createdAt })
      .from(schema.passwordResetTokens)
      .where(
        and(
          eq(schema.passwordResetTokens.userId, userId),
          eq(schema.passwordResetTokens.purpose, purpose),
        ),
      )
      .orderBy(desc(schema.passwordResetTokens.createdAt))
      .limit(1);

    if (!token) return 0;
    return Math.max(
      0,
      Math.ceil(30 - (Date.now() - token.createdAt.getTime()) / 1000),
    );
  }

  async verifyResetToken(
    userId: string,
    email: string,
    code: string,
    purpose: "reset" | "activation" = "reset",
  ): Promise<ResetTokenVerification> {
    const [token] = await db
      .select()
      .from(schema.passwordResetTokens)
      .where(
        and(
          eq(schema.passwordResetTokens.userId, userId),
          eq(schema.passwordResetTokens.email, email),
          eq(schema.passwordResetTokens.used, false),
          eq(schema.passwordResetTokens.purpose, purpose),
        ),
      );
    if (!token) return { valid: false, reason: "not_found" };
    if (new Date() > token.expiresAt)
      return { valid: false, reason: "expired" };
    if (token.attempts >= 5)
      return { valid: false, reason: "attempts_exceeded" };
    const matches = await bcrypt.compare(code, token.code);
    if (!matches) {
      const [updatedToken] = await db
        .update(schema.passwordResetTokens)
        .set({
          attempts: sql`${schema.passwordResetTokens.attempts} + 1`,
        })
        .where(
          and(
            eq(schema.passwordResetTokens.id, token.id),
            eq(schema.passwordResetTokens.used, false),
            lt(schema.passwordResetTokens.attempts, 5),
          ),
        )
        .returning({ attempts: schema.passwordResetTokens.attempts });
      if (!updatedToken || updatedToken.attempts >= 5) {
        return { valid: false, reason: "attempts_exceeded" };
      }
      return {
        valid: false,
        reason: "invalid_code",
        attemptsRemaining: 5 - updatedToken.attempts,
      };
    }
    return { valid: true };
  }

  async markResetTokenUsed(
    userId: string,
    email: string,
    code: string,
    purpose: "reset" | "activation" = "reset",
  ): Promise<boolean> {
    const candidates = await db
      .select()
      .from(schema.passwordResetTokens)
      .where(
        and(
          eq(schema.passwordResetTokens.userId, userId),
          eq(schema.passwordResetTokens.email, email),
          eq(schema.passwordResetTokens.used, false),
          eq(schema.passwordResetTokens.purpose, purpose),
        ),
      );
    const now = new Date();
    for (const token of candidates) {
      if (token.expiresAt <= now || token.attempts >= 5) continue;
      if (await bcrypt.compare(code, token.code)) {
        const consumed = await db
          .update(schema.passwordResetTokens)
          .set({ used: true, completedAt: new Date() })
          .where(
            and(
              eq(schema.passwordResetTokens.id, token.id),
              eq(schema.passwordResetTokens.used, false),
            ),
          );
        return (consumed.rowCount ?? 0) > 0;
      }
    }
    return false;
  }

  async consumeResetTokenAndSetPassword(
    userId: string,
    email: string,
    code: string,
    passwordHash: string,
    purpose: "reset" | "activation",
    requireUninitializedAccount: boolean,
  ): Promise<boolean> {
    const candidates = await db
      .select()
      .from(schema.passwordResetTokens)
      .where(
        and(
          eq(schema.passwordResetTokens.userId, userId),
          eq(schema.passwordResetTokens.email, email),
          eq(schema.passwordResetTokens.used, false),
          eq(schema.passwordResetTokens.purpose, purpose),
        ),
      );

    const now = new Date();
    for (const token of candidates) {
      if (token.expiresAt <= now || token.attempts >= 5) continue;
      if (!(await bcrypt.compare(code, token.code))) continue;

      try {
        return await db.transaction(async (tx) => {
          const [claimedToken] = await tx
            .update(schema.passwordResetTokens)
            .set({ used: true, completedAt: now })
            .where(
              and(
                eq(schema.passwordResetTokens.id, token.id),
                eq(schema.passwordResetTokens.used, false),
                gt(schema.passwordResetTokens.expiresAt, now),
                lt(schema.passwordResetTokens.attempts, 5),
              ),
            )
            .returning({ id: schema.passwordResetTokens.id });
          if (!claimedToken) return false;

          const userWhere = requireUninitializedAccount
            ? and(
                eq(schema.users.id, userId),
                isNull(schema.users.passwordHash),
              )
            : eq(schema.users.id, userId);
          const [currentUser] = await tx
            .select({ passwordHash: schema.users.passwordHash })
            .from(schema.users)
            .where(userWhere);
          if (currentUser?.passwordHash) {
            await tx.insert(schema.passwordHistory).values({
              userId,
              passwordHash: currentUser.passwordHash,
            });
          }
          const [updatedUser] = await tx
            .update(schema.users)
            .set({
              passwordHash,
              passwordVersion: sql`${schema.users.passwordVersion} + 1`,
            })
            .where(userWhere)
            .returning({ id: schema.users.id });

          if (!updatedUser) {
            throw new Error(
              "Password account state changed during verification",
            );
          }
          return true;
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Password account state changed during verification"
        ) {
          return false;
        }
        throw error;
      }
    }
    return false;
  }

  async getSecurityLog(limit = 50): Promise<
    {
      email: string;
      requestedAt: string;
      status: string;
      completedAt: string | null;
    }[]
  > {
    const tokens = await db
      .select()
      .from(schema.passwordResetTokens)
      .orderBy(desc(schema.passwordResetTokens.createdAt))
      .limit(limit);
    return tokens.map((t) => ({
      email: t.email,
      requestedAt: t.createdAt.toISOString(),
      status: t.used
        ? "completed"
        : new Date() > t.expiresAt
          ? "expired"
          : "pending",
      completedAt: t.completedAt?.toISOString() || null,
    }));
  }

  async logLoginEvent(
    email: string,
    eventType: string,
    eventId?: string | null,
  ): Promise<void> {
    await db.insert(schema.loginEvents).values({ email, eventType, eventId });
  }

  async getLoginEvents(
    limit = 300,
    eventId?: string,
  ): Promise<schema.LoginEvent[]> {
    return db
      .select()
      .from(schema.loginEvents)
      .where(eventId ? eq(schema.loginEvents.eventId, eventId) : undefined)
      .orderBy(desc(schema.loginEvents.createdAt))
      .limit(limit);
  }

  async getUsersWithoutPasswords(): Promise<schema.User[]> {
    return db
      .select()
      .from(schema.users)
      .where(isNull(schema.users.passwordHash))
      .orderBy(schema.users.name);
  }

  async logAuditAction(
    adminId: string,
    adminEmail: string,
    action: string,
    targetId?: string,
    targetType?: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    const auditEntry = {
      adminId,
      adminEmail,
      action,
      targetId: targetId || null,
      targetType: targetType || null,
      metadata: metadata ? JSON.stringify(metadata) : null,
    };

    await writeAuditRecord(
      () => db.insert(schema.adminAuditLog).values(auditEntry),
      { action, targetType },
    );
  }

  async getAuditLog(
    limit = 100,
    eventId?: string,
  ): Promise<schema.AdminAuditLog[]> {
    return db
      .select()
      .from(schema.adminAuditLog)
      .where(
        eventId
          ? ilike(schema.adminAuditLog.metadata, `%"eventId":"${eventId}"%`)
          : undefined,
      )
      .orderBy(desc(schema.adminAuditLog.createdAt))
      .limit(limit);
  }

  async getAuditEventScopes(): Promise<AuditEventScope[]> {
    const records = await db
      .select({
        metadata: schema.adminAuditLog.metadata,
        createdAt: schema.adminAuditLog.createdAt,
      })
      .from(schema.adminAuditLog)
      .where(sql`${schema.adminAuditLog.metadata} IS NOT NULL`);
    const scopes = new Map<string, AuditEventScope>();

    for (const record of records) {
      if (!record.metadata) continue;
      try {
        const metadata: unknown = JSON.parse(record.metadata);
        if (!metadata || typeof metadata !== "object") continue;
        const eventId = (metadata as { eventId?: unknown }).eventId;
        if (typeof eventId !== "string" || !eventId.trim()) continue;

        const eventName = (metadata as { eventName?: unknown }).eventName;
        const eventYear = (metadata as { eventYear?: unknown }).eventYear;
        const parsedYear =
          typeof eventYear === "number" && Number.isInteger(eventYear)
            ? eventYear
            : 0;
        const candidate = {
          id: eventId,
          name:
            typeof eventName === "string" && eventName.trim()
              ? eventName
              : `Event ${parsedYear || eventId}`,
          year: parsedYear,
          createdAt: record.createdAt,
        };
        const existing = scopes.get(eventId);
        if (
          !existing ||
          (candidate.year > 0 && existing.year === 0) ||
          (candidate.name !== `Event ${eventId}` &&
            existing.name === `Event ${eventId}`) ||
          candidate.createdAt > existing.createdAt
        ) {
          scopes.set(eventId, candidate);
        }
      } catch {
        // Ignore older or malformed audit metadata while retaining valid scopes.
      }
    }

    return [...scopes.values()].sort(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() ||
        b.year - a.year ||
        a.name.localeCompare(b.name),
    );
  }

  async getAuditLogPage(options: AuditLogQuery): Promise<AuditLogPage> {
    const pageSize = Math.min(
      Math.max(Math.floor(options.pageSize ?? 25), 1),
      100,
    );
    const page = Math.max(Math.floor(options.page ?? 1), 1);
    const conditions = [];

    if (options.search?.trim()) {
      const term = `%${options.search.trim()}%`;
      conditions.push(
        or(
          ilike(schema.adminAuditLog.adminEmail, term),
          ilike(schema.adminAuditLog.action, term),
          ilike(schema.adminAuditLog.targetId, term),
          ilike(schema.adminAuditLog.targetType, term),
          ilike(schema.adminAuditLog.metadata, term),
        ),
      );
    }
    if (options.event)
      conditions.push(
        ilike(schema.adminAuditLog.metadata, `%"eventId":"${options.event}"%`),
      );
    if (options.action)
      conditions.push(eq(schema.adminAuditLog.action, options.action));
    if (options.outcome) {
      const outcome = `%\"outcome\"%${options.outcome}%`;
      conditions.push(ilike(schema.adminAuditLog.metadata, outcome));
    }
    if (options.dateFrom)
      conditions.push(
        gte(
          schema.adminAuditLog.createdAt,
          new Date(`${options.dateFrom}T00:00:00.000Z`),
        ),
      );
    if (options.dateTo)
      conditions.push(
        lte(
          schema.adminAuditLog.createdAt,
          new Date(`${options.dateTo}T23:59:59.999Z`),
        ),
      );

    const where = conditions.length ? and(...conditions) : undefined;
    const [entries, totalResult] = await Promise.all([
      db
        .select()
        .from(schema.adminAuditLog)
        .where(where)
        .orderBy(desc(schema.adminAuditLog.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ count: count() }).from(schema.adminAuditLog).where(where),
    ]);
    const total = Number(totalResult[0]?.count ?? 0);
    return {
      entries,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async savePushToken(userId: string, token: string | null): Promise<void> {
    await db
      .update(schema.users)
      .set({ pushToken: token })
      .where(eq(schema.users.id, userId));
  }

  async saveDevicePushToken(
    userId: string,
    deviceId: string,
    token: string | null,
  ): Promise<void> {
    await db
      .insert(schema.notificationDevices)
      .values({ userId, deviceId, pushToken: token })
      .onConflictDoUpdate({
        target: [
          schema.notificationDevices.userId,
          schema.notificationDevices.deviceId,
        ],
        set: { pushToken: token },
      });
  }

  async getNotificationPreferences(userId: string, deviceId: string) {
    const [device] = await db
      .select()
      .from(schema.notificationDevices)
      .where(
        and(
          eq(schema.notificationDevices.userId, userId),
          eq(schema.notificationDevices.deviceId, deviceId),
        ),
      );
    return {
      pushEnabled: device?.pushEnabled ?? true,
      sessionAlerts: device?.sessionAlerts ?? true,
    };
  }

  async updateNotificationPreferences(
    userId: string,
    deviceId: string,
    preferences: {
      pushEnabled?: boolean;
      sessionAlerts?: boolean;
    },
  ) {
    const [device] = await db
      .insert(schema.notificationDevices)
      .values({ userId, deviceId, ...preferences })
      .onConflictDoUpdate({
        target: [
          schema.notificationDevices.userId,
          schema.notificationDevices.deviceId,
        ],
        set: preferences,
      })
      .returning();
    return device;
  }

  /**
   * Returns registered Expo push tokens for the notification audience.
   *
   * @param eventId  - When provided, attendees are scoped to this event.
   *                   Staff are included only when explicitly assigned to that event.
   * @param roleFilter - "all" | "attendee" | "staff" | undefined → mirrors the
   *                     targetRole field on a notification.  "all" / undefined means
   *                     everyone non-admin; "attendee" or "staff" limits to that role.
   */
  async getAttendeePushTokens(
    eventId?: string,
    roleFilter?: string | null,
    notificationType?: string,
  ): Promise<{ userId: string; token: string }[]> {
    const rows = await db
      .select({
        userId: schema.users.id,
        token: schema.users.pushToken,
        role: schema.users.role,
        userEventId: schema.users.eventId,
      })
      .from(schema.users)
      .where(ne(schema.users.role, "admin"));

    const normalised = roleFilter && roleFilter !== "all" ? roleFilter : null;

    const deviceRows = await db
      .select({
        userId: schema.notificationDevices.userId,
        deviceId: schema.notificationDevices.deviceId,
        token: schema.notificationDevices.pushToken,
        pushEnabled: schema.notificationDevices.pushEnabled,
        sessionAlerts: schema.notificationDevices.sessionAlerts,
        role: schema.users.role,
        userEventId: schema.users.eventId,
      })
      .from(schema.notificationDevices)
      .innerJoin(
        schema.users,
        eq(schema.users.id, schema.notificationDevices.userId),
      )
      .where(ne(schema.users.role, "admin"));

    const activeSessions = await db
      .select({
        userId: schema.authSessions.userId,
        deviceId: schema.authSessions.deviceId,
      })
      .from(schema.authSessions)
      .where(isNull(schema.authSessions.revokedAt));
    const activeDeviceKeys = new Set(
      activeSessions.map((session) => `${session.userId}:${session.deviceId}`),
    );
    const deviceTokens = deviceRows
      .filter(
        (r) =>
          activeDeviceKeys.has(`${r.userId}:${r.deviceId}`) &&
          r.pushEnabled &&
          r.token &&
          r.token.startsWith("ExponentPushToken["),
      )
      .filter(
        (r) =>
          !["alert", "session"].includes(notificationType || "") ||
          r.sessionAlerts,
      )
      .filter((r) => {
        if (normalised && r.role !== normalised) return false;
        if (r.role === "staff") {
          return Boolean(eventId) && r.userEventId === eventId;
        }
        if (eventId) return r.userEventId === eventId;
        return true;
      })
      .map((r) => ({ userId: r.userId, token: r.token! }));
    // Any device row suppresses the legacy user-level token for that user.
    // This is important when the device exists but pushEnabled is false.
    const registeredIds = new Set(deviceRows.map((r) => r.userId));
    const legacyTokens = rows
      .filter((r) => r.token && r.token.startsWith("ExponentPushToken["))
      .filter((r) => {
        // 1. Role filter — if the publisher targeted a specific role, only include that role
        if (normalised && r.role !== normalised) return false;
        // 2. Event scope — both attendees and staff must match the event
        if (r.role === "staff") {
          return Boolean(eventId) && r.userEventId === eventId;
        }
        if (eventId) return r.userEventId === eventId;
        return true;
      })
      .filter((r) => !registeredIds.has(r.userId))
      .map((r) => ({ userId: r.userId, token: r.token! }));
    return [...deviceTokens, ...legacyTokens];
  }

  async getUserPushTokens(
    userId: string,
  ): Promise<{ userId: string; token: string }[]> {
    const user = await db
      .select({ userId: schema.users.id, token: schema.users.pushToken })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    const deviceRows = await db
      .select({
        userId: schema.notificationDevices.userId,
        deviceId: schema.notificationDevices.deviceId,
        token: schema.notificationDevices.pushToken,
        pushEnabled: schema.notificationDevices.pushEnabled,
        sessionAlerts: schema.notificationDevices.sessionAlerts,
      })
      .from(schema.notificationDevices)
      .where(eq(schema.notificationDevices.userId, userId));
    const activeSessions = await db
      .select({
        deviceId: schema.authSessions.deviceId,
      })
      .from(schema.authSessions)
      .where(
        and(
          eq(schema.authSessions.userId, userId),
          isNull(schema.authSessions.revokedAt),
        ),
      );
    const activeDeviceIds = new Set(
      activeSessions.map((session) => session.deviceId),
    );
    const deviceTokens = deviceRows
      .filter(
        (row) =>
          activeDeviceIds.has(row.deviceId) &&
          row.pushEnabled &&
          row.sessionAlerts &&
          row.token?.startsWith("ExponentPushToken["),
      )
      .map((row) => ({ userId: row.userId, token: row.token! }));
    if (deviceRows.length > 0) return deviceTokens;
    return user[0]?.token?.startsWith("ExponentPushToken[")
      ? [{ userId, token: user[0].token }]
      : [];
  }

  async clearInvalidPushToken(token: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .update(schema.users)
        .set({ pushToken: null })
        .where(eq(schema.users.pushToken, token));
      await tx
        .update(schema.notificationDevices)
        .set({ pushToken: null })
        .where(eq(schema.notificationDevices.pushToken, token));
    });
  }

  // ─── Startup migrations ───────────────────────────────────────────────────────
  /**
   * Force-release a specific in_progress claim without the claimToken.
   * Used by the admin "Release" button for stuck requests. Safe because the
   * conditional claimToken check in resolveInProgressGdprRequest will reject
   * any live worker that tries to finalize after the status reverts to 'pending'.
   */
  async forceReleaseGdprClaim(id: string, eventId?: string): Promise<void> {
    await pool.query(
      `UPDATE gdpr_requests SET status='pending', claim_token=NULL WHERE id=$1 AND status='in_progress'${eventId ? " AND event_id=$2" : ""}`,
      eventId ? [id, eventId] : [id],
    );
  }

  /**
   * Reset any GDPR requests left in `in_progress` by a prior process that crashed
   * before releasing its claim. Called on every startup before accepting requests,
   * so stranded claims never become permanently unresolvable.
   * After reset the unique index no longer blocks resubmission.
   */
  async reconcileAbandonedGdprClaims(): Promise<void> {
    const { rowCount } = await pool.query(
      `UPDATE gdpr_requests SET status='pending' WHERE status='in_progress'`,
    );
    if (rowCount && rowCount > 0) {
      console.log(
        `[GDPR] Reconciled ${rowCount} abandoned in_progress claim(s) -> pending`,
      );
    }
  }

  /**
   * Apply pending SQL migrations from the ./migrations directory.
   * Uses a _schema_migrations ledger table so each file runs exactly once.
   * Wraps each migration in a transaction with the ledger insert so a partial
   * migration cannot be recorded as applied. Throws on failure — server will
   * not start with an incomplete schema.
   */
  async runStartupMigrations(): Promise<void> {
    // Ensure the ledger table exists (safe on every boot)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS _schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    const fs = await import("fs");
    const path = await import("path");
    const migrationsDir = path.resolve(process.cwd(), "migrations");
    if (!fs.existsSync(migrationsDir)) {
      migrationsReady = true;
      return;
    }

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f: string) => f.endsWith(".sql"))
      .sort();
    const { rows } = await pool.query<{ filename: string }>(
      "SELECT filename FROM _schema_migrations",
    );
    const applied = new Set(rows.map((r) => r.filename));

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`[Migration] Already applied: ${file}`);
        continue;
      }
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          "INSERT INTO _schema_migrations (filename) VALUES ($1)",
          [file],
        );
        await client.query("COMMIT");
        console.log(`[Migration] Applied: ${file}`);
      } catch (e: any) {
        await client.query("ROLLBACK").catch(() => {});
        // Fail fast — do not start the server with an incomplete schema
        throw new Error(`[Migration] Failed to apply ${file}: ${e.message}`);
      } finally {
        client.release();
      }
    }
    migrationsReady = true;
  }

  // ─── GDPR ─────────────────────────────────────────────────────────────────────
  async createGdprRequest(
    userId: string,
    eventId: string,
    userEmail: string,
    userName: string,
    type: "data" | "deletion",
    reason?: string,
  ): Promise<schema.GdprRequest> {
    const [req] = await db
      .insert(schema.gdprRequests)
      .values({
        userId,
        eventId,
        userEmail,
        userName,
        type,
        status: "pending",
        reason,
      })
      .returning();
    return req;
  }

  async getGdprRequests(
    status?: string,
    eventId?: string,
  ): Promise<schema.GdprRequest[]> {
    const eventCondition = eventId
      ? eq(schema.gdprRequests.eventId, eventId)
      : undefined;
    if (!status || status === "all") {
      return eventCondition
        ? db
            .select()
            .from(schema.gdprRequests)
            .where(eventCondition)
            .orderBy(desc(schema.gdprRequests.createdAt))
        : db
            .select()
            .from(schema.gdprRequests)
            .orderBy(desc(schema.gdprRequests.createdAt));
    }
    if (status === "pending") {
      // Include in_progress so admins can see and release stuck claims
      return db
        .select()
        .from(schema.gdprRequests)
        .where(
          eventCondition
            ? and(
                or(
                  eq(schema.gdprRequests.status, "pending"),
                  eq(schema.gdprRequests.status, "in_progress"),
                ),
                eventCondition,
              )
            : or(
                eq(schema.gdprRequests.status, "pending"),
                eq(schema.gdprRequests.status, "in_progress"),
              ),
        )
        .orderBy(desc(schema.gdprRequests.createdAt));
    }
    return eventCondition
      ? db
          .select()
          .from(schema.gdprRequests)
          .where(and(eq(schema.gdprRequests.status, status), eventCondition))
          .orderBy(desc(schema.gdprRequests.createdAt))
      : db
          .select()
          .from(schema.gdprRequests)
          .where(eq(schema.gdprRequests.status, status))
          .orderBy(desc(schema.gdprRequests.createdAt));
  }

  async getPendingGdprRequests(
    eventId?: string,
  ): Promise<schema.GdprRequest[]> {
    // approve-all only targets pending (not in_progress — those are already claimed)
    return eventId
      ? db
          .select()
          .from(schema.gdprRequests)
          .where(
            and(
              eq(schema.gdprRequests.status, "pending"),
              eq(schema.gdprRequests.eventId, eventId),
            ),
          )
          .orderBy(desc(schema.gdprRequests.createdAt))
      : db
          .select()
          .from(schema.gdprRequests)
          .where(eq(schema.gdprRequests.status, "pending"))
          .orderBy(desc(schema.gdprRequests.createdAt));
  }

  async getPendingGdprCount(eventId?: string): Promise<number> {
    // Count includes in_progress so the dashboard badge reflects requests needing attention
    const [r] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.gdprRequests)
      .where(
        eventId
          ? and(
              or(
                eq(schema.gdprRequests.status, "pending"),
                eq(schema.gdprRequests.status, "in_progress"),
              ),
              eq(schema.gdprRequests.eventId, eventId),
            )
          : or(
              eq(schema.gdprRequests.status, "pending"),
              eq(schema.gdprRequests.status, "in_progress"),
            ),
      );
    return Number(r.count);
  }

  async resolveGdprRequest(
    id: string,
    status: "approved" | "denied",
    resolvedBy: string,
  ): Promise<schema.GdprRequest> {
    const [req] = await db
      .update(schema.gdprRequests)
      .set({ status, resolvedAt: new Date(), resolvedBy })
      .where(eq(schema.gdprRequests.id, id))
      .returning();
    return req;
  }

  /**
   * Delete a user and mark the corresponding GDPR deletion request approved in a single
   * database transaction. Both succeed or both roll back.
   * Also cancels any other active (pending/in_progress) requests for the same user
   * in the same transaction — once deleted, they can no longer be fulfilled.
   * The "processing" confirmation email must be sent BEFORE calling this method.
   */
  async deleteUserAndResolveGdprRequest(
    userId: string,
    requestId: string,
    resolvedBy: string,
    claimToken: string,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      // GDPR account deletion removes the live account and event data, but
      // never removes retained compliance or security history.
      await tx
        .delete(schema.userCaseStudies)
        .where(eq(schema.userCaseStudies.userId, userId));
      await tx
        .delete(schema.savedSessions)
        .where(eq(schema.savedSessions.userId, userId));
      await tx
        .delete(schema.userNotifications)
        .where(eq(schema.userNotifications.userId, userId));
      await tx
        .delete(schema.dinnerInvites)
        .where(eq(schema.dinnerInvites.userId, userId));
      await tx.delete(schema.users).where(eq(schema.users.id, userId));
      // Resolve the GDPR deletion request atomically with the deletion.
      // Condition on in_progress AND claimToken so a release-and-reclaim by another
      // worker cannot proceed inside the same transaction window.
      const result = await tx
        .update(schema.gdprRequests)
        .set({
          status: "approved",
          resolvedAt: new Date(),
          resolvedBy,
          claimToken: null,
        })
        .where(
          and(
            eq(schema.gdprRequests.id, requestId),
            eq(schema.gdprRequests.status, "in_progress"),
            eq(schema.gdprRequests.claimToken, claimToken),
          ),
        )
        .returning();
      if (!result.length) {
        throw new Error(
          "GDPR request claim expired or was released by another admin before deletion completed; rolling back.",
        );
      }
      // Cancel any other active requests for this user (e.g. a data request)
      // They can no longer be fulfilled once the account is gone
      await tx
        .update(schema.gdprRequests)
        .set({
          status: "cancelled",
          resolvedAt: new Date(),
          resolvedBy: "auto:account_deleted",
        })
        .where(
          and(
            eq(schema.gdprRequests.userId, userId),
            or(
              eq(schema.gdprRequests.status, "pending"),
              eq(schema.gdprRequests.status, "in_progress"),
            ),
            ne(schema.gdprRequests.id, requestId),
          ),
        );
    });
  }

  async markGdprDeliveryAttempt(id: string): Promise<void> {
    await db
      .update(schema.gdprRequests)
      .set({
        deliveryStatus: "sending",
        deliveryAttempts: sql`${schema.gdprRequests.deliveryAttempts} + 1`,
        deliveryError: null,
      })
      .where(
        and(
          eq(schema.gdprRequests.id, id),
          eq(schema.gdprRequests.status, "in_progress"),
          eq(schema.gdprRequests.type, "data"),
        ),
      );
  }

  async markGdprDeliverySuccess(id: string): Promise<void> {
    await db
      .update(schema.gdprRequests)
      .set({ deliveryStatus: "delivered", deliveryError: null })
      .where(
        and(
          eq(schema.gdprRequests.id, id),
          eq(schema.gdprRequests.status, "in_progress"),
          eq(schema.gdprRequests.type, "data"),
        ),
      );
  }

  async markGdprDeliveryFailure(id: string, error: string): Promise<void> {
    await db
      .update(schema.gdprRequests)
      .set({ deliveryStatus: "failed", deliveryError: error.slice(0, 500) })
      .where(eq(schema.gdprRequests.id, id));
  }

  async claimGdprRequest(
    id: string,
  ): Promise<{ request: schema.GdprRequest; claimToken: string } | null> {
    const claimToken = randomUUID();
    const [req] = await db
      .update(schema.gdprRequests)
      .set({ status: "in_progress", claimToken })
      .where(
        and(
          eq(schema.gdprRequests.id, id),
          eq(schema.gdprRequests.status, "pending"),
        ),
      )
      .returning();
    return req ? { request: req, claimToken } : null;
  }

  /** Release a claim. Requires the claimToken issued at claim time — prevents releasing another worker's active claim. */
  async releaseGdprClaim(id: string, claimToken: string): Promise<void> {
    await db
      .update(schema.gdprRequests)
      .set({ status: "pending", claimToken: null })
      .where(
        and(
          eq(schema.gdprRequests.id, id),
          eq(schema.gdprRequests.status, "in_progress"),
          eq(schema.gdprRequests.claimToken, claimToken),
        ),
      );
  }

  /** Conditional finalize. Requires the claimToken so a release-and-reclaim by another worker cannot be overwritten. */
  async resolveInProgressGdprRequest(
    id: string,
    claimToken: string,
    status: "approved",
    resolvedBy: string,
  ): Promise<schema.GdprRequest | null> {
    const [req] = await db
      .update(schema.gdprRequests)
      .set({ status, resolvedAt: new Date(), resolvedBy, claimToken: null })
      .where(
        and(
          eq(schema.gdprRequests.id, id),
          eq(schema.gdprRequests.status, "in_progress"),
          eq(schema.gdprRequests.claimToken, claimToken),
        ),
      )
      .returning();
    return req ?? null;
  }

  async denyPendingGdprRequest(
    id: string,
    resolvedBy: string,
  ): Promise<schema.GdprRequest | null> {
    const [req] = await db
      .update(schema.gdprRequests)
      .set({ status: "denied", resolvedAt: new Date(), resolvedBy })
      .where(
        and(
          eq(schema.gdprRequests.id, id),
          eq(schema.gdprRequests.status, "pending"),
        ),
      )
      .returning();
    return req ?? null;
  }

  async bulkCreateUsers(
    rows: BulkUserImportRow[],
    eventId?: string,
  ): Promise<BulkUserImportSummary> {
    let created = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];
    const results: BulkUserImportResult[] = [];
    const seenEmails = new Set<string>();

    for (const row of rows) {
      const email = row.email.trim().toLowerCase();
      try {
        if (seenEmails.has(email)) {
          skipped++;
          results.push({
            row: row.sourceRow,
            email,
            status: "skipped",
            message: "Duplicate email in this upload",
            eventId: row.eventId || eventId || null,
          });
          continue;
        }
        seenEmails.add(email);

        const resolvedEventId = row.eventId || eventId;
        const existing = await this.getUserByEmailAndEvent(
          email,
          resolvedEventId,
        );
        if (existing) {
          skipped++;
          results.push({
            row: row.sourceRow,
            email,
            status: "skipped",
            message: "A user with this email already exists",
            userId: existing.id,
            eventId: existing.eventId,
          });
          continue;
        }

        const user = await this.createUserAdmin(
          email,
          row.name,
          row.role,
          null,
          resolvedEventId,
        );
        created++;
        results.push({
          row: row.sourceRow,
          email,
          status: "created",
          message: "User created",
          userId: user.id,
          eventId: user.eventId,
        });
      } catch (e: any) {
        failed++;
        const message = e?.message || "Could not create user";
        errors.push(`Row ${row.sourceRow} (${email}): ${message}`);
        results.push({
          row: row.sourceRow,
          email,
          status: "error",
          message,
          eventId: row.eventId || eventId || null,
        });
      }
    }
    return { created, skipped, failed, errors, results };
  }
}

export const storage = new DatabaseStorage();
