import React from "react";
import { StyleSheet, View, ScrollView, RefreshControl } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { getScreenContentTopPadding } from "@/hooks/useScreenOptions";
import { useQuery } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { CardSkeleton } from "@/components/SkeletonLoader";
import { useTheme } from "@/hooks/useTheme";
import { useAdminEvent } from "@/contexts/AdminEventContext";
import { AppColors, BorderRadius, Spacing, Shadows } from "@/constants/theme";

interface Stats {
  totalRegistered: number;
  checkedIn: number;
  pending: number;
  attendeeCount: number;
  staffCount: number;
}

function StatTile({
  icon,
  label,
  value,
  gradient,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: number;
  gradient: [string, string];
}) {
  return (
    <View style={[tileStyles.wrap, { flex: 1 }]}>
      <LinearGradient
        colors={gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={tileStyles.card}
      >
        <View style={tileStyles.iconWrap}>
          <Feather name={icon} size={18} color="#fff" />
        </View>
        <ThemedText style={tileStyles.value}>{value}</ThemedText>
        <ThemedText style={tileStyles.label}>{label}</ThemedText>
      </LinearGradient>
    </View>
  );
}

const tileStyles = StyleSheet.create({
  wrap: {
    borderRadius: BorderRadius.xl,
    overflow: "hidden",
    ...Shadows.medium,
  },
  card: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.xl,
    minHeight: 142,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.md,
  },
  value: {
    color: "#fff",
    fontSize: 32,
    lineHeight: 40,
    fontWeight: "800",
    letterSpacing: -1,
    marginBottom: 4,
    flexShrink: 0,
  },
  label: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    flexShrink: 1,
  },
});

