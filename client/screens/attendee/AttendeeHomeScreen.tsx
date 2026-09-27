import React from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  Platform,
  Linking,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation } from "@react-navigation/native";
import { getScreenContentTopPadding } from "@/hooks/useScreenOptions";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { useEventTheme } from "@/contexts/EventThemeContext";
import {
  BorderRadius,
  getEventGradientReadability,
  getReadableEventGradient,
  Shadows,
  Spacing,
} from "@/constants/theme";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { EventLogoImage } from "@/components/EventLogoImage";

const QUICK_ACTIONS = [
  {
    icon: "clock" as const,
    label: "Timetable",
    screen: "StaffSchedule",
    gradient: ["#0EA5E9", "#0284C7"] as [string, string],
  },
  {
    icon: "briefcase" as const,
    label: "Case Studies",
    screen: "Agenda",
    gradient: ["#8B5CF6", "#7C3AED"] as [string, string],
  },
  {
    icon: "grid" as const,
    label: "My QR Code",
    screen: "MyQRCode",
    gradient: ["#10B981", "#059669"] as [string, string],
  },
  {
    icon: "bell" as const,
    label: "Notifications",
    screen: "Notifications",
    gradient: ["#F59E0B", "#D97706"] as [string, string],
  },
];

function ActionCard({
  action,
  onPress,
}: {
  action: (typeof QUICK_ACTIONS)[0];
  onPress: () => void;
}) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={[styles.actionCard, animStyle]}>
      <Pressable
        style={{ flex: 1 }}
        onPress={onPress}
        onPressIn={() => {
          scale.value = withSpring(0.93, { damping: 18, stiffness: 220 });
        }}
        onPressOut={() => {
          scale.value = withSpring(1, { damping: 18, stiffness: 220 });
        }}
      >
        <LinearGradient
          colors={action.gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.actionGradient}
        >
          <View style={styles.actionIconWrap}>
            <Feather name={action.icon} size={22} color="#fff" />
          </View>
          <ThemedText style={styles.actionLabel}>{action.label}</ThemedText>
          <Feather
            name="arrow-right"
            size={14}
            color="rgba(255,255,255,0.6)"
            style={styles.actionArrow}
          />
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

