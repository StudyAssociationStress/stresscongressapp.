import React, { useEffect } from "react";
import { StyleSheet, View, ViewStyle } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  interpolate,
} from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius } from "@/constants/theme";

interface SkeletonLoaderProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function SkeletonLoader({
  width = "100%",
  height = 20,
  borderRadius = BorderRadius.sm,
  style,
}: SkeletonLoaderProps) {
  const { theme, isDark } = useTheme();
  const shimmer = useSharedValue(0);

  useEffect(() => {
    shimmer.value = withRepeat(withTiming(1, { duration: 1200 }), -1, false);
  }, [shimmer]);

  const animatedStyle = useAnimatedStyle(() => {
    const opacity = interpolate(shimmer.value, [0, 0.5, 1], [0.3, 0.6, 0.3]);
    return { opacity };
  });

  return (
    <Animated.View
      style={[
        styles.skeleton,
        {
          width: width as any,
          height,
          borderRadius,
          backgroundColor: isDark
            ? theme.backgroundTertiary
            : theme.backgroundSecondary,
        },
        animatedStyle,
        style,
      ]}
    />
  );
}

export function CardSkeleton() {
  const { theme } = useTheme();

  return (
    <View
      style={[styles.cardSkeleton, { backgroundColor: theme.cardBackground }]}
    >
      <SkeletonLoader height={24} width="60%" style={styles.titleSkeleton} />
      <SkeletonLoader height={16} width="100%" style={styles.lineSkeleton} />
      <SkeletonLoader height={16} width="80%" />
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: {},
  cardSkeleton: {
    padding: 16,
    borderRadius: BorderRadius.lg,
    marginBottom: 12,
  },
  titleSkeleton: {
    marginBottom: 12,
  },
  lineSkeleton: {
    marginBottom: 8,
  },
});
