import React, { useState } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useAdminEvent } from "@/contexts/AdminEventContext";
import { AppColors, BorderRadius, Spacing } from "@/constants/theme";
import { apiRequest } from "@/lib/query-client";
import * as Haptics from "expo-haptics";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

interface LoginEvent {
  id: string;
  email: string;
  eventType: string;
  createdAt: string;
}

interface ResetToken {
  email: string;
  requestedAt: string;
  status: string;
  completedAt: string | null;
}

interface UserWithoutPassword {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
}

interface SecurityLogData {
  loginEvents: LoginEvent[];
  resetTokens: ResetToken[];
  usersWithoutPasswords: UserWithoutPassword[];
}

function eventTypeLabel(type: string) {
  switch (type) {
    case "login_success":
      return { label: "Login", color: "#10B981", icon: "log-in" as const };
    case "login_failed":
      return {
        label: "Failed Login",
        color: AppColors.error,
        icon: "alert-circle" as const,
      };
    case "password_set":
      return {
        label: "Password Created",
        color: "#8B5CF6",
        icon: "key" as const,
      };
    case "password_reset":
      return {
        label: "Password Reset",
        color: AppColors.accent,
        icon: "refresh-cw" as const,
      };
    case "admin_reset_issued":
      return { label: "Code Issued", color: "#0EA5E9", icon: "send" as const };
    default:
      return { label: type, color: "#71717A", icon: "activity" as const };
  }
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function groupByDay(events: LoginEvent[]) {
  const groups: Record<string, LoginEvent[]> = {};
  for (const ev of events) {
    const day = formatDate(ev.createdAt);
    if (!groups[day]) groups[day] = [];
    groups[day].push(ev);
  }
  return Object.entries(groups);
}

function getUserInitials(name: string) {
  return (
    name
      .split(" ")
      .slice(0, 2)
      .map((n) => n[0])
      .join("")
      .toUpperCase() || "?"
  );
}

export default function AdminSecurityLogScreen() {
  const { theme } = useTheme();
  const { adminEventId } = useAdminEvent();
  const [activeTab, setActiveTab] = useState<"log" | "nopass" | "resets">(
    "log",
  );
  const eventQuery = adminEventId
    ? `?eventId=${encodeURIComponent(adminEventId)}`
    : "";

  const { data, isLoading, isError, refetch } = useQuery<SecurityLogData>({
    queryKey: ["/api/admin/security-log", adminEventId],
    queryFn: async () => {
      const res = await apiRequest(`/api/admin/security-log${eventQuery}`);
      return res.json();
    },
    staleTime: 30 * 1000,
    retry: 1,
  });

  const downloadExport = async (path: string, filename: string) => {
    try {
      // Use the shared request path so mobile reads the same SecureStore
      // session token as every other authenticated screen.
      const response = await apiRequest(path);
      if (Platform.OS === "web") {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
      } else {
        const target = `${FileSystem.cacheDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(target, await response.text());
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(target, {
            mimeType: "text/csv",
            dialogTitle: "Save export",
            UTI: "public.comma-separated-values-text",
          });
        } else {
          Alert.alert(
            "Sharing unavailable",
            "This device cannot open the share sheet. Please try again on iOS or Android.",
          );
        }
      }
    } catch {
      Alert.alert(
        "Download failed",
        "We could not prepare that export. Please try again.",
      );
    }
  };

  const grouped = data ? groupByDay(data.loginEvents) : [];

  const tabs = [
    { key: "log" as const, label: "Login Log", icon: "activity" as const },
  ];

  return (
    <View style={[styles.root, { backgroundColor: theme.backgroundRoot }]}>
      <View
        style={[
          styles.tabBar,
          { borderBottomColor: theme.border, paddingTop: Spacing.md },
        ]}
      >
        {tabs.map((tab) => (
          <Pressable
            key={tab.key}
            style={[
              styles.tab,
              {
                borderBottomColor:
                  activeTab === tab.key ? AppColors.primary : "transparent",
              },
            ]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setActiveTab(tab.key);
            }}
          >
            <Feather
              name={tab.icon}
              size={14}
              color={
                activeTab === tab.key ? AppColors.primary : theme.textSecondary
              }
            />
            <ThemedText
              style={[
                styles.tabLabel,
                {
                  color:
                    activeTab === tab.key
                      ? AppColors.primary
                      : theme.textSecondary,
                },
              ]}
            >
              {tab.label}
            </ThemedText>
          </Pressable>
        ))}
      </View>
      <View style={styles.exportBar}>
        <Pressable
          style={[
            styles.exportButton,
            {
              borderColor: theme.border,
              backgroundColor: theme.cardBackground,
            },
          ]}
          onPress={() =>
            downloadExport(
              `/api/admin/security-log/export${eventQuery}`,
              "security-log.csv",
            )
          }
        >
          <Feather name="download" size={14} color={AppColors.primary} />
          <ThemedText style={[styles.exportText, { color: theme.text }]}>
            Security CSV
          </ThemedText>
        </Pressable>
        <Pressable
          style={[
            styles.exportButton,
            {
              borderColor: theme.border,
              backgroundColor: theme.cardBackground,
            },
          ]}
          onPress={() =>
            downloadExport(
              `/api/admin/gdpr/export${eventQuery}`,
              "gdpr-history.csv",
            )
          }
        >
          <Feather name="download" size={14} color={AppColors.primary} />
          <ThemedText style={[styles.exportText, { color: theme.text }]}>
            GDPR CSV
          </ThemedText>
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={AppColors.primary} />
        </View>
      ) : isError ? (
        <SecurityLogError onRetry={() => refetch()} theme={theme} />
      ) : activeTab === "log" ? (
        <FlatList
          data={grouped}
          keyExtractor={([day]) => day}
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={refetch}
              tintColor={AppColors.primary}
            />
          }
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <EmptyState
              label="No login activity recorded yet"
              icon="activity"
              theme={theme}
            />
          }
          renderItem={({ item: [day, events] }) => (
            <View style={styles.dayGroup}>
              <View style={styles.dayHeader}>
                <Feather
                  name="calendar"
                  size={12}
                  color={theme.textSecondary}
                />
                <ThemedText
                  style={[styles.dayLabel, { color: theme.textSecondary }]}
                >
                  {day}
                </ThemedText>
                <View
                  style={[
                    styles.countPill,
                    { backgroundColor: theme.backgroundSecondary },
                  ]}
                >
                  <ThemedText
                    style={[
                      styles.countPillText,
                      { color: theme.textSecondary },
                    ]}
                  >
                    {events.length}
                  </ThemedText>
                </View>
              </View>
              {events.map((ev) => {
                const meta = eventTypeLabel(ev.eventType);
                return (
                  <View
                    key={ev.id}
                    style={[
                      styles.eventRow,
                      {
                        backgroundColor: theme.cardBackground,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.eventIcon,
                        { backgroundColor: `${meta.color}14` },
                      ]}
                    >
                      <Feather name={meta.icon} size={14} color={meta.color} />
                    </View>
                    <View style={styles.eventMeta}>
                      <ThemedText
                        style={[styles.eventEmail, { color: theme.text }]}
                        numberOfLines={1}
                      >
                        {ev.email}
                      </ThemedText>
                      <ThemedText
                        style={[styles.eventType, { color: meta.color }]}
                      >
                        {meta.label}
                      </ThemedText>
                    </View>
                    <ThemedText
                      style={[styles.eventTime, { color: theme.textSecondary }]}
                    >
                      {formatTime(ev.createdAt)}
                    </ThemedText>
                  </View>
                );
              })}
            </View>
          )}
        />
      ) : activeTab === "nopass" ? (
        <FlatList
          data={data?.usersWithoutPasswords || []}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={refetch}
              tintColor={AppColors.primary}
            />
          }
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <EmptyState
              label="All users have set their passwords"
              icon="check-circle"
              theme={theme}
            />
          }
          renderItem={({ item }) => (
            <View
              style={[
                styles.userCard,
                {
                  backgroundColor: theme.cardBackground,
                  borderColor: theme.border,
                },
              ]}
            >
              <View
                style={[
                  styles.userAvatar,
                  {
                    backgroundColor:
                      item.role === "admin"
                        ? "#8B5CF614"
                        : item.role === "staff"
                          ? `${AppColors.accent}14`
                          : `${AppColors.primary}12`,
                  },
                ]}
              >
                <ThemedText
                  style={[
                    styles.userInitials,
                    {
                      color:
                        item.role === "admin"
                          ? "#8B5CF6"
                          : item.role === "staff"
                            ? AppColors.accent
                            : AppColors.primary,
                    },
                  ]}
                >
                  {getUserInitials(item.name)}
                </ThemedText>
              </View>
              <View style={styles.userMeta}>
                <ThemedText style={[styles.userName, { color: theme.text }]}>
                  {item.name}
                </ThemedText>
                <ThemedText
                  style={[styles.userEmail, { color: theme.textSecondary }]}
                  numberOfLines={1}
                >
                  {item.email}
                </ThemedText>
                <View
                  style={[
                    styles.rolePill,
                    {
                      backgroundColor:
                        item.role === "admin"
                          ? "#8B5CF614"
                          : item.role === "staff"
                            ? `${AppColors.accent}14`
                            : `${AppColors.primary}12`,
                    },
                  ]}
                >
                  <ThemedText
                    style={[
                      styles.roleText,
                      {
                        color:
                          item.role === "admin"
                            ? "#8B5CF6"
                            : item.role === "staff"
                              ? AppColors.accent
                              : AppColors.primary,
                      },
                    ]}
                  >
                    {item.role}
                  </ThemedText>
                </View>
              </View>
            </View>
          )}
        />
      ) : (
        <FlatList
          data={data?.resetTokens || []}
          keyExtractor={(item, i) => `${item.email}-${i}`}
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={refetch}
              tintColor={AppColors.primary}
            />
          }
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <EmptyState
              label="No password reset codes generated yet"
              icon="key"
              theme={theme}
            />
          }
          renderItem={({ item }) => {
            const statusColor =
              item.status === "completed"
                ? "#10B981"
                : item.status === "expired"
                  ? "#71717A"
                  : AppColors.accent;
            return (
              <View
                style={[
                  styles.resetRow,
                  {
                    backgroundColor: theme.cardBackground,
                    borderColor: theme.border,
                  },
                ]}
              >
                <View style={styles.resetMeta}>
                  <ThemedText
                    style={[styles.eventEmail, { color: theme.text }]}
                    numberOfLines={1}
                  >
                    {item.email}
                  </ThemedText>
                  <ThemedText
                    style={[styles.eventTime, { color: theme.textSecondary }]}
                  >
                    {formatDate(item.requestedAt)}{" "}
                    {formatTime(item.requestedAt)}
                  </ThemedText>
                </View>
                <View
                  style={[
                    styles.statusPill,
                    { backgroundColor: `${statusColor}14` },
                  ]}
                >
                  <ThemedText
                    style={[styles.statusText, { color: statusColor }]}
                  >
                    {item.status}
                  </ThemedText>
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

function EmptyState({
  label,
  icon,
  theme,
}: {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  theme: any;
}) {
  return (
    <View style={styles.emptyState}>
      <View
        style={[
          styles.emptyIcon,
          { backgroundColor: theme.backgroundSecondary },
        ]}
      >
        <Feather name={icon} size={24} color={theme.textSecondary} />
      </View>
      <ThemedText style={[styles.emptyText, { color: theme.textSecondary }]}>
        {label}
      </ThemedText>
    </View>
  );
}

function SecurityLogError({
  onRetry,
  theme,
}: {
  onRetry: () => void;
  theme: any;
}) {
  return (
    <View style={styles.centered}>
      <View
        style={[styles.emptyIcon, { backgroundColor: `${AppColors.error}12` }]}
      >
        <Feather name="wifi-off" size={24} color={AppColors.error} />
      </View>
      <ThemedText style={[styles.emptyText, { color: theme.textSecondary }]}>
        Security activity is temporarily unavailable.
      </ThemedText>
      <Pressable
        onPress={onRetry}
        style={[styles.retryButton, { backgroundColor: AppColors.primary }]}
      >
        <ThemedText style={styles.retryButtonText}>Try again</ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  retryButton: {
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
  retryButtonText: { color: "#fff", fontWeight: "700" },
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: 1,
    backgroundColor: "transparent",
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderBottomWidth: 2,
  },
  tabLabel: { fontSize: 12, fontWeight: "600" },
  exportBar: {
    flexDirection: "row",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  exportButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  exportText: { fontSize: 12, fontWeight: "700" },
  listContent: { padding: Spacing.lg, gap: Spacing.sm, paddingBottom: 40 },
  dayGroup: { marginBottom: Spacing.lg },
  dayHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: Spacing.sm,
  },
  dayLabel: { fontSize: 12, fontWeight: "600", flex: 1 },
  countPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
  },
  countPillText: { fontSize: 11, fontWeight: "600" },
  eventRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    marginBottom: 6,
  },
  eventIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  eventMeta: { flex: 1 },
  eventEmail: { fontSize: 13, fontWeight: "600", marginBottom: 2 },
  eventType: { fontSize: 11, fontWeight: "600" },
  eventTime: { fontSize: 11 },
  userCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    marginBottom: Spacing.sm,
  },
  userAvatar: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  userInitials: { fontSize: 16, fontWeight: "800" },
  userMeta: { flex: 1 },
  userName: { fontSize: 14, fontWeight: "700", marginBottom: 2 },
  userEmail: { fontSize: 12, marginBottom: 4 },
  rolePill: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
  },
  roleText: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  resetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    marginBottom: Spacing.sm,
  },
  resetMeta: { flex: 1 },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
  },
  statusText: { fontSize: 11, fontWeight: "700" },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    gap: 12,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: { fontSize: 14, textAlign: "center" },
});
