import React from "react";
import {
  Modal,
  View,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { AppColors, BorderRadius, Spacing } from "@/constants/theme";

interface ConfirmModalProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
  danger?: boolean;
}

export function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel = "Confirm",
  onConfirm,
  onCancel,
  isLoading = false,
  danger = true,
}: ConfirmModalProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const confirmColor = danger ? AppColors.error : AppColors.primary;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      <View style={styles.overlay}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.cardBackground,
              paddingBottom: Spacing["2xl"] + insets.bottom,
            },
          ]}
        >
          <View
            style={[styles.iconWrap, { backgroundColor: `${confirmColor}15` }]}
          >
            <Feather
              name={danger ? "alert-triangle" : "help-circle"}
              size={28}
              color={confirmColor}
            />
          </View>
          <ThemedText type="h4" style={styles.title}>
            {title}
          </ThemedText>
          <ThemedText style={[styles.message, { color: theme.textSecondary }]}>
            {message}
          </ThemedText>
          <View style={styles.buttons}>
            <Pressable
              onPress={onCancel}
              disabled={isLoading}
              style={[
                styles.btn,
                { backgroundColor: theme.backgroundSecondary },
              ]}
              testID="button-confirm-cancel"
            >
              <ThemedText
                style={styles.btnText}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.85}
              >
                Cancel
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              disabled={isLoading}
              style={[styles.btn, { backgroundColor: confirmColor }]}
              testID="button-confirm-ok"
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <ThemedText
                  style={[styles.btnText, { color: "#fff", fontWeight: "700" }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.85}
                >
                  {confirmLabel}
                </ThemedText>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  card: {
    width: "100%",
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    padding: Spacing["2xl"],
    alignItems: "center",
    gap: Spacing.md,
  },
  iconWrap: {
    width: 60,
    height: 60,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xs,
  },
  title: {
    textAlign: "center",
  },
  message: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  buttons: {
    flexDirection: "row",
    alignItems: "stretch",
    justifyContent: "space-between",
    gap: Spacing.md,
    marginTop: Spacing.sm,
    width: "100%",
  },
  btn: {
    flex: 0,
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: "auto",
    width: "48%",
    minWidth: 110,
    minHeight: 52,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: {
    fontWeight: "600",
    textAlign: "center",
    flexShrink: 0,
  },
});
