import React from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { getScreenContentTopPadding } from "@/hooks/useScreenOptions";
import { useQuery } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useEventTheme } from "@/contexts/EventThemeContext";
import { AppColors, BorderRadius, Spacing, Shadows } from "@/constants/theme";

interface TimetableItem {
  id: string;
  time: string;
  activity1: string;
  activity2?: string | null;
  duration: string;
  location?: string | null;
  category: string;
  sortOrder: number;
}

const CATEGORY: Record<
  string,
  { icon: keyof typeof Feather.glyphMap; color: string; label: string }
> = {
  registration: {
    icon: "clipboard",
    color: AppColors.accent,
    label: "Registration",
  },
  session: { icon: "monitor", color: "#7C3AED", label: "Talk / Session" },
  break: { icon: "coffee", color: "#16A34A", label: "Break" },
  social: { icon: "message-circle", color: "#0891B2", label: "Networking" },
};

export default function StaffScheduleScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const eventTheme = useEventTheme();
  const {
    data: timetableData,
    isLoading,
    refetch,
    isRefetching,
  } = useQuery<TimetableItem[]>({
    queryKey: ["/api/timetable"],
  });
  const scheduleData = timetableData ?? [];

  if (isLoading) {
    return (
      <View
        style={[
          styles.container,
          styles.centered,
          { backgroundColor: theme.backgroundRoot },
        ]}
      >
        <ActivityIndicator size="large" color={AppColors.accent} />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      contentContainerStyle={{
        paddingTop: getScreenContentTopPadding(headerHeight, Spacing.xl),
        paddingBottom: insets.bottom + Spacing["3xl"],
        paddingHorizontal: Spacing.lg,
      }}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={refetch}
          tintColor={theme.primary}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      {eventTheme.displayDate?.trim() ? (
        <LinearGradient
          colors={[AppColors.primary, "#1a0a7a"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.dateBanner}
        >
          <Feather name="calendar" size={18} color="rgba(255,255,255,0.8)" />
          <ThemedText style={styles.dateBannerText}>
            {eventTheme.displayDate}
          </ThemedText>
        </LinearGradient>
      ) : null}

      <View style={styles.legendRow}>
        {Object.entries(CATEGORY).map(([key, cfg]) => (
          <View
            key={key}
            style={[styles.legendPill, { backgroundColor: `${cfg.color}12` }]}
          >
            <View style={[styles.legendDot, { backgroundColor: cfg.color }]} />
            <ThemedText style={[styles.legendText, { color: cfg.color }]}>
              {cfg.label}
            </ThemedText>
          </View>
        ))}
      </View>

      <View style={styles.sectionHeader}>
        <ThemedText
          style={[styles.sectionLabel, { color: theme.textTertiary as string }]}
        >
          Programme
        </ThemedText>
      </View>

      {scheduleData.length === 0 ? (
        <View
          style={[
            styles.empty,
            {
              backgroundColor: theme.cardBackground,
              borderColor: theme.border,
            },
          ]}
        >
          <Feather name="calendar" size={26} color={AppColors.accent} />
          <ThemedText style={[styles.emptyTitle, { color: theme.text }]}>
            No timetable published yet
          </ThemedText>
          <ThemedText
            style={[styles.emptyText, { color: theme.textSecondary }]}
          >
            The event team has not added programme details yet.
          </ThemedText>
        </View>
      ) : (
        <View style={styles.timeline}>
          {scheduleData.map((item, index) => {
            const cfg = CATEGORY[item.category] || CATEGORY.session;
            const isLast = index === scheduleData.length - 1;
            return (
              <View key={item.id} style={styles.timelineRow}>
                <View style={styles.timeCol}>
                  <ThemedText style={[styles.timeText, { color: theme.text }]}>
                    {item.time}
                  </ThemedText>
                </View>

                <View style={styles.dotCol}>
                  <View style={[styles.dot, { backgroundColor: cfg.color }]}>
                    <Feather name={cfg.icon} size={12} color="#fff" />
                  </View>
                  {!isLast ? (
                    <View
                      style={[
                        styles.line,
                        { backgroundColor: `${cfg.color}25` },
                      ]}
                    />
                  ) : null}
                </View>

                <View
                  style={[
                    styles.eventCard,
                    {
                      backgroundColor: theme.cardBackground,
                      borderColor: theme.cardBorder,
                    },
                  ]}
                >
                  <View style={styles.eventHeader}>
                    <ThemedText
                      style={[styles.eventTitle, { color: theme.text }]}
                      numberOfLines={2}
                    >
                      {item.activity1}
                    </ThemedText>
                    <View style={styles.eventActions}>
                      <View
                        style={[
                          styles.durationPill,
                          { backgroundColor: `${cfg.color}12` },
                        ]}
                      >
                        <ThemedText
                          style={[styles.durationText, { color: cfg.color }]}
                        >
                          {item.duration}
                        </ThemedText>
                      </View>
                    </View>
                  </View>
                  {item.activity2 ? (
                    <View
                      style={[
                        styles.altActivity,
                        { backgroundColor: theme.backgroundSecondary },
                      ]}
                    >
                      <Feather
                        name="plus"
                        size={11}
                        color={theme.textSecondary}
                      />
                      <ThemedText
                        style={[styles.altText, { color: theme.textSecondary }]}
                      >
                        {item.activity2}
                      </ThemedText>
                    </View>
                  ) : null}
                  {item.location ? (
                    <View style={styles.locationRow}>
                      <Feather
                        name="map-pin"
                        size={11}
                        color={accentFade(cfg.color)}
                      />
                      <ThemedText
                        style={[
                          styles.locationText,
                          { color: theme.textTertiary as string },
                        ]}
                      >
                        {item.location}
                      </ThemedText>
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const accentFade = (color: string) => color;

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { justifyContent: "center", alignItems: "center" },
  dateBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.lg,
    borderRadius: BorderRadius.xl,
    marginBottom: Spacing.xl,
    overflow: "hidden",
  },
  dateBannerText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  legendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  legendPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
  },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendText: { fontSize: 11, fontWeight: "700" },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.9,
    marginBottom: Spacing.md,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  savedFilter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  timeline: { paddingLeft: 2 },
  empty: {
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing["2xl"],
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
  },
  emptyTitle: { fontSize: 16, fontWeight: "700", marginTop: Spacing.sm },
  emptyText: { fontSize: 13, textAlign: "center", lineHeight: 19 },
  timelineRow: {
    flexDirection: "row",
    minHeight: 88,
    marginBottom: Spacing.sm,
  },
  timeCol: {
    width: 50,
    paddingTop: 7,
    alignItems: "flex-end",
    paddingRight: Spacing.sm,
  },
  timeText: { fontSize: 12, fontWeight: "700", fontVariant: ["tabular-nums"] },
  dotCol: { width: 30, alignItems: "center" },
  dot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  line: { width: 2, flex: 1, marginTop: 2 },
  eventCard: {
    flex: 1,
    borderRadius: BorderRadius.xl,
    padding: Spacing.md,
    marginLeft: Spacing.sm,
    borderWidth: 1,
    ...Shadows.card,
  },
  eventHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: Spacing.sm,
  },
  eventActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    flexShrink: 0,
  },
  eventTitle: { fontSize: 14, fontWeight: "600", flex: 1, letterSpacing: -0.1 },
  durationPill: {
    borderRadius: BorderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  durationText: { fontSize: 11, fontWeight: "600" },
  altActivity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: Spacing.sm,
    paddingVertical: 4,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  altText: { fontSize: 12 },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: Spacing.sm,
  },
  locationText: { fontSize: 11, fontStyle: "italic" },
});
