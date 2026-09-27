import React from "react";
import { StyleSheet, Pressable } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { AppColors, BorderRadius, Spacing } from "@/constants/theme";
import { ImageLightbox } from "@/components/ImageLightbox";

interface SpeakerCardProps {
  name: string;
  title?: string;
  company?: string;
  photoUrl?: string;
  onPress?: () => void;
}

function getSpeakerInitials(name: string) {
  return (
    name
      .split(" ")
      .slice(0, 2)
      .map((n) => n[0])
      .join("")
      .toUpperCase() || "?"
  );
}

export function SpeakerCard({
  name,
  title,
  company,
  photoUrl,
  onPress,
}: SpeakerCardProps) {
  const { theme } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.container,
        {
          backgroundColor: theme.cardBackground,
          borderColor: theme.border,
          opacity: pressed ? 0.88 : 1,
        },
      ]}
    >
      {photoUrl ? (
        <ImageLightbox
          uri={photoUrl}
          style={styles.photo}
          resizeMode="cover"
          shape="circle"
        />
      ) : (
        <LinearGradient
          colors={[AppColors.primary, "#1a0080"]}
          style={styles.photo}
        >
          <ThemedText style={styles.initials}>
            {getSpeakerInitials(name)}
          </ThemedText>
        </LinearGradient>
      )}
      <ThemedText
        type="h4"
        style={[styles.name, { color: theme.text }]}
        numberOfLines={2}
      >
        {name}
      </ThemedText>
      {title ? (
        <ThemedText
          style={[styles.title, { color: theme.textSecondary }]}
          numberOfLines={1}
        >
          {title}
        </ThemedText>
      ) : null}
      {company ? (
        <ThemedText
          style={[styles.company, { color: AppColors.accent }]}
          numberOfLines={1}
        >
          {company}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    alignItems: "center",
    flex: 1,
    margin: Spacing.xs,
    borderWidth: 1,
  },
  photo: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginBottom: Spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
  initials: {
    color: "#fff",
    fontSize: 26,
    fontWeight: "800",
  },
  name: {
    textAlign: "center",
    fontSize: 16,
  },
  title: {
    fontSize: 13,
    textAlign: "center",
    marginTop: Spacing.xs,
  },
  company: {
    fontSize: 12,
    textAlign: "center",
    marginTop: Spacing.xs,
    fontWeight: "500",
  },
});
