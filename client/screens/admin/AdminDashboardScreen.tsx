import React from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  useWindowDimensions,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminEvent } from "@/contexts/AdminEventContext";
import { AppColors, BorderRadius, Spacing, Shadows } from "@/constants/theme";
import * as Haptics from "expo-haptics";

interface AdminStats {
  users: number;
  speakers: number;
  companies: number;
  caseStudies: number;
  timetable: number;
  notifications: number;
}

const TILES = [
  {
    key: "AdminUsers",
    icon: "users" as const,
    label: "Users",
    statKey: "users",
    gradient: ["#1D4ED8", "#1E40AF"] as [string, string],
  },
  {
    key: "AdminSpeakers",
    icon: "mic" as const,
    label: "Speakers",
    statKey: "speakers",
    gradient: ["#059669", "#047857"] as [string, string],
  },
  {
    key: "AdminCompanies",
    icon: "briefcase" as const,
    label: "Companies",
    statKey: "companies",
    gradient: ["#7C3AED", "#6D28D9"] as [string, string],
  },
  {
    key: "AdminCaseStudies",
    icon: "book-open" as const,
    label: "Case Studies",
    statKey: "caseStudies",
    gradient: [AppColors.accent, "#D97706"] as [string, string],
  },
  {
    key: "AdminTimetable",
    icon: "clock" as const,
    label: "Timetable",
    statKey: "timetable",
    gradient: ["#0369A1", "#075985"] as [string, string],
  },
  {
    key: "Notifications",
    icon: "bell" as const,
    label: "Notifications",
    statKey: "notifications",
    gradient: ["#BE185D", "#9D174D"] as [string, string],
  },
];