export default function AttendeeHomeScreen() {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const headerHeight = useHeaderHeight();
  const navigation = useNavigation();
  const { theme } = useTheme();
  const { user } = useAuth();
  const eventTheme = useEventTheme();

  const accentColor = eventTheme.accentColor;
  const gradientColors = getReadableEventGradient(
    eventTheme.gradientStart,
    eventTheme.gradientEnd,
  );
  const gradientReadability = getEventGradientReadability(
    eventTheme.gradientStart,
    eventTheme.gradientEnd,
  );
  const firstName = user?.name?.split(" ")[0] || "there";

  const openMaps = () => {
    // Always search by the event's location name — no hardcoded coordinates that
    // can go stale when the venue changes. Admin updates the location in Event
    // Control → map opens at the right place automatically.
    const label = eventTheme.location;
    if (!label) return;
    const encoded = encodeURIComponent(label);
    const url = Platform.select({
      ios: `https://maps.apple.com/?q=${encoded}`,
      android: `geo:0,0?q=${encoded}`,
      default: `https://www.google.com/maps/search/?api=1&query=${encoded}`,
    });
    Linking.openURL(url!);
  };

  if (!eventTheme.isLoading && !eventTheme.eventId) {
    return (
      <View
        style={[
          styles.emptyState,
          {
            backgroundColor: theme.backgroundRoot,
            paddingTop: getScreenContentTopPadding(headerHeight, Spacing.lg),
            paddingBottom: insets.bottom + Spacing["3xl"],
          },
        ]}
      >
        <Feather
          name="calendar"
          size={36}
          color={theme.textSecondary as string}
        />
        <ThemedText type="h2" style={styles.emptyTitle}>
          No live event
        </ThemedText>
        <ThemedText
          style={[styles.emptyMessage, { color: theme.textSecondary }]}
        >
          There is no event available for this account right now. Please contact
          the event administrator.
        </ThemedText>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      contentContainerStyle={{
        paddingTop: getScreenContentTopPadding(headerHeight, Spacing.lg),
        paddingBottom: insets.bottom + Spacing["3xl"],
        paddingHorizontal: Spacing.lg,
      }}
      showsVerticalScrollIndicator={false}
    >
      {/* Hero Banner */}
      <LinearGradient
        colors={gradientColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.heroCard}
      >
        <View
          pointerEvents="none"
          style={[
            styles.gradientReadabilityOverlay,
            { backgroundColor: gradientReadability.overlay },
          ]}
        />
        <View style={styles.heroBlob1} />
        <View style={styles.heroBlob2} />
        <View style={styles.heroRow}>
          <View style={styles.heroLeft}>
            <ThemedText
              style={[
                styles.heroGreeting,
                { color: gradientReadability.mutedForeground },
              ]}
            >
              Hi, {firstName}
            </ThemedText>
            <ThemedText
              testID="attendee-event-name"
              style={[
                styles.heroEventName,
                { color: gradientReadability.foreground },
              ]}
              numberOfLines={3}
            >
              {eventTheme.eventName}
            </ThemedText>
            {eventTheme.tagline ? (
              <ThemedText
                testID="attendee-event-tagline"
                style={[
                  styles.heroTagline,
                  { color: gradientReadability.mutedForeground },
                ]}
                numberOfLines={3}
              >
                {eventTheme.tagline}
              </ThemedText>
            ) : null}
            {eventTheme.displayDate?.trim() ? (
              <View style={styles.heroDateRow}>
                <Feather
                  name="calendar"
                  size={12}
                  color={gradientReadability.mutedForeground}
                />
                <ThemedText
                  style={[
                    styles.heroDate,
                    { color: gradientReadability.mutedForeground },
                  ]}
                >
                  {eventTheme.displayDate}
                </ThemedText>
              </View>
            ) : null}
          </View>
          {eventTheme.logoUrl ? (
            <EventLogoImage
              imageTestID="event-logo"
              uri={eventTheme.logoUrl}
              shape={eventTheme.logoShape}
              zoom={eventTheme.logoZoom}
              offsetX={eventTheme.logoOffsetX}
              offsetY={eventTheme.logoOffsetY}
              maxWidth={Math.min(144, windowWidth * 0.34)}
              maxHeight={96}
              accessibilityLabel={`${eventTheme.eventName} logo`}
              frameStyle={styles.heroLogo}
            />
          ) : null}
        </View>
      </LinearGradient>

      {/* Quick Access */}
      <View style={styles.sectionHeader}>
        <ThemedText
          style={[styles.sectionLabel, { color: theme.textTertiary as string }]}
        >
          Quick Access
        </ThemedText>
      </View>
      <View style={styles.actionsGrid}>
        {QUICK_ACTIONS.map((action) => (
          <ActionCard
            key={action.screen}
            action={action}
            onPress={() => navigation.navigate(action.screen as never)}
          />
        ))}
      </View>

      {/* Event Details */}
      <View style={styles.sectionHeader}>
        <ThemedText
          style={[styles.sectionLabel, { color: theme.textTertiary as string }]}
        >
          Event Details
        </ThemedText>
      </View>
      <View
        style={[
          styles.detailCard,
          { backgroundColor: theme.cardBackground, borderColor: theme.border },
        ]}
      >
        <Pressable
          style={({ pressed }) => [
            styles.detailRow,
            { opacity: pressed ? 0.7 : 1 },
          ]}
          onPress={openMaps}
        >
          <LinearGradient
            colors={[accentColor, `${accentColor}BB`]}
            style={styles.detailIconGrad}
          >
            <Feather name="map-pin" size={17} color="#fff" />
          </LinearGradient>
          <View style={styles.detailText}>
            <ThemedText
              style={[
                styles.detailLabel,
                { color: theme.textTertiary as string },
              ]}
            >
              Venue
            </ThemedText>
            <ThemedText style={[styles.detailValue, { color: theme.text }]}>
              {eventTheme.location || "Venue not set"}
            </ThemedText>
            <ThemedText style={[styles.detailAction, { color: accentColor }]}>
              Open in Maps
            </ThemedText>
          </View>
          <Feather
            name="chevron-right"
            size={16}
            color={theme.textTertiary as string}
          />
        </Pressable>
        <View
          style={[styles.detailDivider, { backgroundColor: theme.border }]}
        />
        <View style={styles.detailRow}>
          <LinearGradient
            colors={["#0EA5E9", "#0284C7"]}
            style={styles.detailIconGrad}
          >
            <Feather name="clock" size={17} color="#fff" />
          </LinearGradient>
          <View style={styles.detailText}>
            <ThemedText
              style={[
                styles.detailLabel,
                { color: theme.textTertiary as string },
              ]}
            >
              Schedule
            </ThemedText>
            <ThemedText style={[styles.detailValue, { color: theme.text }]}>
              {eventTheme.scheduleStart && eventTheme.scheduleEnd
                ? `${eventTheme.scheduleStart} – ${eventTheme.scheduleEnd}`
                : "Schedule to be announced"}
            </ThemedText>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  gradientReadabilityOverlay: {
    ...StyleSheet.absoluteFill,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing["2xl"],
  },
  emptyTitle: {
    marginTop: Spacing.lg,
    textAlign: "center",
  },
  emptyMessage: {
    marginTop: Spacing.sm,
    maxWidth: 360,
    textAlign: "center",
    lineHeight: 22,
  },

  heroCard: {
    borderRadius: BorderRadius["2xl"],
    padding: Spacing["2xl"],
    marginBottom: Spacing.lg,
    overflow: "hidden",
  },
  heroBlob1: {
    position: "absolute",
    top: -50,
    right: -50,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  heroBlob2: {
    position: "absolute",
    bottom: -30,
    left: -30,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "rgba(255,255,255,0.07)",
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: Spacing.lg,
  },
  heroLeft: { flex: 1, minWidth: 0, marginRight: Spacing.sm },
  heroLogo: {
    marginLeft: Spacing.md,
  },
  heroGreeting: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 2,
  },
  heroName: {
    color: "#fff",
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.5,
    marginBottom: Spacing.sm,
  },
  heroDateRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  heroDate: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontWeight: "500",
    flexShrink: 1,
  },
  heroEventName: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "800",
    lineHeight: 24,
    letterSpacing: -0.4,
    marginBottom: Spacing.sm,
  },
  heroTagline: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 13,
    lineHeight: 18,
    marginBottom: Spacing.sm,
  },

  sectionHeader: { marginBottom: Spacing.md },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
  },

  actionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.md,
    marginBottom: Spacing["2xl"],
  },
  actionCard: {
    width: "48%",
    flexGrow: 1,
    minWidth: 140,
    borderRadius: BorderRadius.xl,
    overflow: "hidden",
    ...Shadows.medium,
  },
  actionGradient: {
    padding: Spacing.xl,
    borderRadius: BorderRadius.xl,
    minHeight: 110,
    justifyContent: "space-between",
  },
  actionIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.sm,
  },
  actionLabel: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
    letterSpacing: -0.2,
  },
  actionArrow: { alignSelf: "flex-end", marginTop: 4 },

  detailCard: {
    borderRadius: BorderRadius.xl,
    overflow: "hidden",
    borderWidth: 1,
    ...Shadows.card,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    padding: Spacing.lg,
  },
  detailIconGrad: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  detailText: { flex: 1 },
  detailLabel: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  detailValue: { fontSize: 15, fontWeight: "600", marginBottom: 2 },
  detailAction: { fontSize: 12, fontWeight: "600" },
  detailDivider: { height: 1, marginLeft: 70 },
});
