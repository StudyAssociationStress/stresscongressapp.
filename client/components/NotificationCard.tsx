import React from "react";
import {
  StyleSheet,
  View,
  Pressable,
  Animated,
  PanResponder,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing, AppColors, Shadows } from "@/constants/theme";

interface NotificationCardProps {
  title: string;
  message: string;
  timestamp: string;
  type?: "announcement" | "reminder" | "alert";
  isRead?: boolean;
  onPress?: () => void;
  onDismiss?: () => void;
}

export function NotificationCard({
  title,
  message,
  timestamp,
  type = "announcement",
  isRead = false,
  onPress,
  onDismiss,
}: NotificationCardProps) {
  const { theme } = useTheme();
  const translateY = React.useRef(new Animated.Value(0)).current;
  const panResponder = React.useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          !!onDismiss &&
          Math.abs(gesture.dy) > 12 &&
          Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_, gesture) => {
          if (gesture.dy < 0) translateY.setValue(gesture.dy);
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy < -70 && onDismiss) {
            Animated.timing(translateY, {
              toValue: -180,
              duration: 180,
              useNativeDriver: true,
            }).start(onDismiss);
          } else {
            Animated.spring(translateY, {
              toValue: 0,
              useNativeDriver: true,
              bounciness: 8,
            }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        },
      }),
    [onDismiss, translateY],
  );

  const getIcon = (): keyof typeof Feather.glyphMap => {
    if (type === "reminder") return "clock";
    if (type === "alert") return "alert-circle";
    return "bell";
  };

  const getColor = () => {
    if (type === "reminder") return "#F59E0B";
    if (type === "alert") return AppColors.error;
    return AppColors.accent;
  };

  const color = getColor();

  return (
    <Animated.View
      style={{ transform: [{ translateY }] }}
      {...panResponder.panHandlers}
    >
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.container,
          {
            backgroundColor: theme.cardBackground,
            borderColor: isRead ? theme.border : color,
            opacity: pressed && onPress ? 0.85 : 1,
          },
        ]}
      >
        {/* Color accent bar for unread */}
        {!isRead ? (
          <View style={[styles.accentBar, { backgroundColor: color }]} />
        ) : null}

        <View style={styles.inner}>
          <View style={[styles.iconWrap, { backgroundColor: `${color}14` }]}>
            <Feather name={getIcon()} size={18} color={color} />
          </View>

          <View style={styles.body}>
            <View style={styles.titleRow}>
              <ThemedText
                style={[
                  styles.title,
                  { color: theme.text, opacity: isRead ? 0.6 : 1 },
                ]}
                numberOfLines={2}
              >
                {title}
              </ThemedText>
              <ThemedText
                style={[styles.time, { color: theme.textTertiary as string }]}
              >
                {timestamp}
              </ThemedText>
            </View>
            <ThemedText
              style={[
                styles.message,
                { color: theme.textSecondary, opacity: isRead ? 0.6 : 1 },
              ]}
              numberOfLines={3}
            >
              {message}
            </ThemedText>

            <View style={[styles.typePill, { backgroundColor: `${color}10` }]}>
              <ThemedText style={[styles.typeText, { color }]}>
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </ThemedText>
            </View>
          </View>

          {!isRead ? (
            <View style={[styles.dot, { backgroundColor: color }]} />
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: BorderRadius.xl,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    overflow: "hidden",
    ...Shadows.card,
  },
  accentBar: { height: 3, width: "100%" },
  inner: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  body: { flex: 1 },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    marginBottom: 4,
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
    flex: 1,
    minWidth: 0,
    letterSpacing: -0.1,
  },
  time: {
    fontSize: 11,
    fontWeight: "500",
    flexShrink: 1,
    maxWidth: 76,
    textAlign: "right",
    marginTop: 2,
  },
  message: { fontSize: 13, lineHeight: 19, marginBottom: Spacing.sm },
  typePill: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: BorderRadius.full,
  },
  typeText: { fontSize: 11, fontWeight: "700" },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
    flexShrink: 0,
  },
});
