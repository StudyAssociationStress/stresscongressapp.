import React from "react";
import { StyleSheet, View, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing, Shadows, AppColors } from "@/constants/theme";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: keyof typeof Feather.glyphMap;
  iconColor?: string;
  onPress?: () => void;
}

export function StatCard({
  title,
  value,
  icon,
  iconColor = AppColors.accent,
  onPress,
}: StatCardProps) {
  const { theme } = useTheme();

  const card = (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.cardBackground, borderColor: theme.border },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: `${iconColor}14` }]}>
        <Feather name={icon} size={20} color={iconColor} />
      </View>
      <ThemedText style={[styles.value, { color: theme.text }]}>
        {value}
      </ThemedText>
      <ThemedText style={[styles.title, { color: theme.textSecondary }]}>
        {title}
      </ThemedText>
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1, flex: 1 }]}
      >
        {card}
      </Pressable>
    );
  }

  return <View style={{ flex: 1 }}>{card}</View>;
}

const styles = StyleSheet.create({
  container: {
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    alignItems: "flex-start",
    borderWidth: 1,
    ...Shadows.card,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 13,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  value: {
    fontSize: 32,
    fontWeight: "800",
    letterSpacing: -1.5,
    marginBottom: 4,
  },
  title: {
    fontSize: 12,
    fontWeight: "600",
  },
});
