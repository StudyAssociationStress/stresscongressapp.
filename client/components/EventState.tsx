import React from "react";
import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { AppColors, BorderRadius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/useTheme";

type EventStateProps = {
  title: string;
  message: string;
  icon?: keyof typeof Feather.glyphMap;
  actionLabel?: string;
  onAction?: () => void;
};

export function EventState({
  title,
  message,
  icon = "calendar",
  actionLabel,
  onAction,
}: EventStateProps) {
  const { theme } = useTheme();

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.cardBackground, borderColor: theme.border },
      ]}
    >
      <View
        style={[styles.iconWrap, { backgroundColor: `${AppColors.accent}14` }]}
      >
        <Feather name={icon} size={28} color={AppColors.accent} />
      </View>
      <ThemedText type="h4" style={styles.title}>
        {title}
      </ThemedText>
      <ThemedText style={[styles.message, { color: theme.textSecondary }]}>
        {message}
      </ThemedText>
      {actionLabel && onAction ? (
        <Button onPress={onAction} style={styles.action}>
          {actionLabel}
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    marginTop: Spacing.lg,
    padding: Spacing["2xl"],
  },
  iconWrap: {
    alignItems: "center",
    borderRadius: BorderRadius.lg,
    height: 64,
    justifyContent: "center",
    marginBottom: Spacing.lg,
    width: 64,
  },
  title: { textAlign: "center", marginBottom: Spacing.sm },
  message: { lineHeight: 20, textAlign: "center" },
  action: { marginTop: Spacing.lg },
});
