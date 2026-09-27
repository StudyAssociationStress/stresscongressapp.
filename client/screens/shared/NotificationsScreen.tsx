import React from "react";
import {
  StyleSheet,
  View,
  FlatList,
  RefreshControl,
  Modal,
  Pressable,
  Alert,
  ScrollView,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { getScreenContentTopPadding } from "@/hooks/useScreenOptions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NotificationCard } from "@/components/NotificationCard";
import { EmptyState } from "@/components/EmptyState";
import { CardSkeleton } from "@/components/SkeletonLoader";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import { apiRequest } from "@/lib/query-client";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminEvent } from "@/contexts/AdminEventContext";

interface Notification {
  id: string;
  title: string;
  message: string;
  type: "announcement" | "reminder" | "alert";
  createdAt: string;
  read?: boolean;
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { user, notificationDeviceId } = useAuth();
  const { adminEventId } = useAdminEvent();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "admin";
  const [selectedNotification, setSelectedNotification] =
    React.useState<Notification | null>(null);
  const [dismissedIds, setDismissedIds] = React.useState<Set<string>>(
    new Set(),
  );
  const [isMarkingAllRead, setIsMarkingAllRead] = React.useState(false);

  const {
    data: notifications = [],
    isLoading,
    refetch,
    isRefetching,
  } = useQuery<Notification[]>({
    queryKey: [
      isAdmin ? "/api/admin/notifications" : "/api/notifications",
      adminEventId,
      notificationDeviceId,
    ],
    queryFn: async () => {
      const endpoint = isAdmin
        ? `/api/admin/notifications${adminEventId ? `?eventId=${adminEventId}` : ""}`
        : `/api/notifications${notificationDeviceId ? `?deviceId=${encodeURIComponent(notificationDeviceId)}` : ""}`;
      const response = await apiRequest(endpoint);
      return response.json();
    },
    enabled: !!user && (!isAdmin || !!adminEventId),
  });

  const formatTimestamp = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const markRead = async (notification: Notification) => {
    if (isAdmin) {
      setSelectedNotification(notification);
      return;
    }
    if (!notification.read && !notification.id.startsWith("reminder-")) {
      try {
        await apiRequest(`/api/notifications/${notification.id}/read`, {
          method: "POST",
        });
        const updated = { ...notification, read: true };
        queryClient.setQueryData<Notification[]>(
          ["/api/notifications"],
          (current = []) =>
            current.map((item) =>
              item.id === notification.id ? updated : item,
            ),
        );
        setSelectedNotification(updated);
        await queryClient.invalidateQueries({
          queryKey: ["/api/notifications"],
        });
      } catch {
        // The notification remains visibly unread if the server could not confirm it.
      }
    } else {
      setSelectedNotification(notification);
    }
  };

  const markAllRead = async () => {
    setIsMarkingAllRead(true);
    try {
      await apiRequest("/api/notifications/read-all", { method: "POST" });
      queryClient.setQueryData<Notification[]>(
        ["/api/notifications"],
        (current = []) => current.map((item) => ({ ...item, read: true })),
      );
      await queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    } catch (error: any) {
      Alert.alert(
        "Could not mark notifications read",
        error.message || "Please try again.",
      );
    } finally {
      setIsMarkingAllRead(false);
    }
  };

