import React, { ReactNode } from "react";
import { StyleSheet, Pressable, ViewStyle, StyleProp } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  WithSpringConfig,
} from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { AppColors, BorderRadius, Spacing } from "@/constants/theme";

export interface ButtonProps {
  onPress?: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  testID?: string;
  variant?: "primary" | "secondary" | "ghost";
  textColor?: string;
}

const springConfig: WithSpringConfig = {
  damping: 18,
  mass: 0.25,
  stiffness: 180,
  overshootClamping: true,
  energyThreshold: 0.001,
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function Button({
  onPress,
  children,
  style,
  disabled = false,
  testID,
  variant = "primary",
  textColor,
}: ButtonProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    if (!disabled) {
      scale.value = withSpring(0.97, springConfig);
    }
  };

  const handlePressOut = () => {
    if (!disabled) {
      scale.value = withSpring(1, springConfig);
    }
  };

  const getBackground = () => {
    if (variant === "secondary") return `${AppColors.accent}14`;
    if (variant === "ghost") return "transparent";
    return AppColors.accent;
  };

  const getTextColor = () => {
    if (textColor) return textColor;
    if (variant === "secondary") return AppColors.accent;
    if (variant === "ghost") return AppColors.accent;
    return "#FFFFFF";
  };

  return (
    <AnimatedPressable
      onPress={disabled ? undefined : onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      style={[
        styles.button,
        {
          backgroundColor: getBackground(),
          opacity: disabled ? 0.45 : 1,
        },
        style,
        animatedStyle,
      ]}
      testID={testID}
    >
      <ThemedText
        type="body"
        style={[styles.buttonText, { color: getTextColor() }]}
      >
        {children}
      </ThemedText>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: Spacing.buttonHeight,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing["2xl"],
  },
  buttonText: {
    fontWeight: "600",
    fontSize: 16,
    letterSpacing: -0.1,
    textAlign: "center",
    flexShrink: 1,
  },
});
