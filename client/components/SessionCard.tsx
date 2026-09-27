import React from "react";
import { StyleSheet, View, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing, Shadows } from "@/constants/theme";

interface SessionCardProps {
  title: string;
  speaker?: string;
  time: string;
  location?: string;
  track?: string;
  onPress?: () => void;
}

export function SessionCard({
  title,
  speaker,
  time,
  location,
  track,
  onPress,
}: SessionCardProps) {
  const { theme } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.container,
        { backgroundColor: theme.cardBackground, opacity: pressed ? 0.95 : 1 },
        Shadows.small,
      ]}
    >
      <View style={styles.content}>
        <View style={styles.header}>
          <ThemedText type="h4" style={styles.title} numberOfLines={2}>
            {title}
          </ThemedText>
        </View>

        {speaker ? (
          <View style={styles.row}>
            <Feather name="user" size={14} color={theme.textSecondary} />
            <ThemedText
              style={[styles.meta, { color: theme.textSecondary }]}
              numberOfLines={2}
            >
              {speaker}
            </ThemedText>
          </View>
        ) : null}

        <View style={styles.footer}>
          <View style={styles.row}>
            <Feather name="clock" size={14} color={theme.primary} />
            <ThemedText
              style={[styles.meta, { color: theme.primary, fontWeight: "500" }]}
              numberOfLines={2}
            >
              {time}
            </ThemedText>
          </View>

          {location ? (
            <View style={styles.row}>
              <Feather name="map-pin" size={14} color={theme.textSecondary} />
              <ThemedText
                style={[styles.meta, { color: theme.textSecondary }]}
                numberOfLines={2}
              >
                {location}
              </ThemedText>
            </View>
          ) : null}
        </View>

        {track ? (
          <View style={[styles.trackBadge, { backgroundColor: "#7C3AED15" }]}>
            <ThemedText style={[styles.trackText, { color: "#7C3AED" }]}>
              {track}
            </ThemedText>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.md,
    overflow: "hidden",
  },
  content: {
    padding: Spacing.lg,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: Spacing.sm,
  },
  title: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.xs,
  },
  meta: {
    fontSize: 14,
    marginLeft: Spacing.xs,
  },
  footer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  trackBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.xs,
    marginTop: Spacing.sm,
  },
  trackText: {
    fontSize: 12,
    fontWeight: "600",
  },
});
