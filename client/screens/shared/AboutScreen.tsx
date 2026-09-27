import React from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  Linking,
  Platform,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { getScreenContentTopPadding } from "@/hooks/useScreenOptions";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { GradientBackground } from "@/components/GradientBackground";
import { useTheme } from "@/hooks/useTheme";
import { AppColors, BorderRadius, Spacing, Shadows } from "@/constants/theme";
import { useEventTheme } from "@/contexts/EventThemeContext";

const APP_SUPPORT_EMAIL = "stresscongressapp@gmail.com";

interface InfoRowProps {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string;
  theme: any;
  onPress?: () => void;
}

function InfoRow({ icon, label, value, theme, onPress }: InfoRowProps) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.infoRow,
        { opacity: pressed && onPress ? 0.7 : 1 },
      ]}
      onPress={onPress}
      disabled={!onPress}
    >
      <View
        style={[styles.infoIcon, { backgroundColor: `${AppColors.accent}15` }]}
      >
        <Feather name={icon} size={18} color={AppColors.accent} />
      </View>
      <View style={styles.infoContent}>
        <ThemedText style={[styles.infoLabel, { color: theme.textSecondary }]}>
          {label}
        </ThemedText>
        <ThemedText style={styles.infoValue}>{value}</ThemedText>
      </View>
      {onPress ? (
        <Feather name="external-link" size={16} color={theme.textSecondary} />
      ) : null}
    </Pressable>
  );
}

export default function AboutScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const eventTheme = useEventTheme();

  const eventName = eventTheme.eventName || "No live event";
  const eventDate = eventTheme.displayDate?.trim() || "";
  const eventLocation = eventTheme.location || "Venue TBC";
  const eventTagline = eventTheme.tagline?.trim() || "";

  const handleOpenLink = (url: string) => {
    if (Platform.OS === "web") {
      window.open(url, "_blank");
    } else {
      Linking.openURL(url);
    }
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      contentContainerStyle={{
        paddingTop: getScreenContentTopPadding(headerHeight, Spacing.xl),
        paddingBottom: insets.bottom + Spacing.xl,
        paddingHorizontal: Spacing.lg,
      }}
    >
      <GradientBackground
        colors={[AppColors.primary, AppColors.primaryLight]}
        style={styles.heroCard}
      >
        <View
          style={[
            styles.appIcon,
            {
              backgroundColor: eventTheme.logoUrl ? "#fff" : "transparent",
              borderRadius: eventTheme.logoShape === "circle" ? 48 : 16,
              overflow: "hidden",
            },
          ]}
        >
          {eventTheme.logoUrl ? (
            <Image
              source={{ uri: eventTheme.logoUrl }}
              style={[
                styles.appIconImage,
                eventTheme.logoShape === "circle" && { borderRadius: 48 },
              ]}
              resizeMode="contain"
            />
          ) : null}
        </View>
        <ThemedText type="h2" style={styles.appName}>
          {eventName}
        </ThemedText>
        {eventTagline ? (
          <ThemedText style={styles.appTagline}>{eventTagline}</ThemedText>
        ) : null}
      </GradientBackground>

      <View
        style={[
          styles.section,
          { backgroundColor: theme.cardBackground },
          Shadows.small,
        ]}
      >
        <ThemedText
          type="h4"
          style={[styles.sectionTitle, { color: theme.textSecondary }]}
        >
          Event Details
        </ThemedText>
        {eventDate ? (
          <>
            <InfoRow
              icon="calendar"
              label="Date"
              value={eventDate}
              theme={theme}
            />
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
          </>
        ) : null}
        <InfoRow
          icon="map-pin"
          label="Venue"
          value={eventLocation}
          theme={theme}
        />
      </View>

      <View
        style={[
          styles.section,
          { backgroundColor: theme.cardBackground },
          Shadows.small,
        ]}
      >
        <ThemedText
          type="h4"
          style={[styles.sectionTitle, { color: theme.textSecondary }]}
        >
          Contact & Support
        </ThemedText>
        <InfoRow
          icon="mail"
          label="Email"
          value="secretary@stress.utwente.nl"
          theme={theme}
          onPress={() => handleOpenLink("mailto:secretary@stress.utwente.nl")}
        />
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <InfoRow
          icon="help-circle"
          label="App Support"
          value={APP_SUPPORT_EMAIL}
          theme={theme}
          onPress={() => handleOpenLink(`mailto:${APP_SUPPORT_EMAIL}`)}
        />
      </View>

      <View style={styles.footer}>
        <ThemedText style={[styles.footerText, { color: theme.textSecondary }]}>
          {eventName}
        </ThemedText>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  heroCard: {
    borderRadius: BorderRadius["2xl"],
    padding: Spacing["2xl"],
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  appIcon: {
    width: 88,
    height: 88,
    borderRadius: 18,
    marginBottom: Spacing.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  appIconImage: {
    width: 78,
    height: 78,
    borderRadius: 14,
  },
  appName: {
    color: AppColors.white,
    textAlign: "center",
    marginBottom: Spacing.xs,
  },
  appTagline: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 16,
    textAlign: "center",
    marginBottom: Spacing.lg,
  },
  section: {
    borderRadius: BorderRadius.xl,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: Spacing.sm,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.md,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
  },
  infoIcon: {
    width: 36,
    height: 36,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    marginRight: Spacing.md,
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 12,
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 15,
    fontWeight: "500",
  },
  divider: {
    height: 1,
    marginLeft: 52,
  },
  footer: {
    alignItems: "center",
    paddingVertical: Spacing.xl,
  },
  footerText: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: Spacing.xs,
  },
});
