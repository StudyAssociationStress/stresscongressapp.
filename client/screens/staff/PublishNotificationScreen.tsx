import React, { useState } from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { getScreenContentTopPadding } from "@/hooks/useScreenOptions";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { apiRequest } from "@/lib/query-client";
import { useAdminEvent } from "@/contexts/AdminEventContext";
import { AppColors, BorderRadius, Spacing, Shadows } from "@/constants/theme";

type NotificationType = "announcement" | "reminder" | "alert";
type TargetRole = "all" | "attendee" | "staff";

const TYPE_OPTIONS: {
  value: NotificationType;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  color: string;
}[] = [
  {
    value: "announcement",
    label: "Announcement",
    icon: "volume-2",
    color: "#7C3AED",
  },
  {
    value: "reminder",
    label: "Reminder",
    icon: "clock",
    color: AppColors.accent,
  },
  {
    value: "alert",
    label: "Alert",
    icon: "alert-triangle",
    color: AppColors.error,
  },
];

const TARGET_OPTIONS: { value: TargetRole; label: string }[] = [
  { value: "all", label: "Everyone" },
  { value: "attendee", label: "Attendees Only" },
  { value: "staff", label: "Staff Only" },
];

export default function PublishNotificationScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { adminEventId } = useAdminEvent();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [type, setType] = useState<NotificationType>("announcement");
  const [targetRole, setTargetRole] = useState<TargetRole>("all");
  const [success, setSuccess] = useState(false);
  const [lastPushCount, setLastPushCount] = useState<number | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("/api/notifications", {
        method: "POST",
        body: JSON.stringify({
          title,
          message,
          type,
          targetRole: targetRole === "all" ? null : targetRole,
          ...(adminEventId ? { eventId: adminEventId } : {}),
        }),
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      setLastPushCount(
        typeof data?.pushCount === "number" ? data.pushCount : null,
      );
      setTitle("");
      setMessage("");
      setType("announcement");
      setTargetRole("all");
      setSuccess(true);
      setTimeout(() => setSuccess(false), 5000);
    },
  });

  const canSubmit =
    title.trim().length > 0 && message.trim().length > 0 && !mutation.isPending;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      contentContainerStyle={{
        paddingTop: getScreenContentTopPadding(headerHeight, Spacing.xl),
        paddingBottom: insets.bottom + Spacing.xl,
        paddingHorizontal: Spacing.lg,
      }}
      keyboardShouldPersistTaps="handled"
    >
      {success ? (
        <View
          style={[
            styles.successBanner,
            { backgroundColor: `${AppColors.success}15` },
          ]}
        >
          <Feather name="check-circle" size={20} color={AppColors.success} />
          <ThemedText
            style={[styles.successText, { color: AppColors.success }]}
          >
            Published
            {lastPushCount !== null
              ? ` · queued for ${lastPushCount} device${lastPushCount !== 1 ? "s" : ""}`
              : " successfully"}
          </ThemedText>
        </View>
      ) : null}

      {mutation.isError ? (
        <View
          style={[
            styles.successBanner,
            { backgroundColor: `${AppColors.error}15` },
          ]}
        >
          <Feather name="alert-circle" size={20} color={AppColors.error} />
          <ThemedText style={[styles.successText, { color: AppColors.error }]}>
            Failed to publish notification
          </ThemedText>
        </View>
      ) : null}

      <View
        style={[
          styles.card,
          { backgroundColor: theme.cardBackground },
          Shadows.small,
        ]}
      >
        <ThemedText type="h4" style={styles.label}>
          Title
        </ThemedText>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: theme.backgroundSecondary,
              color: theme.text,
              borderColor: theme.border,
            },
          ]}
          placeholder="Enter notification title..."
          placeholderTextColor={theme.textSecondary}
          value={title}
          onChangeText={setTitle}
          testID="input-notification-title"
        />

        <ThemedText type="h4" style={styles.label}>
          Message
        </ThemedText>
        <TextInput
          style={[
            styles.textArea,
            {
              backgroundColor: theme.backgroundSecondary,
              color: theme.text,
              borderColor: theme.border,
            },
          ]}
          placeholder="Enter notification message..."
          placeholderTextColor={theme.textSecondary}
          value={message}
          onChangeText={setMessage}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          testID="input-notification-message"
        />

        <ThemedText type="h4" style={styles.label}>
          Type
        </ThemedText>
        <View style={styles.optionsRow}>
          {TYPE_OPTIONS.map((opt) => (
            <Pressable
              key={opt.value}
              style={[
                styles.optionChip,
                {
                  backgroundColor:
                    type === opt.value
                      ? `${opt.color}20`
                      : theme.backgroundSecondary,
                  borderColor: type === opt.value ? opt.color : theme.border,
                },
              ]}
              onPress={() => setType(opt.value)}
              testID={`button-type-${opt.value}`}
            >
              <Feather
                name={opt.icon}
                size={14}
                color={type === opt.value ? opt.color : theme.textSecondary}
              />
              <ThemedText
                style={[
                  styles.optionLabel,
                  {
                    color: type === opt.value ? opt.color : theme.textSecondary,
                  },
                ]}
              >
                {opt.label}
              </ThemedText>
            </Pressable>
          ))}
        </View>

        <ThemedText type="h4" style={styles.label}>
          Send To
        </ThemedText>
        <View style={styles.optionsRow}>
          {TARGET_OPTIONS.map((opt) => (
            <Pressable
              key={opt.value}
              style={[
                styles.optionChip,
                {
                  backgroundColor:
                    targetRole === opt.value
                      ? `${AppColors.accent}20`
                      : theme.backgroundSecondary,
                  borderColor:
                    targetRole === opt.value ? AppColors.accent : theme.border,
                },
              ]}
              onPress={() => setTargetRole(opt.value)}
              testID={`button-target-${opt.value}`}
            >
              <ThemedText
                style={[
                  styles.optionLabel,
                  {
                    color:
                      targetRole === opt.value
                        ? AppColors.accent
                        : theme.textSecondary,
                  },
                ]}
              >
                {opt.label}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      </View>

      <Pressable
        style={[
          styles.publishButton,
          {
            backgroundColor: canSubmit
              ? AppColors.accent
              : theme.backgroundTertiary,
          },
        ]}
        onPress={() => mutation.mutate()}
        disabled={!canSubmit}
        testID="button-publish-notification"
      >
        {mutation.isPending ? (
          <ActivityIndicator color="#FFF" size="small" />
        ) : (
          <>
            <Feather name="send" size={18} color="#FFF" />
            <ThemedText style={styles.publishText}>
              Publish Notification
            </ThemedText>
          </>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  successBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.lg,
  },
  successText: {
    fontSize: 14,
    fontWeight: "600",
  },
  card: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: Spacing.sm,
    marginTop: Spacing.md,
  },
  input: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    fontSize: 15,
  },
  textArea: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    fontSize: 15,
    minHeight: 100,
  },
  optionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  optionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  optionLabel: {
    fontSize: 13,
    fontWeight: "500",
  },
  publishButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md + 2,
    borderRadius: BorderRadius.md,
  },
  publishText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "700",
  },
});