export default function AdminDashboardScreen() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isIPadLayout = Platform.OS === "ios" && width >= 768;
  const gridWidth = Math.max(0, width - Spacing.lg * 2);
  const tileWidth =
    width < 480
      ? gridWidth
      : width >= 900
        ? (gridWidth - Spacing.md * 2) / 3
        : (gridWidth - Spacing.md) / 2;
  const { adminEventId } = useAdminEvent();

  const { data: stats, isLoading } = useQuery<AdminStats>({
    queryKey: ["/api/admin/stats", adminEventId],
    queryFn: async () => {
      const res = await apiRequest(
        `/api/admin/stats${adminEventId ? `?eventId=${adminEventId}` : ""}`,
      );
      return res.json();
    },
    enabled: !!adminEventId,
  });

  const navigate = (key: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate(key);
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      contentContainerStyle={{
        paddingTop: Spacing.lg,
        paddingBottom: insets.bottom + Spacing["3xl"],
        paddingHorizontal: Spacing.lg,
      }}
      showsVerticalScrollIndicator={false}
    >
      {/* Hero */}
      <LinearGradient
        colors={[AppColors.primary, "#1a0a7a", "#2d1b8a"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.heroCard}
      >
        <View style={styles.heroBlob1} />
        <View style={styles.heroBlob2} />
        <View style={styles.heroTop}>
          <View style={styles.adminBadge}>
            <Feather name="shield" size={13} color="#fff" />
            <ThemedText style={styles.adminBadgeText} numberOfLines={1}>
              Administrator
            </ThemedText>
          </View>
          <View style={styles.heroAvatarWrap}>
            <ThemedText style={styles.heroAvatarText}>
              {user?.name
                ? user.name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .toUpperCase()
                    .slice(0, 2)
                : "AD"}
            </ThemedText>
          </View>
        </View>
        <View
          style={[
            Platform.OS === "ios" ? { marginTop: insets.top } : null,
            isIPadLayout && styles.heroCopyOnIPad,
          ]}
        >
          <ThemedText
            style={styles.heroTitle}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
          >
            Conference Administration
          </ThemedText>
          <ThemedText style={styles.heroSub} numberOfLines={3}>
            Full access — manage all conference content and settings
          </ThemedText>
        </View>
        {stats ? (
          <View style={styles.heroStatRow}>
            <View style={styles.heroStat}>
              <ThemedText style={styles.heroStatNum}>{stats.users}</ThemedText>
              <ThemedText style={styles.heroStatLabel}>Users</ThemedText>
            </View>
            <View style={styles.heroStatDivider} />
            <View style={styles.heroStat}>
              <ThemedText style={styles.heroStatNum}>
                {stats.caseStudies}
              </ThemedText>
              <ThemedText style={styles.heroStatLabel} numberOfLines={2}>
                Case Studies
              </ThemedText>
            </View>
            <View style={styles.heroStatDivider} />
            <View style={styles.heroStat}>
              <ThemedText style={styles.heroStatNum}>
                {stats.speakers}
              </ThemedText>
              <ThemedText style={styles.heroStatLabel}>Speakers</ThemedText>
            </View>
          </View>
        ) : null}
      </LinearGradient>

      {/* Management Tiles */}
      <ThemedText
        style={[styles.sectionLabel, { color: theme.textTertiary as string }]}
      >
        Content Management
      </ThemedText>
      <View style={styles.grid}>
        {TILES.map((tile) => {
          const count = stats ? ((stats as any)[tile.statKey] ?? 0) : null;
          return (
            <Pressable
              key={tile.key}
              testID={`button-admin-${tile.label.toLowerCase().replace(" ", "-")}`}
              onPress={() => navigate(tile.key)}
              style={({ pressed }) => [
                styles.tile,
                {
                  width: tileWidth,
                  backgroundColor: theme.cardBackground,
                  borderColor: theme.border,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <LinearGradient
                colors={tile.gradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.tileGradientBar}
              />
              <View style={styles.tileBody}>
                <View
                  style={[
                    styles.tileIconWrap,
                    { backgroundColor: `${tile.gradient[0]}14` },
                  ]}
                >
                  <Feather
                    name={tile.icon}
                    size={20}
                    color={tile.gradient[0]}
                  />
                </View>
                <ThemedText style={[styles.tileCount, { color: theme.text }]}>
                  {isLoading ? "—" : (count ?? 0)}
                </ThemedText>
                <ThemedText
                  style={[styles.tileLabel, { color: theme.textSecondary }]}
                >
                  {tile.label}
                </ThemedText>
              </View>
            </Pressable>
          );
        })}
      </View>
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
  heroBlob1: {
    position: "absolute",
    top: -40,
    right: -40,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: `${AppColors.accent}28`,
  },
  heroBlob2: {
    position: "absolute",
    bottom: -50,
    left: -50,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: Spacing.xl,
  },
  adminBadge: {
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.15)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
  },
  adminBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  heroAvatarWrap: {
    flexShrink: 0,
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.25)",
  },
  heroAvatarText: { color: "#fff", fontSize: 18, fontWeight: "800" },
  heroTitle: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  heroSub: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: Spacing.xl,
    maxWidth: "100%",
  },
  heroCopyOnIPad: {
    position: "relative",
    zIndex: 2,
  },
  heroStatRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
  },
  heroStat: { flex: 1, minWidth: 0, alignItems: "center" },
  heroStatNum: {
    color: "#fff",
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "800",
    textAlign: "center",
  },
  heroStatLabel: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
    textAlign: "center",
    minWidth: 0,
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

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  tile: {
    borderRadius: BorderRadius.xl,
    overflow: "hidden",
    borderWidth: 1,
    ...Shadows.card,
  },
  tileGradientBar: { height: 4 },
  tileBody: {
    minHeight: 156,
    padding: Spacing.xl,
    alignItems: "center",
    justifyContent: "flex-start",
  },
  tileIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.md,
  },
  tileCount: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: "800",
    letterSpacing: -1,
    marginBottom: 2,
    textAlign: "center",
  },
  tileLabel: {
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
    width: "100%",
  },

  infoBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
  },
  infoText: { flex: 1, fontSize: 13, lineHeight: 18 },
});