export default function StatsScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { adminEventId } = useAdminEvent();
  const qs = adminEventId ? `?eventId=${adminEventId}` : "";

  const {
    data: stats,
    isLoading,
    refetch,
    isRefetching,
  } = useQuery<Stats>({
    queryKey: ["/api/stats", adminEventId],
    queryFn: async () => {
      const { apiRequest } = await import("@/lib/query-client");
      return (await apiRequest(`/api/stats${qs}`)).json();
    },
  });

  const percentage =
    stats && stats.totalRegistered > 0
      ? Math.round((stats.checkedIn / stats.totalRegistered) * 100)
      : 0;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      contentContainerStyle={{
        paddingTop: getScreenContentTopPadding(headerHeight, Spacing.lg),
        paddingBottom: insets.bottom + Spacing["3xl"],
        paddingHorizontal: Spacing.lg,
      }}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={refetch}
          tintColor={AppColors.accent}
        />
      }
    >
      {isLoading ? (
        <>
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </>
      ) : (
        <>
          {/* Main Rate Card */}
          <LinearGradient
            colors={[AppColors.primary, "#1a0a7a"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroCard}
          >
            <View style={styles.heroBlob} />
            <ThemedText style={styles.heroLabel}>Check-in Rate</ThemedText>
            <ThemedText style={styles.heroValue}>{percentage}%</ThemedText>
            <View style={styles.progressTrack}>
              <LinearGradient
                colors={[AppColors.accent, "#f0a55a"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[
                  styles.progressFill,
                  { width: `${percentage}%` as any },
                ]}
              />
            </View>
            <ThemedText style={styles.heroSub}>
              {stats?.checkedIn ?? 0} of {stats?.totalRegistered ?? 0}{" "}
              registered attendees
            </ThemedText>

            <View style={styles.heroStatRow}>
              <View style={styles.heroStat}>
                <ThemedText style={styles.heroStatNum}>
                  {stats?.checkedIn ?? 0}
                </ThemedText>
                <ThemedText style={styles.heroStatLabel}>Checked In</ThemedText>
              </View>
              <View style={styles.heroStatDivider} />
              <View style={styles.heroStat}>
                <ThemedText style={styles.heroStatNum}>
                  {stats?.pending ?? 0}
                </ThemedText>
                <ThemedText style={styles.heroStatLabel}>Pending</ThemedText>
              </View>
            </View>
          </LinearGradient>

          {/* Stat Grid */}
          <ThemedText
            style={[
              styles.sectionLabel,
              { color: theme.textTertiary as string },
            ]}
          >
            Breakdown
          </ThemedText>
          <View style={styles.row}>
            <StatTile
              icon="users"
              label="Total Registered"
              value={stats?.totalRegistered ?? 0}
              gradient={["#1D4ED8", "#3B82F6"]}
            />
            <StatTile
              icon="user"
              label="Attendees"
              value={stats?.attendeeCount ?? 0}
              gradient={["#7C3AED", "#8B5CF6"]}
            />
          </View>
          <View style={styles.row}>
            <StatTile
              icon="star"
              label="Staff"
              value={stats?.staffCount ?? 0}
              gradient={[AppColors.accent, "#f0a55a"]}
            />
            <StatTile
              icon="check-circle"
              label="Checked In"
              value={stats?.checkedIn ?? 0}
              gradient={["#059669", "#10B981"]}
            />
          </View>

          {/* Summary Card */}
          <ThemedText
            style={[
              styles.sectionLabel,
              { color: theme.textTertiary as string },
            ]}
          >
            Status
          </ThemedText>
          <View
            style={[
              styles.summaryCard,
              {
                backgroundColor: theme.cardBackground,
                borderColor: theme.border,
              },
            ]}
          >
            <View style={styles.summaryRow}>
              <View style={styles.summaryLeft}>
                <View
                  style={[styles.dot, { backgroundColor: AppColors.success }]}
                />
                <ThemedText style={[styles.summaryItem, { color: theme.text }]}>
                  Checked In
                </ThemedText>
              </View>
              <View style={styles.summaryRight}>
                <ThemedText
                  style={[styles.summaryValue, { color: AppColors.success }]}
                >
                  {stats?.checkedIn ?? 0}
                </ThemedText>
                {stats && stats.totalRegistered > 0 ? (
                  <ThemedText
                    style={[
                      styles.summaryPct,
                      { color: theme.textTertiary as string },
                    ]}
                  >
                    {percentage}%
                  </ThemedText>
                ) : null}
              </View>
            </View>
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            <View style={styles.summaryRow}>
              <View style={styles.summaryLeft}>
                <View
                  style={[styles.dot, { backgroundColor: AppColors.accent }]}
                />
                <ThemedText style={[styles.summaryItem, { color: theme.text }]}>
                  Pending
                </ThemedText>
              </View>
              <View style={styles.summaryRight}>
                <ThemedText
                  style={[styles.summaryValue, { color: AppColors.accent }]}
                >
                  {stats?.pending ?? 0}
                </ThemedText>
                {stats && stats.totalRegistered > 0 ? (
                  <ThemedText
                    style={[
                      styles.summaryPct,
                      { color: theme.textTertiary as string },
                    ]}
                  >
                    {100 - percentage}%
                  </ThemedText>
                ) : null}
              </View>
            </View>
          </View>

          {percentage === 100 ? (
            <LinearGradient
              colors={[`${AppColors.success}18`, `${AppColors.success}06`]}
              style={[
                styles.completeBanner,
                { borderColor: `${AppColors.success}25` },
              ]}
            >
              <Feather
                name="check-circle"
                size={22}
                color={AppColors.success}
              />
              <ThemedText
                style={[styles.completeText, { color: AppColors.success }]}
              >
                All attendees have checked in!
              </ThemedText>
            </LinearGradient>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  heroCard: {
    borderRadius: BorderRadius["2xl"],
    padding: Spacing["2xl"],
    marginBottom: Spacing["2xl"],
    overflow: "hidden",
  },
  heroBlob: {
    position: "absolute",
    top: -50,
    right: -50,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: `${AppColors.accent}28`,
  },
  heroLabel: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
  },
  heroValue: {
    color: "#fff",
    fontSize: 80,
    fontWeight: "800",
    lineHeight: 86,
    letterSpacing: -4,
    marginBottom: Spacing.lg,
  },
  progressTrack: {
    height: 8,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 4,
    overflow: "hidden",
    marginBottom: Spacing.md,
  },
  progressFill: { height: "100%", borderRadius: 4 },
  heroSub: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 13,
    marginBottom: Spacing.xl,
  },
  heroStatRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
  },
  heroStat: { flex: 1, alignItems: "center" },
  heroStatNum: { color: "#fff", fontSize: 22, fontWeight: "800" },
  heroStatLabel: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
  },
  heroStatDivider: {
    width: 1,
    height: 28,
    backgroundColor: "rgba(255,255,255,0.15)",
  },

  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: Spacing.md,
  },
  row: { flexDirection: "row", gap: Spacing.md, marginBottom: Spacing.md },

  summaryCard: {
    borderRadius: BorderRadius.xl,
    overflow: "hidden",
    borderWidth: 1,
    ...Shadows.card,
    marginBottom: Spacing.lg,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.lg,
  },
  summaryLeft: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  dot: { width: 10, height: 10, borderRadius: 5 },
  summaryItem: { fontSize: 15, fontWeight: "600" },
  summaryRight: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  summaryValue: { fontSize: 22, fontWeight: "800" },
  summaryPct: { fontSize: 13, fontWeight: "600" },
  divider: { height: 1, marginHorizontal: Spacing.lg },

  completeBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
  },
  completeText: { fontSize: 15, fontWeight: "700" },
});
