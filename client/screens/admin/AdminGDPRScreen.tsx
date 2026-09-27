import React, { useState } from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ThemedText } from "@/components/ThemedText";
import { EventState } from "@/components/EventState";
import { useAdminEvent } from "@/contexts/AdminEventContext";
import { useTheme } from "@/hooks/useTheme";
import { apiRequest } from "@/lib/query-client";
import { confirmDestructive } from "@/lib/confirm-destructive";
import { AppColors, BorderRadius, Spacing, Shadows } from "@/constants/theme";
import * as Haptics from "expo-haptics";

interface GdprRequest {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  type: "data" | "deletion";
  status: "pending" | "in_progress" | "approved" | "denied" | "cancelled";
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

type ActionNotice = {
  kind: "success" | "error";
  message: string;
};

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function AdminGDPRScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { adminEventId } = useAdminEvent();
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [actionNotice, setActionNotice] = useState<ActionNotice | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const eventQuery = adminEventId ? `?eventId=${adminEventId}` : "";

  const {
    data: requests = [],
    isLoading,
    refetch,
    isRefetching,
  } = useQuery<GdprRequest[]>({
    queryKey: ["/api/admin/gdpr-requests", filter, adminEventId],
    enabled: !!adminEventId,
    queryFn: async () => {
      const res = await apiRequest(
        `/api/admin/gdpr-requests${
          filter === "all"
            ? `${eventQuery ? `${eventQuery}&` : "?"}status=all`
            : eventQuery
        }`,
      );
      return res.json();
    },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/admin/gdpr-requests"] });

  const approveMutation = useMutation({
    mutationFn: async ({
      id,
      eventId,
    }: {
      id: string;
      eventId: string;
      type: GdprRequest["type"];
    }) => {
      const res = await apiRequest(
        `/api/admin/gdpr-requests/${id}/approve?eventId=${eventId}`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to approve");
      }
      return res.json();
    },
    onSuccess: async (_data, variables) => {
      await invalidate();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setActionNotice({
        kind: "success",
        message:
          variables.type === "deletion"
            ? "The account was deleted and the request was resolved."
            : "The data export was sent and the request was resolved.",
      });
    },
    onError: (e: unknown) =>
      setActionNotice({
        kind: "error",
        message: getErrorMessage(e, "The GDPR request could not be approved."),
      }),
  });

  const denyMutation = useMutation({
    mutationFn: async ({ id, eventId }: { id: string; eventId: string }) => {
      const res = await apiRequest(
        `/api/admin/gdpr-requests/${id}/deny?eventId=${eventId}`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to deny");
      }
      return res.json();
    },
    onSuccess: async () => {
      await invalidate();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setActionNotice({
        kind: "success",
        message: "The GDPR request was denied.",
      });
    },
    onError: (e: unknown) =>
      setActionNotice({
        kind: "error",
        message: getErrorMessage(e, "The GDPR request could not be denied."),
      }),
  });

  const releaseMutation = useMutation({
    mutationFn: async ({ id, eventId }: { id: string; eventId: string }) => {
      const res = await apiRequest(
        `/api/admin/gdpr-requests/${id}/release?eventId=${eventId}`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to release");
      }
      return res.json();
    },
    onSuccess: async () => {
      await invalidate();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setActionNotice({
        kind: "success",
        message: "The request was released and is ready to process again.",
      });
    },
    onError: (e: unknown) =>
      setActionNotice({
        kind: "error",
        message: getErrorMessage(e, "The request could not be released."),
      }),
  });

  const approveAllMutation = useMutation({
    mutationFn: async (eventId: string) => {
      const res = await apiRequest(
        `/api/admin/gdpr-requests/approve-all?eventId=${eventId}`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to approve all");
      }
      return res.json();
    },
    onSuccess: async (data: {
      approved: number;
      failed: number;
      errors?: { id: string; email: string; error: string }[];
    }) => {
      await invalidate();
      if (data.failed > 0) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        const failList = (data.errors || [])
          .map((e) => `• ${e.email}: ${e.error}`)
          .join("\n");
        setActionNotice({
          kind: "error",
          message: `${data.approved} approved, ${data.failed} failed${
            failList ? `:\n\n${failList}` : ""
          }.\n\nFailed requests remain pending.`,
        });
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setActionNotice({
          kind: "success",
          message: `${data.approved} request${
            data.approved !== 1 ? "s" : ""
          } approved.`,
        });
      }
    },
    onError: (e: unknown) =>
      setActionNotice({
        kind: "error",
        message: getErrorMessage(e, "The GDPR requests could not be approved."),
      }),
  });

  const isBusy =
    approveMutation.isPending ||
    denyMutation.isPending ||
    approveAllMutation.isPending ||
    releaseMutation.isPending ||
    isConfirming;

  const confirmAndRun = async (
    title: string,
    message: string,
    confirmLabel: string,
    action: () => void,
  ) => {
    if (isBusy) return;
    setActionNotice(null);
    setIsConfirming(true);
    try {
      if (await confirmDestructive(title, message, confirmLabel)) {
        action();
      }
    } finally {
      setIsConfirming(false);
    }
  };

  const handleApprove = (req: GdprRequest) => {
    if (!adminEventId) {
      setActionNotice({
        kind: "error",
        message: "Choose an event before processing GDPR requests.",
      });
      return;
    }
    const label =
      req.type === "deletion"
        ? "delete this account"
        : "send this user their data";
    void confirmAndRun(
      "Confirm Approval",
      `This will ${label} and notify ${req.userName} by email. Continue?`,
      req.type === "deletion" ? "Delete Account" : "Send Data",
      () =>
        approveMutation.mutate({
          id: req.id,
          eventId: adminEventId,
          type: req.type,
        }),
    );
  };

  const handleDeny = (req: GdprRequest) => {
    if (!adminEventId) {
      setActionNotice({
        kind: "error",
        message: "Choose an event before processing GDPR requests.",
      });
      return;
    }
    void confirmAndRun(
      "Deny Request",
      `Deny the ${req.type === "deletion" ? "deletion" : "data access"} request from ${req.userName}?`,
      "Deny",
      () => denyMutation.mutate({ id: req.id, eventId: adminEventId }),
    );
  };

  const handleRelease = (req: GdprRequest) => {
    if (!adminEventId) {
      setActionNotice({
        kind: "error",
        message: "Choose an event before releasing a GDPR request.",
      });
      return;
    }
    void confirmAndRun(
      "Release Stuck Claim",
      "This request is marked as in progress. Release it back to pending so it can be approved or denied?",
      "Release",
      () => releaseMutation.mutate({ id: req.id, eventId: adminEventId }),
    );
  };

  const handleApproveAll = () => {
    if (!adminEventId) {
      setActionNotice({
        kind: "error",
        message: "Choose an event before processing GDPR requests.",
      });
      return;
    }
    const pending = requests.filter((r) => r.status === "pending");
    if (pending.length === 0) return;
    void confirmAndRun(
      "Approve All Requests",
      `This will process all ${pending.length} pending request${pending.length !== 1 ? "s" : ""} at once. Data requests will receive their export by email; deletion requests will have their accounts permanently deleted. Continue?`,
      "Approve All",
      () => approveAllMutation.mutate(adminEventId),
    );
  };

  // Count both pending and in_progress as "active" for the badge
  const pendingCount = requests.filter(
    (r) => r.status === "pending" || r.status === "in_progress",
  ).length;
  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return (
      d.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }) +
      " at " +
      d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    );
  };

  if (!adminEventId) {
    return (
      <View
        style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      >
        <EventState
          title="Select an event"
          message="Choose an event before viewing or processing GDPR requests."
          icon="layers"
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      contentContainerStyle={{
        paddingTop: Spacing.xl,
        paddingBottom: insets.bottom + Spacing["3xl"],
        paddingHorizontal: Spacing.lg,
      }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
      }
    >
      {actionNotice && (
        <View
          testID="gdpr-action-notice"
          style={[
            styles.actionNotice,
            {
              backgroundColor:
                actionNotice.kind === "error" ? "#FEF2F2" : "#F0FDF4",
              borderColor:
                actionNotice.kind === "error" ? "#FECACA" : "#BBF7D0",
            },
          ]}
        >
          <Feather
            name={
              actionNotice.kind === "error" ? "alert-circle" : "check-circle"
            }
            size={16}
            color={actionNotice.kind === "error" ? AppColors.error : "#16A34A"}
          />
          <ThemedText
            style={[
              styles.actionNoticeText,
              {
                color:
                  actionNotice.kind === "error" ? AppColors.error : "#166534",
              },
            ]}
          >
            {actionNotice.message}
          </ThemedText>
        </View>
      )}

      {/* Info Banner */}
      <View
        style={[
          styles.infoBanner,
          {
            backgroundColor: `${AppColors.primary}0C`,
            borderColor: `${AppColors.primary}20`,
          },
        ]}
      >
        <Feather name="shield" size={16} color={AppColors.primary} />
        <ThemedText style={[styles.infoText, { color: theme.textSecondary }]}>
          Under GDPR you have 30 days to process each request. Data requests
          trigger an export email; deletion requests permanently remove the
          account.
        </ThemedText>
      </View>

      {/* Filter + Approve All row */}
      <View style={styles.actionRow}>
        <View
          style={[
            styles.filterToggle,
            {
              backgroundColor: theme.cardBackground,
              borderColor: theme.border,
            },
          ]}
        >
          {(["pending", "all"] as const).map((f) => (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              style={[
                styles.filterBtn,
                filter === f && { backgroundColor: AppColors.primary },
              ]}
            >
              <ThemedText
                style={[
                  styles.filterLabel,
                  { color: filter === f ? "#fff" : theme.textSecondary },
                ]}
              >
                {f === "pending" ? `Pending (${pendingCount})` : "All"}
              </ThemedText>
            </Pressable>
          ))}
        </View>

        {requests.some((request) => request.status === "pending") && (
          <Pressable
            onPress={handleApproveAll}
            disabled={isBusy}
            style={({ pressed }) => [
              styles.approveAllBtn,
              { opacity: pressed || isBusy ? 0.7 : 1 },
            ]}
          >
            {approveAllMutation.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Feather name="check-circle" size={15} color="#fff" />
                <ThemedText style={styles.approveAllLabel}>
                  Approve All
                </ThemedText>
              </>
            )}
          </Pressable>
        )}
      </View>

      {/* Request list */}
      {isLoading ? (
        <ActivityIndicator
          size="large"
          color={AppColors.primary}
          style={{ marginTop: 40 }}
        />
      ) : requests.length === 0 ? (
        <View style={styles.empty}>
          <Feather name="check-circle" size={40} color={theme.textTertiary} />
          <ThemedText style={[styles.emptyTitle, { color: theme.text }]}>
            No requests
          </ThemedText>
          <ThemedText
            style={[styles.emptyDesc, { color: theme.textSecondary }]}
          >
            {filter === "pending"
              ? "No pending GDPR requests at this time."
              : "No GDPR requests have been submitted yet."}
          </ThemedText>
        </View>
      ) : (
        <>
          {filter === "pending" ? (
            <>
              <RequestSection
                title="Pending review"
                requests={requests.filter((req) => req.status === "pending")}
                theme={theme}
                isBusy={isBusy}
                onApprove={handleApprove}
                onDeny={handleDeny}
                onRelease={handleRelease}
                formatDate={formatDate}
              />
              <RequestSection
                title="In progress"
                requests={requests.filter(
                  (req) => req.status === "in_progress",
                )}
                theme={theme}
                isBusy={isBusy}
                onApprove={handleApprove}
                onDeny={handleDeny}
                onRelease={handleRelease}
                formatDate={formatDate}
              />
            </>
          ) : (
            <>
              <RequestSection
                title="Active requests"
                requests={requests.filter(
                  (req) =>
                    req.status === "pending" || req.status === "in_progress",
                )}
                theme={theme}
                isBusy={isBusy}
                onApprove={handleApprove}
                onDeny={handleDeny}
                onRelease={handleRelease}
                formatDate={formatDate}
              />
              <RequestSection
                title="Resolved requests"
                requests={requests.filter(
                  (req) =>
                    req.status === "approved" ||
                    req.status === "denied" ||
                    req.status === "cancelled",
                )}
                theme={theme}
                isBusy={isBusy}
                onApprove={handleApprove}
                onDeny={handleDeny}
                onRelease={handleRelease}
                formatDate={formatDate}
              />
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

function RequestSection({
  title,
  requests,
  theme,
  isBusy,
  onApprove,
  onDeny,
  onRelease,
  formatDate,
}: {
  title: string;
  requests: GdprRequest[];
  theme: any;
  isBusy: boolean;
  onApprove: (req: GdprRequest) => void;
  onDeny: (req: GdprRequest) => void;
  onRelease: (req: GdprRequest) => void;
  formatDate: (s: string) => string;
}) {
  if (requests.length === 0) return null;
  return (
    <View>
      <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>
        {title}
      </ThemedText>
      {requests.map((req) => (
        <RequestCard
          key={req.id}
          req={req}
          theme={theme}
          isBusy={isBusy}
          onApprove={() => onApprove(req)}
          onDeny={() => onDeny(req)}
          onRelease={() => onRelease(req)}
          formatDate={formatDate}
        />
      ))}
    </View>
  );
}

function RequestCard({
  req,
  theme,
  isBusy,
  onApprove,
  onDeny,
  onRelease,
  formatDate,
}: {
  req: GdprRequest;
  theme: any;
  isBusy: boolean;
  onApprove: () => void;
  onDeny: () => void;
  onRelease: () => void;
  formatDate: (s: string) => string;
}) {
  const isDeletion = req.type === "deletion";
  const typeColor = isDeletion ? AppColors.error : AppColors.primary;
  const typeIcon: any = isDeletion ? "trash-2" : "download";
  const typeLabel = isDeletion ? "Account Deletion" : "Data Access";

  const statusColor =
    req.status === "approved"
      ? "#16A34A"
      : req.status === "denied" || req.status === "cancelled"
        ? AppColors.error
        : req.status === "in_progress"
          ? "#D97706"
          : AppColors.accent;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.cardBackground,
          borderColor: theme.cardBorder,
        },
      ]}
    >
      {/* Header */}
      <View style={styles.cardHeader}>
        <View style={[styles.typeTag, { backgroundColor: `${typeColor}12` }]}>
          <Feather name={typeIcon} size={13} color={typeColor} />
          <ThemedText style={[styles.typeLabel, { color: typeColor }]}>
            {typeLabel}
          </ThemedText>
        </View>
        <View
          style={[styles.statusTag, { backgroundColor: `${statusColor}14` }]}
        >
          <ThemedText style={[styles.statusLabel, { color: statusColor }]}>
            {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
          </ThemedText>
        </View>
      </View>

      {/* User info */}
      <View style={styles.userRow}>
        <View
          style={[styles.avatar, { backgroundColor: `${AppColors.primary}14` }]}
        >
          <ThemedText style={[styles.avatarText, { color: AppColors.primary }]}>
            {req.userName
              .split(" ")
              .map((n) => n[0])
              .join("")
              .toUpperCase()
              .slice(0, 2)}
          </ThemedText>
        </View>
        <View style={styles.userInfo}>
          <ThemedText style={[styles.userName, { color: theme.text }]}>
            {req.userName}
          </ThemedText>
          <ThemedText
            style={[styles.userEmail, { color: theme.textSecondary }]}
          >
            {req.userEmail}
          </ThemedText>
        </View>
      </View>

      {/* Date */}
      <View style={[styles.dateRow, { borderTopColor: theme.border }]}>
        <Feather name="clock" size={12} color={theme.textTertiary} />
        <ThemedText style={[styles.dateText, { color: theme.textTertiary }]}>
          Submitted {formatDate(req.createdAt)}
        </ThemedText>
      </View>
      {req.resolvedAt && (
        <View style={styles.dateRow}>
          <Feather name="check" size={12} color={theme.textTertiary} />
          <ThemedText style={[styles.dateText, { color: theme.textTertiary }]}>
            Resolved {formatDate(req.resolvedAt)}
          </ThemedText>
        </View>
      )}

      {/* Actions — pending: approve / deny */}
      {req.status === "pending" && (
        <View style={styles.actions}>
          <Pressable
            onPress={onDeny}
            disabled={isBusy}
            style={({ pressed }) => [
              styles.denyBtn,
              {
                borderColor: AppColors.error,
                opacity: pressed || isBusy ? 0.7 : 1,
              },
            ]}
          >
            <Feather name="x" size={15} color={AppColors.error} />
            <ThemedText style={[styles.btnLabel, { color: AppColors.error }]}>
              Deny
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={onApprove}
            disabled={isBusy}
            style={({ pressed }) => [
              styles.approveBtn,
              {
                backgroundColor: typeColor,
                opacity: pressed || isBusy ? 0.7 : 1,
              },
            ]}
          >
            <Feather name="check" size={15} color="#fff" />
            <ThemedText style={[styles.btnLabel, { color: "#fff" }]}>
              {isDeletion ? "Delete Account" : "Send Data"}
            </ThemedText>
          </Pressable>
        </View>
      )}

      {/* Actions — in_progress: manual release for stuck claims */}
      {req.status === "in_progress" && (
        <View style={[styles.actions, { borderTopColor: "#D9770620" }]}>
          <View
            style={[styles.inProgressNote, { backgroundColor: "#D9770610" }]}
          >
            <Feather name="loader" size={13} color="#D97706" />
            <ThemedText style={styles.inProgressText}>
              Being processed — stuck? Release to retry.
            </ThemedText>
          </View>
          <Pressable
            onPress={onRelease}
            disabled={isBusy}
            style={({ pressed }) => [
              styles.releaseBtn,
              { opacity: pressed || isBusy ? 0.7 : 1 },
            ]}
          >
            <Feather name="refresh-cw" size={13} color="#D97706" />
            <ThemedText style={[styles.btnLabel, { color: "#D97706" }]}>
              Release
            </ThemedText>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: Spacing.md,
    marginTop: Spacing.sm,
  },
  infoBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    marginBottom: Spacing.xl,
  },
  infoText: { flex: 1, fontSize: 13, lineHeight: 18 },
  actionNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    marginBottom: Spacing.lg,
  },
  actionNoticeText: { flex: 1, fontSize: 13, lineHeight: 19 },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  filterToggle: {
    flexDirection: "row",
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    padding: 3,
    gap: 3,
  },
  filterBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: BorderRadius.md,
  },
  filterLabel: { fontSize: 13, fontWeight: "600" },
  approveAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#16A34A",
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
    borderRadius: BorderRadius.lg,
  },
  approveAllLabel: { color: "#fff", fontSize: 13, fontWeight: "700" },
  empty: { alignItems: "center", paddingVertical: 60, gap: Spacing.md },
  emptyTitle: { fontSize: 18, fontWeight: "700" },
  emptyDesc: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 280,
  },
  card: {
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    marginBottom: Spacing.lg,
    overflow: "hidden",
    ...Shadows.card,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  typeTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: Spacing.md,
    paddingVertical: 5,
    borderRadius: BorderRadius.full,
  },
  typeLabel: { fontSize: 12, fontWeight: "700" },
  statusTag: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 5,
    borderRadius: BorderRadius.full,
  },
  statusLabel: { fontSize: 12, fontWeight: "700" },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 16, fontWeight: "800" },
  userInfo: { flex: 1 },
  userName: { fontSize: 15, fontWeight: "600" },
  userEmail: { fontSize: 13, marginTop: 2 },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 8,
    borderTopWidth: 1,
  },
  dateText: { fontSize: 12 },
  actions: {
    flexDirection: "row",
    gap: Spacing.md,
    padding: Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: "transparent",
  },
  denyBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 11,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
  },
  approveBtn: {
    flex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 11,
    borderRadius: BorderRadius.lg,
  },
  btnLabel: { fontSize: 14, fontWeight: "700" },
  inProgressNote: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 8,
    borderRadius: BorderRadius.md,
  },
  inProgressText: { flex: 1, fontSize: 12, color: "#D97706" },
  releaseBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 11,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: "#D97706",
  },
});
