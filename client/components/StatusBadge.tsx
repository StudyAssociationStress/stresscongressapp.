import React from "react";
import { StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { BorderRadius, AppColors } from "@/constants/theme";

interface StatusBadgeProps {
  status: "checked_in" | "pending" | "staff";
  size?: "small" | "medium";
}

export function StatusBadge({ status, size = "medium" }: StatusBadgeProps) {
  const getStatusConfig = () => {
    switch (status) {
      case "checked_in":
        return {
          label: "Checked In",
          color: AppColors.success,
          bgColor: "#D1FAE5",
        };
      case "pending":
        return {
          label: "Pending",
          color: AppColors.warning,
          bgColor: "#FEF3C7",
        };
      case "staff":
        return { label: "Staff", color: "#7C3AED", bgColor: "#EDE9FE" };
      default:
        return { label: "Unknown", color: "#6B7280", bgColor: "#F3F4F6" };
    }
  };

  const config = getStatusConfig();
  const isSmall = size === "small";

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: config.bgColor,
          paddingVertical: isSmall ? 2 : 4,
          paddingHorizontal: isSmall ? 8 : 12,
        },
      ]}
    >
      <ThemedText
        style={[
          styles.text,
          {
            color: config.color,
            fontSize: isSmall ? 10 : 12,
          },
        ]}
      >
        {config.label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: BorderRadius.full,
    alignSelf: "flex-start",
  },
  text: {
    fontWeight: "600",
    textTransform: "uppercase",
  },
});