  const dismissNotification = async (notification: Notification) => {
    if (notification.id.startsWith("reminder-")) return;
    setDismissedIds((current) => new Set(current).add(notification.id));
    try {
      await apiRequest(`/api/notifications/${notification.id}`, {
        method: "DELETE",
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    } catch (error: any) {
      setDismissedIds((current) => {
        const next = new Set(current);
        next.delete(notification.id);
        return next;
      });
      Alert.alert(
        "Could not dismiss notification",
        error.message || "Please try again.",
      );
    }
  };

  const renderNotification = ({ item }: { item: Notification }) => (
    <NotificationCard
      title={item.title}
      message={item.message}
      timestamp={formatTimestamp(item.createdAt)}
      type={item.type}
      isRead={item.read}
      onPress={() => void markRead(item)}
      onDismiss={isAdmin ? undefined : () => void dismissNotification(item)}
    />
  );

  const renderEmpty = () => (
    <EmptyState
      image={require("../../../assets/images/empty-notifications.png")}
      title="No Notifications Yet"
      message="You'll receive important announcements and reminders here"
    />
  );

  const renderLoading = () => (
    <View style={styles.loadingContainer}>
      <CardSkeleton />
      <CardSkeleton />
      <CardSkeleton />
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <FlatList
        data={notifications.filter((item) => !dismissedIds.has(item.id))}
        keyExtractor={(item) => item.id}
        renderItem={renderNotification}
        ListHeaderComponent={
          !isAdmin && notifications.length > 0 ? (
            <View style={styles.toolbar}>
              <ThemedText
                style={[styles.toolbarText, { color: theme.textSecondary }]}
              >
                {notifications.filter((item) => !item.read).length} unread
              </ThemedText>
              <Pressable
                onPress={() => void markAllRead()}
                disabled={
                  isMarkingAllRead || !notifications.some((item) => !item.read)
                }
                style={[
                  styles.readAllButton,
                  {
                    backgroundColor: theme.cardBackground,
                    borderColor: theme.border,
                    opacity:
                      isMarkingAllRead ||
                      !notifications.some((item) => !item.read)
                        ? 0.5
                        : 1,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Mark all notifications as read"
                testID="button-mark-all-notifications-read"
              >
                <Feather name="check-circle" size={15} color={theme.primary} />
                <ThemedText
                  style={{
                    color: theme.primary,
                    fontSize: 12,
                    fontWeight: "700",
                  }}
                >
                  {isMarkingAllRead ? "Saving…" : "Read all"}
                </ThemedText>
              </Pressable>
            </View>
          ) : null
        }
        ListEmptyComponent={isLoading ? renderLoading : renderEmpty}
        contentContainerStyle={{
          paddingTop: getScreenContentTopPadding(headerHeight, Spacing.xl),
          paddingBottom: insets.bottom + Spacing.xl,
          paddingHorizontal: Spacing.lg,
          flexGrow: 1,
        }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={theme.primary}
          />
        }
      />

      <Modal
        visible={selectedNotification !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedNotification(null)}
      >
        <View style={styles.detailOverlay}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close notification details"
            onPress={() => setSelectedNotification(null)}
            style={StyleSheet.absoluteFill}
          />
          {selectedNotification ? (
            <ScrollView
              style={[
                styles.detailCard,
                {
                  backgroundColor: theme.cardBackground,
                  borderColor: theme.border,
                },
              ]}
              contentContainerStyle={styles.detailCardContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.detailHeader}>
                <View
                  style={[
                    styles.detailIcon,
                    { backgroundColor: `${theme.primary}16` },
                  ]}
                >
                  <Feather
                    name={
                      selectedNotification.type === "reminder"
                        ? "clock"
                        : selectedNotification.type === "alert"
                          ? "alert-circle"
                          : "bell"
                    }
                    size={22}
                    color={
                      selectedNotification.type === "alert"
                        ? "#EF4444"
                        : theme.primary
                    }
                  />
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close notification details"
                  hitSlop={10}
                  onPress={() => setSelectedNotification(null)}
                  style={styles.detailClose}
                >
                  <Feather name="x" size={20} color={theme.textSecondary} />
                </Pressable>
              </View>
              <ThemedText style={[styles.detailType, { color: theme.primary }]}>
                {selectedNotification.type.charAt(0).toUpperCase() +
                  selectedNotification.type.slice(1)}
              </ThemedText>
              <ThemedText style={[styles.detailTitle, { color: theme.text }]}>
                {selectedNotification.title}
              </ThemedText>
              <ThemedText
                style={[
                  styles.detailTimestamp,
                  { color: theme.textTertiary as string },
                ]}
              >
                {formatTimestamp(selectedNotification.createdAt)}
              </ThemedText>
              <ThemedText
                style={[styles.detailMessage, { color: theme.textSecondary }]}
              >
                {selectedNotification.message}
              </ThemedText>
            </ScrollView>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    paddingTop: Spacing.lg,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.md,
  },
  toolbarText: { fontSize: 13, fontWeight: "600" },
  readAllButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
  },
  detailOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xl,
  },
  detailCard: {
    width: "100%",
    maxWidth: 520,
    maxHeight: "82%",
    borderRadius: 24,
    borderWidth: 1,
    padding: Spacing.xl,
  },
  detailCardContent: {
    flexGrow: 1,
    paddingBottom: Spacing.sm,
  },
  detailHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.lg,
  },
  detailIcon: {
    width: 48,
    height: 48,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  detailClose: {
    padding: Spacing.xs,
  },
  detailType: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: Spacing.sm,
  },
  detailTitle: {
    fontSize: 23,
    lineHeight: 29,
    fontWeight: "700",
    marginBottom: Spacing.xs,
  },
  detailTimestamp: {
    fontSize: 12,
    marginBottom: Spacing.lg,
  },
  detailMessage: {
    fontSize: 16,
    lineHeight: 25,
  },
});
