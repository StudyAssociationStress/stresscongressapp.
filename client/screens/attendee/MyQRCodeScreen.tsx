import React from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { getScreenContentTopPadding } from "@/hooks/useScreenOptions";
import QRCode from "react-native-qrcode-svg";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { useEventTheme } from "@/contexts/EventThemeContext";
import { AppColors, BorderRadius, Spacing, Shadows } from "@/constants/theme";
import { Feather } from "@expo/vector-icons";

export default function MyQRCodeScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { user } = useAuth();
  const eventTheme = useEventTheme();
  const { width } = useWindowDimensions();

  const qrValue = user?.qrCodeValue || "NO_QR_CODE";
  const accentColor = eventTheme.accentColor;
  const qrSize = Math.min(220, Math.max(128, width - 152));

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.backgroundRoot,
          paddingTop: getScreenContentTopPadding(headerHeight, Spacing.xl),
          paddingBottom: insets.bottom + Spacing.xl,
        },
      ]}
    >
      <View style={styles.content}>
        {user?.checkedIn ? (
          <View
            style={[
              styles.statusBadge,
              {
                backgroundColor: `${AppColors.success}14`,
                borderColor: `${AppColors.success}22`,
              },
            ]}
          >
            <Feather name="check-circle" size={15} color={AppColors.success} />
            <ThemedText
              style={[styles.statusText, { color: AppColors.success }]}
            >
              Checked In to Event
            </ThemedText>
          </View>
        ) : (
          <View
            style={[
              styles.statusBadge,
              {
                backgroundColor: `${accentColor}12`,
                borderColor: `${accentColor}20`,
              },
            ]}
          >
            <Feather name="info" size={15} color={accentColor} />
            <ThemedText style={[styles.statusText, { color: accentColor }]}>
              Show this QR code at check-in
            </ThemedText>
          </View>
        )}

        <View
          style={[
            styles.qrCard,
            {
              backgroundColor: theme.cardBackground,
              borderColor: theme.cardBorder,
            },
            Shadows.large,
          ]}
        >
          <View style={styles.qrHeader}>
            <ThemedText style={[styles.qrCardTitle, { color: theme.text }]}>
              Event Access Pass
            </ThemedText>
          </View>

          <View style={styles.qrFrame}>
            <LinearGradient
              colors={[`${accentColor}18`, `${accentColor}06`]}
              style={styles.qrGradientFrame}
            >
              <View
                style={styles.qrInner}
                accessible
                accessibilityRole="image"
                accessibilityLabel="Your event check-in QR code"
              >
                <QRCode
                  value={qrValue}
                  size={qrSize}
                  color="#111827"
                  backgroundColor="#FFFFFF"
                />
              </View>
            </LinearGradient>
          </View>

          <View style={[styles.nameSection, { borderTopColor: theme.border }]}>
            <ThemedText style={[styles.attendeeName, { color: theme.text }]}>
              {user?.name || "Attendee"}
            </ThemedText>
            <ThemedText
              style={[styles.attendeeEmail, { color: theme.textSecondary }]}
            >
              {user?.email}
            </ThemedText>
          </View>
        </View>

        {!user?.checkedIn ? (
          <ThemedText style={[styles.helpText, { color: theme.textSecondary }]}>
            A staff member will scan this code to check you in to the event
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing["2xl"],
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
    borderRadius: BorderRadius.full,
    marginBottom: Spacing.xl,
    borderWidth: 1,
  },
  statusText: { fontSize: 14, fontWeight: "600" },
  qrCard: {
    borderRadius: BorderRadius["2xl"],
    width: "100%",
    maxWidth: 340,
    borderWidth: 1,
    overflow: "hidden",
    ...Shadows.large,
  },
  qrHeader: {
    padding: Spacing.xl,
    paddingBottom: Spacing.md,
    alignItems: "center",
  },
  qrCardTitle: { fontSize: 16, fontWeight: "700", letterSpacing: -0.2 },
  qrFrame: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.lg },
  qrGradientFrame: { borderRadius: BorderRadius.xl, padding: Spacing.md },
  qrInner: {
    backgroundColor: "#FFFFFF",
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    alignItems: "center",
  },
  nameSection: {
    padding: Spacing.xl,
    alignItems: "center",
    borderTopWidth: 1,
  },
  attendeeName: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  attendeeEmail: { fontSize: 13 },
  helpText: {
    marginTop: Spacing.xl,
    textAlign: "center",
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: Spacing.xl,
  },
});
