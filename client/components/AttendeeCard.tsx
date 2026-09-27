import React from "react";
import { StyleSheet, View, Pressable } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing, AppColors } from "@/constants/theme";
import { ImageLightbox } from "@/components/ImageLightbox";

interface AttendeeCardProps {
  name: string;
  email: string;
  checkedIn: boolean;
  role?: "attendee" | "staff";
  onPress?: () => void;
  onCheckIn?: () => void;
  onCheckOut?: () => void;
  photoUrl?: string | null;
}

function getInitials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

function getAvatarColor(name: string): [string, string] {
  const palettes: [string, string][] = [
    ["#0EA5E9", "#0284C7"],
    ["#8B5CF6", "#7C3AED"],
    ["#10B981", "#059669"],
    ["#F59E0B", "#D97706"],
    ["#EF4444", "#DC2626"],
    ["#EC4899", "#DB2777"],
    ["#06B6D4", "#0891B2"],
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++)
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return palettes[Math.abs(hash) % palettes.length];
}

export function AttendeeCard({
  name,
  email,
  checkedIn,
  role = "attendee",
  onPress,
  onCheckIn,
  onCheckOut,
  photoUrl,
}: AttendeeCardProps) {
  const { theme } = useTheme();
  const initials = getInitials(name);
  const avatarGrad = getAvatarColor(name);
  const isStaff = role === "staff";

  return (
    <View
      style={[
        styles.wrapper,
        { backgroundColor: theme.cardBackground, borderColor: theme.border },
      ]}
      testID={`card-attendee-${name}`}
    >
      <View style={styles.row}>
        {photoUrl ? (
          <ImageLightbox
            uri={photoUrl}
            style={styles.avatar}
            resizeMode="cover"
            shape="circle"
          />
        ) : (
          <LinearGradient colors={avatarGrad} style={styles.avatar}>
            <ThemedText style={styles.initials}>{initials}</ThemedText>
          </LinearGradient>
        )}

        <Pressable
          onPress={onPress}
          style={({ pressed }) => [
            styles.rowContent,
            { opacity: pressed && onPress ? 0.85 : 1 },
          ]}
        >
          <View style={styles.info}>
            <ThemedText
              style={[styles.name, { color: theme.text }]}
              numberOfLines={2}
            >
              {name}
            </ThemedText>
            <ThemedText
              style={[styles.email, { color: theme.textSecondary }]}
              numberOfLines={2}
            >
              {email}
            </ThemedText>
          </View>
          <View
            style={[
              styles.badge,
              {
                backgroundColor: isStaff
                  ? `${AppColors.primary}12`
                  : checkedIn
                    ? `${AppColors.success}12`
                    : "#F59E0B12",
              },
            ]}
          >
            <Feather
              name={isStaff ? "star" : checkedIn ? "check" : "clock"}
              size={11}
              color={
                isStaff
                  ? AppColors.primary
                  : checkedIn
                    ? AppColors.success
                    : "#D97706"
              }
            />
            <ThemedText
              style={[
                styles.badgeText,
                {
                  color: isStaff
                    ? AppColors.primary
                    : checkedIn
                      ? AppColors.success
                      : "#D97706",
                },
              ]}
            >
              {isStaff ? "Staff" : checkedIn ? "In" : "Pending"}
            </ThemedText>
          </View>
        </Pressable>
      </View>

      {/* Action button */}
      {!checkedIn && !isStaff && onCheckIn ? (
        <Pressable
          onPress={onCheckIn}
          style={({ pressed }) => [
            styles.actionBtn,
            { backgroundColor: AppColors.success, opacity: pressed ? 0.85 : 1 },
          ]}
          testID={`button-checkin-${name}`}
        >
          <Feather name="check" size={18} color="#fff" />
        </Pressable>
      ) : null}
      {checkedIn && !isStaff && onCheckOut ? (
        <Pressable
          onPress={onCheckOut}
          style={({ pressed }) => [
            styles.actionBtn,
            { backgroundColor: "#D97706", opacity: pressed ? 0.85 : 1 },
          ]}
          testID={`button-checkout-${name}`}
        >
          <Feather name="rotate-ccw" size={16} color="#fff" />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderRadius: BorderRadius.xl,
    marginBottom: Spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
    borderWidth: 1,
  },
  row: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.md,
    gap: Spacing.md,
  },
  rowContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.md,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  initials: { color: "#fff", fontSize: 15, fontWeight: "800" },
  info: { flex: 1 },
  name: { fontSize: 14, fontWeight: "700", marginBottom: 2 },
  email: { fontSize: 12 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
    flexShrink: 0,
  },
  badgeText: { fontSize: 11, fontWeight: "700" },
  actionBtn: {
    width: 52,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
  },
});
