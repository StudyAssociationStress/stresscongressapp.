import React from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  RefreshControl,
  Pressable,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { getScreenContentTopPadding } from "@/hooks/useScreenOptions";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { CardSkeleton } from "@/components/SkeletonLoader";
import { EventState } from "@/components/EventState";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminEvent } from "@/contexts/AdminEventContext";
import { useEventTheme } from "@/contexts/EventThemeContext";
import { apiRequest } from "@/lib/query-client";
import { AppColors, BorderRadius, Spacing, Shadows } from "@/constants/theme";
import * as Haptics from "expo-haptics";

interface Stats {
  totalRegistered: number;
  checkedIn: number;
  pending: number;
}
interface Attendee {
  id: string;
  name: string;
  email: string;
  role: string;
  checkedIn: boolean;
}
interface RecentCheckIn {
  id: string;
  name: string;
  email: string;
  checkedInAt: string;
}

function getInitials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

function getAvatarColor(name: string) {
  const colors = [
    "#0EA5E9",
    "#8B5CF6",
    "#10B981",
    "#F59E0B",
    "#EF4444",
    "#EC4899",
    "#06B6D4",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++)
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

export default function StaffDashboardScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { user } = useAuth();
  const { adminEventId } = useAdminEvent();
  const eventTheme = useEventTheme();
  const navigation = useNavigation<any>();
  const { width } = useWindowDimensions();
  const isAdmin = user?.role === "admin";
  const eventReady = isAdmin ? !!adminEventId : !!eventTheme.eventId;
  const qs = adminEventId ? `?eventId=${adminEventId}` : "";

  const {
    data: stats,
    isLoading: statsLoading,
    isError: statsError,
    refetch: refetchStats,
  } = useQuery<Stats>({
    queryKey: ["/api/stats", adminEventId],
    refetchInterval: 10000,
    enabled: eventReady,
    queryFn: async () => (await apiRequest(`/api/stats${qs}`)).json(),
  });
  const {
    data: recentCheckIns = [],
    isLoading: checkInsLoading,
    isError: checkInsError,
    refetch: refetchCheckIns,
  } = useQuery<RecentCheckIn[]>({
    queryKey: ["/api/recent-checkins", adminEventId],
    refetchInterval: 5000,
    enabled: eventReady,
    queryFn: async () => (await apiRequest(`/api/recent-checkins${qs}`)).json(),
  });
  const {
    data: attendees = [],
    isError: attendeesError,
    refetch: refetchAttendees,
  } = useQuery<Attendee[]>({
    queryKey: ["/api/attendees", adminEventId],
    refetchInterval: 10000,
    enabled: eventReady,
    queryFn: async () => (await apiRequest(`/api/attendees${qs}`)).json(),
  });

  const hasLoadError = statsError || checkInsError || attendeesError;
  const pendingAttendees = attendees.filter(
    (a) => !a.checkedIn && a.role !== "staff",
  );
  const handleRefresh = () => {
    refetchStats();
    refetchCheckIns();
    refetchAttendees();
  };
  const formatTime = (dateStr: string) =>
    new Date(dateStr).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  const navigateFiltered = (filter: "pending" | "checked_in" | "all") => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    navigation.navigate("AttendeeSearch", { filter });
  };
  const checkinPct =
    stats && stats.totalRegistered > 0
      ? Math.round((stats.checkedIn / stats.totalRegistered) * 100)
      : 0;

  if (!isAdmin && eventTheme.isLoading) {
    return (
      <View
        style={[styles.loadingRoot, { backgroundColor: theme.backgroundRoot }]}
      >
        <ActivityIndicator size="large" color={AppColors.accent} />
      </View>
    );
  }

  if (isAdmin && !adminEventId) {
    return (
      <View style={[styles.root, { backgroundColor: theme.backgroundRoot }]}>
        <EventState
          title="Select an event"
          message="Choose an event year from the drawer before using check-in tools."
          icon="layers"
        />
      </View>
    );
  }

  if (!isAdmin && !eventTheme.isLoading && !eventTheme.eventId) {
    return (
      <View style={[styles.root, { backgroundColor: theme.backgroundRoot }]}>
        <EventState
          title="No live event"
          message="Check-in tools become available when an event is published."
          icon="calendar"
        />
      </View>
    );
  }

  if (hasLoadError) {
    return (
      <View style={[styles.root, { backgroundColor: theme.backgroundRoot }]}>
        <EventState
          title="Could not load check-in data"
          message="Check your connection and try again."
          icon="wifi-off"
          actionLabel="Try again"
          onAction={handleRefresh}
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: theme.backgroundRoot }]}
      contentContainerStyle={{
        paddingTop: getScreenContentTopPadding(headerHeight, Spacing.lg),
        paddingBottom: insets.bottom + Spacing["3xl"],
        paddingHorizontal: Spacing.lg,
      }}
      refreshControl={
        <RefreshControl
          refreshing={statsLoading || checkInsLoading}
          onRefresh={handleRefresh}
          tintColor={AppColors.accent}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      {/* Welcome Hero */}
      <LinearGradient
        colors={[AppColors.primary, "#1a0a7a"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.welcomeCard}
      >
        <View style={styles.welcomeBlob} />
        <View style={styles.welcomeRow}>
          <View>
            <ThemedText style={styles.welcomeGreeting}>
              {isAdmin ? "Check-in Control" : "Staff Portal"}
            </ThemedText>
            <ThemedText style={styles.welcomeName}>
              {user?.name?.split(" ")[0] ||
                (isAdmin ? "Administrator" : "Staff")}
            </ThemedText>
          </View>
        </View>
        {stats ? (
          <View style={styles.welcomeStatRow}>
            <View style={styles.welcomeStat}>
              <ThemedText style={styles.welcomeStatNum}>
                {stats.checkedIn}
              </ThemedText>
              <ThemedText style={styles.welcomeStatLabel}>
                Checked In
              </ThemedText>
            </View>
            <View style={styles.welcomeStatDivider} />
            <View style={styles.welcomeStat}>
              <ThemedText style={styles.welcomeStatNum}>
                {stats.pending}
              </ThemedText>
              <ThemedText style={styles.welcomeStatLabel}>Pending</ThemedText>
            </View>
            <View style={styles.welcomeStatDivider} />
            <View style={styles.welcomeStat}>
              <ThemedText style={styles.welcomeStatNum}>
                {checkinPct}%
              </ThemedText>
              <ThemedText style={styles.welcomeStatLabel}>Complete</ThemedText>
            </View>
          </View>
        ) : null}
      </LinearGradient>

      {/* Primary Action: Scan QR */}
      <Pressable
        style={({ pressed }) => [
          { opacity: pressed ? 0.9 : 1, marginBottom: Spacing.md },
        ]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          navigation.navigate("ScanQR");
        }}
        testID="button-scan-qr"
      >
        <LinearGradient
          colors={[AppColors.accent, AppColors.accentLight]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.scanCard}
        >
          <View style={styles.scanBlob} />
          <View style={styles.scanIconCircle}>
            <Feather name="camera" size={30} color="#fff" />
          </View>
          <View style={styles.scanText}>
            <ThemedText style={styles.scanTitle} numberOfLines={2}>
              Scan QR Code
            </ThemedText>
            <ThemedText style={styles.scanSub} numberOfLines={2}>
              Primary check-in method
            </ThemedText>
          </View>
          <View style={styles.scanArrow}>
            <Feather
              name="arrow-right"
              size={20}
              color="rgba(255,255,255,0.8)"
            />
          </View>
        </LinearGradient>
      </Pressable>

      {/* Secondary Action: Manual Search */}
      <Pressable
        style={({ pressed }) => [
          styles.manualCard,
          {
            backgroundColor: theme.cardBackground,
            borderColor: theme.border,
            opacity: pressed ? 0.85 : 1,
            marginBottom: Spacing["2xl"],
          },
        ]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          navigation.navigate("AttendeeSearch");
        }}
        testID="button-manual-checkin"
      >
        <View
          style={[
            styles.manualIcon,
            { backgroundColor: `${AppColors.accent}14` },
          ]}
        >
          <Feather name="search" size={22} color={AppColors.accent} />
        </View>
        <View style={styles.manualText}>
          <ThemedText style={[styles.manualTitle, { color: theme.text }]}>
            Manual Search
          </ThemedText>
          <ThemedText
            style={[styles.manualSub, { color: theme.textSecondary }]}
          >
            Search by name or email
          </ThemedText>
        </View>
        <Feather
          name="chevron-right"
          size={18}
          color={theme.textTertiary as string}
        />
      </Pressable>

      {/* Stats Grid */}
      <ThemedText
        style={[styles.sectionLabel, { color: theme.textTertiary as string }]}
      >
        Overview
      </ThemedText>
      {statsLoading ? (
        <View style={styles.statsRow}>
          <CardSkeleton />
        </View>
      ) : (
        <View style={[styles.statsRow, width < 390 && styles.statsRowCompact]}>
          {[
            {
              label: "Total",
              value: stats?.totalRegistered ?? 0,
              gradient: ["#0EA5E9", "#0284C7"] as [string, string],
              filter: "all" as const,
            },
            {
              label: "Checked In",
              value: stats?.checkedIn ?? 0,
              gradient: ["#10B981", "#059669"] as [string, string],
              filter: "checked_in" as const,
            },
            {
              label: "Pending",
              value: stats?.pending ?? 0,
              gradient: ["#F59E0B", "#D97706"] as [string, string],
              filter: "pending" as const,
            },
          ].map((s) => (
            <Pressable
              key={s.label}
              onPress={() => navigateFiltered(s.filter)}
              style={({ pressed }) => [
                styles.statCard,
                width < 390 && styles.statCardCompact,
                {
                  backgroundColor: theme.cardBackground,
                  borderColor: theme.border,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <LinearGradient colors={s.gradient} style={styles.statTop} />
              <ThemedText style={[styles.statValue, { color: theme.text }]}>
                {s.value}
              </ThemedText>
              <ThemedText
                style={[styles.statLabel, { color: theme.textSecondary }]}
              >
                {s.label}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      )}

      {/* Progress Bar */}
      {stats && stats.totalRegistered > 0 ? (
        <View
          style={[
            styles.progressCard,
            {
              backgroundColor: theme.cardBackground,
              borderColor: theme.border,
            },
          ]}
        >
          <View style={styles.progressHeader}>
            <ThemedText style={[styles.progressTitle, { color: theme.text }]}>
              Check-in Progress
            </ThemedText>
            <ThemedText
              style={[styles.progressPct, { color: AppColors.success }]}
            >
              {checkinPct}%
            </ThemedText>
          </View>
          <View
            style={[
              styles.progressTrack,
              { backgroundColor: theme.backgroundSecondary },
            ]}
          >
            <LinearGradient
              colors={[AppColors.success, "#16a34a"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.progressFill, { width: `${checkinPct}%` as any }]}
            />
          </View>
          <ThemedText
            style={[styles.progressSub, { color: theme.textSecondary }]}
          >
            {stats.checkedIn} of {stats.totalRegistered} attendees
          </ThemedText>
        </View>
      ) : null}

      {/* Pending */}
      {pendingAttendees.length > 0 ? (
        <>
          <View style={styles.sectionRow}>
            <ThemedText
              style={[
                styles.sectionLabel,
                { color: theme.textTertiary as string },
              ]}
            >
              Pending
            </ThemedText>
            <Pressable onPress={() => navigateFiltered("pending")}>
              <ThemedText style={[styles.viewAll, { color: AppColors.accent }]}>
                View All ({pendingAttendees.length})
              </ThemedText>
            </Pressable>
          </View>
          {pendingAttendees.slice(0, 4).map((a) => {
            const color = getAvatarColor(a.name);
            return (
              <Pressable
                key={a.id}
                onPress={() => navigateFiltered("pending")}
                style={({ pressed }) => [
                  styles.attendeeCard,
                  {
                    backgroundColor: theme.cardBackground,
                    borderColor: theme.border,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <View
                  style={[
                    styles.attendeeAvatar,
                    { backgroundColor: `${color}18` },
                  ]}
                >
                  <ThemedText style={[styles.attendeeInitials, { color }]}>
                    {getInitials(a.name)}
                  </ThemedText>
                </View>
                <View style={styles.attendeeInfo}>
                  <ThemedText
                    style={[styles.attendeeName, { color: theme.text }]}
                    numberOfLines={1}
                  >
                    {a.name}
                  </ThemedText>
                  <ThemedText
                    style={[
                      styles.attendeeEmail,
                      { color: theme.textSecondary },
                    ]}
                    numberOfLines={1}
                  >
                    {a.email}
                  </ThemedText>
                </View>
                <View
                  style={[styles.pendingPill, { backgroundColor: "#F59E0B18" }]}
                >
                  <ThemedText style={styles.pendingText}>Pending</ThemedText>
                </View>
              </Pressable>
            );
          })}
        </>
      ) : stats && stats.totalRegistered > 0 ? (
        <View
          style={[
            styles.allDoneCard,
            {
              backgroundColor: `${AppColors.success}10`,
              borderColor: `${AppColors.success}20`,
            },
          ]}
        >
          <Feather name="check-circle" size={26} color={AppColors.success} />
          <ThemedText
            style={[styles.allDoneText, { color: AppColors.success }]}
          >
            All attendees checked in
          </ThemedText>
        </View>
      ) : null}

      {/* Recent Check-ins */}
      {recentCheckIns.length > 0 ? (
        <>
          <View style={styles.sectionRow}>
            <ThemedText
              style={[
                styles.sectionLabel,
                { color: theme.textTertiary as string },
              ]}
            >
              Recent Check-ins
            </ThemedText>
            <Pressable onPress={() => navigateFiltered("checked_in")}>
              <ThemedText style={[styles.viewAll, { color: AppColors.accent }]}>
                View All
              </ThemedText>
            </Pressable>
          </View>
          {checkInsLoading ? (
            <>
              <CardSkeleton />
              <CardSkeleton />
            </>
          ) : (
            recentCheckIns.slice(0, 5).map((c) => {
              const color = getAvatarColor(c.name);
              return (
                <View
                  key={c.id}
                  style={[
                    styles.attendeeCard,
                    {
                      backgroundColor: theme.cardBackground,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.attendeeAvatar,
                      { backgroundColor: `${color}18` },
                    ]}
                  >
                    <ThemedText style={[styles.attendeeInitials, { color }]}>
                      {getInitials(c.name)}
                    </ThemedText>
                  </View>
                  <View style={styles.attendeeInfo}>
                    <ThemedText
                      style={[styles.attendeeName, { color: theme.text }]}
                      numberOfLines={1}
                    >
                      {c.name}
                    </ThemedText>
                    <ThemedText
                      style={[
                        styles.attendeeEmail,
                        { color: theme.textSecondary },
                      ]}
                      numberOfLines={1}
                    >
                      {c.email}
                    </ThemedText>
                  </View>
                  <View style={styles.checkedBadge}>
                    <Feather name="check" size={11} color={AppColors.success} />
                    <ThemedText
                      style={[styles.checkedTime, { color: AppColors.success }]}
                    >
                      {formatTime(c.checkedInAt)}
                    </ThemedText>
                  </View>
                </View>
              );
            })
          )}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loadingRoot: { flex: 1, alignItems: "center", justifyContent: "center" },
  welcomeCard: {
    borderRadius: BorderRadius["2xl"],
    padding: Spacing["2xl"],
    marginBottom: Spacing.md,
    overflow: "hidden",
  },
  welcomeBlob: {
    position: "absolute",
    top: -40,
    right: -40,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "rgba(247,143,30,0.2)",
  },
  welcomeRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: Spacing.xl,
  },
  welcomeGreeting: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 4,
  },
  welcomeName: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.5,
    flex: 1,
    minWidth: 0,
  },
  welcomeStatRow: { flexDirection: "row", alignItems: "center" },
  welcomeStat: { flex: 1, minWidth: 0, alignItems: "center" },
  welcomeStatNum: {
    color: "#fff",
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "800",
    letterSpacing: -0.5,
    textAlign: "center",
  },
  welcomeStatLabel: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
    textAlign: "center",
  },
  welcomeStatDivider: {
    width: 1,
    height: 32,
    backgroundColor: "rgba(255,255,255,0.15)",
  },

  scanCard: {
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    minHeight: 80,
    overflow: "hidden",
    ...Shadows.medium,
  },
  scanBlob: {
    position: "absolute",
    right: -20,
    top: -20,
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  scanIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.lg,
  },
  scanText: { flex: 1, minWidth: 0 },
  scanTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.3,
    marginBottom: 3,
  },
  scanSub: { color: "rgba(255,255,255,0.75)", fontSize: 13, lineHeight: 18 },
  scanArrow: {
    flexShrink: 0,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },

  manualCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    gap: Spacing.md,
    ...Shadows.card,
  },
  manualIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  manualText: { flex: 1 },
  manualTitle: { fontSize: 15, fontWeight: "700", marginBottom: 2 },
  manualSub: { fontSize: 13 },

  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: Spacing.md,
  },
  sectionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.md,
    marginTop: Spacing.sm,
  },
  viewAll: { fontSize: 13, fontWeight: "600" },

  statsRow: { flexDirection: "row", gap: Spacing.md, marginBottom: Spacing.xl },
  statsRowCompact: { gap: Spacing.sm },
  statCard: {
    flex: 1,
    borderRadius: BorderRadius.xl,
    overflow: "hidden",
    borderWidth: 1,
    alignItems: "center",
    ...Shadows.card,
  },
  statCardCompact: { minWidth: 0 },
  statTop: { width: "100%", height: 5, marginBottom: Spacing.lg },
  statValue: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: "800",
    letterSpacing: -1,
    marginBottom: 4,
    textAlign: "center",
  },
  statLabel: {
    fontSize: 11,
    fontWeight: "600",
    marginBottom: Spacing.md,
    textAlign: "center",
    width: "100%",
  },

  progressCard: {
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    marginBottom: Spacing.xl,
    borderWidth: 1,
    ...Shadows.card,
  },
  progressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  progressTitle: { fontSize: 15, fontWeight: "700" },
  progressPct: { fontSize: 18, fontWeight: "800" },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
    marginBottom: Spacing.sm,
  },
  progressFill: { height: "100%", borderRadius: 4 },
  progressSub: { fontSize: 12 },

  attendeeCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: BorderRadius.xl,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    gap: Spacing.md,
    ...Shadows.card,
  },
  attendeeAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  attendeeInitials: { fontSize: 15, fontWeight: "800" },
  attendeeInfo: { flex: 1 },
  attendeeName: { fontSize: 14, fontWeight: "700", marginBottom: 2 },
  attendeeEmail: { fontSize: 12 },
  pendingPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
  },
  pendingText: { color: "#D97706", fontSize: 11, fontWeight: "700" },
  checkedBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
  checkedTime: { fontSize: 12, fontWeight: "700" },

  allDoneCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    marginBottom: Spacing.sm,
  },
  allDoneText: { fontSize: 14, fontWeight: "700" },
});
