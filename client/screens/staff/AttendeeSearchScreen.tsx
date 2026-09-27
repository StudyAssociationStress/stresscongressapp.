import React, { useState, useMemo } from "react";
import {
  StyleSheet,
  View,
  FlatList,
  TextInput,
  RefreshControl,
  Modal,
  Pressable,
  ActivityIndicator,
  Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { getScreenContentTopPadding } from "@/hooks/useScreenOptions";
import { useRoute } from "@react-navigation/native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { AttendeeCard } from "@/components/AttendeeCard";
import { EmptyState } from "@/components/EmptyState";
import { EventState } from "@/components/EventState";
import { CardSkeleton } from "@/components/SkeletonLoader";
import { apiRequest } from "@/lib/query-client";
import { useAdminEvent } from "@/contexts/AdminEventContext";
import { useAuth } from "@/contexts/AuthContext";
import { useEventTheme } from "@/contexts/EventThemeContext";
import { useTheme } from "@/hooks/useTheme";
import { AppColors, BorderRadius, Spacing, Shadows } from "@/constants/theme";
import * as Haptics from "expo-haptics";

interface Attendee {
  id: string;
  name: string;
  email: string;
  role: "attendee" | "staff";
  checkedIn: boolean;
  photoUrl?: string | null;
}

type FilterType = "all" | "pending" | "checked_in";

function getInitials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

export default function AttendeeSearchScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { user } = useAuth();
  const { adminEventId } = useAdminEvent();
  const eventTheme = useEventTheme();
  const queryClient = useQueryClient();
  const route = useRoute<any>();
  const initialFilter: FilterType = route.params?.filter || "all";
  const [activeFilter, setActiveFilter] = useState<FilterType>(initialFilter);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAttendee, setSelectedAttendee] = useState<Attendee | null>(
    null,
  );
  const qs = adminEventId ? `?eventId=${adminEventId}` : "";
  const isAdmin = user?.role === "admin";
  const eventReady = isAdmin ? !!adminEventId : !!eventTheme.eventId;

  const {
    data: attendees = [],
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = useQuery<Attendee[]>({
    queryKey: ["/api/attendees", adminEventId],
    enabled: eventReady,
    queryFn: async () => (await apiRequest(`/api/attendees${qs}`)).json(),
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({
      queryKey: ["/api/attendees", adminEventId],
    });
    queryClient.invalidateQueries({ queryKey: ["/api/stats", adminEventId] });
    queryClient.invalidateQueries({
      queryKey: ["/api/recent-checkins", adminEventId],
    });
  };

  const checkInMutation = useMutation({
    mutationFn: async (userId: string) => {
      const response = await apiRequest(`/api/manual-check-in${qs}`, {
        method: "POST",
        body: JSON.stringify({ userId }),
      });
      return response.json();
    },
    onSuccess: (data) => {
      if (!data.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setSelectedAttendee(null);
        void refetch();
        Alert.alert(
          "Check-in failed",
          data.message || "The attendee could not be checked in.",
        );
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      invalidateAll();
      setSelectedAttendee(null);
    },
    onError: (error: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setSelectedAttendee(null);
      void refetch();
      console.warn("[AttendeeSearch] Check-in failed:", error.message);
      Alert.alert(
        "Check-in failed",
        error.message || "The attendee could not be checked in.",
      );
    },
  });

  const checkOutMutation = useMutation({
    mutationFn: async (userId: string) => {
      const response = await apiRequest(`/api/check-out${qs}`, {
        method: "POST",
        body: JSON.stringify({ userId }),
      });
      return response.json();
    },
    onSuccess: (data) => {
      if (!data.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setSelectedAttendee(null);
        void refetch();
        Alert.alert(
          "Check-out failed",
          data.message || "The attendee could not be checked out.",
        );
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      invalidateAll();
      setSelectedAttendee(null);
    },
    onError: (error: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setSelectedAttendee(null);
      void refetch();
      console.warn("[AttendeeSearch] Check-out failed:", error.message);
      Alert.alert(
        "Check-out failed",
        error.message || "The attendee could not be checked out.",
      );
    },
  });

  const filteredAttendees = useMemo(() => {
    let list = attendees;
    if (activeFilter === "pending")
      list = list.filter((a) => !a.checkedIn && a.role !== "staff");
    else if (activeFilter === "checked_in")
      list = list.filter((a) => a.checkedIn);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q),
      );
    }
    return list;
  }, [attendees, searchQuery, activeFilter]);

  const checkedInCount = attendees.filter((a) => a.checkedIn).length;
  const pendingCount = attendees.filter(
    (a) => !a.checkedIn && a.role !== "staff",
  ).length;

  const filterOptions: {
    key: FilterType;
    label: string;
    count: number;
    color: string;
  }[] = [
    {
      key: "all",
      label: "All",
      count: attendees.length,
      color: AppColors.primary,
    },
    { key: "pending", label: "Pending", count: pendingCount, color: "#D97706" },
    {
      key: "checked_in",
      label: "Checked In",
      count: checkedInCount,
      color: AppColors.success,
    },
  ];

  const renderAttendee = ({ item }: { item: Attendee }) => (
    <AttendeeCard
      name={item.name}
      email={item.email}
      checkedIn={item.checkedIn}
      photoUrl={item.photoUrl}
      role={item.role}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setSelectedAttendee(item);
      }}
      onCheckIn={
        item.role !== "staff" && !item.checkedIn
          ? () => checkInMutation.mutate(item.id)
          : undefined
      }
      onCheckOut={
        item.role !== "staff" && item.checkedIn
          ? () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setSelectedAttendee(item);
            }
          : undefined
      }
    />
  );

  const renderEmpty = () => {
    if (searchQuery && filteredAttendees.length === 0) {
      return (
        <EmptyState
          image={require("../../../assets/images/empty-search.png")}
          title="No Results Found"
          message={`No attendees match "${searchQuery}"`}
        />
      );
    }
    if (activeFilter === "pending") {
      return (
        <EmptyState
          image={require("../../../assets/images/empty-search.png")}
          title="All Checked In"
          message="Everyone is checked in — great work!"
        />
      );
    }
    if (activeFilter === "checked_in") {
      return (
        <EmptyState
          image={require("../../../assets/images/empty-search.png")}
          title="No Check-ins Yet"
          message="No attendees have checked in"
        />
      );
    }
    return (
      <EmptyState
        image={require("../../../assets/images/empty-search.png")}
        title="No Attendees"
        message="No attendees registered yet"
      />
    );
  };

  if (!isAdmin && eventTheme.isLoading) {
    return (
      <View
        style={[styles.loadingRoot, { backgroundColor: theme.backgroundRoot }]}
      >
        <ActivityIndicator size="large" color={AppColors.accent} />
      </View>
    );
  }

  if (isAdmin && !adminEventId) {
    return (
      <View
        style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      >
        <EventState
          title="Select an event"
          message="Choose an event year before viewing or checking in attendees."
          icon="layers"
        />
      </View>
    );
  }

  if (!isAdmin && !eventTheme.eventId) {
    return (
      <View
        style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      >
        <EventState
          title="No live event"
          message="Attendees will appear here when an event is published."
          icon="calendar"
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <FlatList
        data={filteredAttendees}
        keyExtractor={(item) => item.id}
        renderItem={renderAttendee}
        ListHeaderComponent={
          <View>
            {/* Filter Pills */}
            <View style={styles.filterRow}>
              {filterOptions.map((opt) => {
                const isActive = activeFilter === opt.key;
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setActiveFilter(opt.key);
                    }}
                    style={({ pressed }) => [
                      styles.filterChip,
                      {
                        backgroundColor: isActive
                          ? opt.color
                          : theme.backgroundSecondary,
                        borderColor: isActive ? opt.color : theme.border,
                        opacity: pressed ? 0.85 : 1,
                      },
                    ]}
                    testID={`filter-${opt.key}`}
                  >
                    <ThemedText
                      style={[
                        styles.filterChipText,
                        { color: isActive ? "#fff" : theme.textSecondary },
                      ]}
                    >
                      {opt.label}
                    </ThemedText>
                    <View
                      style={[
                        styles.filterBadge,
                        {
                          backgroundColor: isActive
                            ? "rgba(255,255,255,0.25)"
                            : theme.border,
                        },
                      ]}
                    >
                      <ThemedText
                        style={[
                          styles.filterBadgeText,
                          { color: isActive ? "#fff" : theme.textSecondary },
                        ]}
                      >
                        {opt.count}
                      </ThemedText>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {/* Search Bar */}
            <View
              style={[
                styles.searchBar,
                {
                  backgroundColor: theme.backgroundSecondary,
                  borderColor: theme.border,
                },
              ]}
            >
              <Feather name="search" size={17} color={theme.textSecondary} />
              <TextInput
                style={[styles.searchInput, { color: theme.text }]}
                placeholder="Search by name or email..."
                placeholderTextColor={theme.textSecondary}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCapitalize="none"
                autoCorrect={false}
                testID="input-search-attendees"
              />
              {searchQuery.length > 0 ? (
                <Pressable onPress={() => setSearchQuery("")} hitSlop={8}>
                  <View
                    style={[styles.clearBtn, { backgroundColor: theme.border }]}
                  >
                    <Feather name="x" size={12} color={theme.textSecondary} />
                  </View>
                </Pressable>
              ) : null}
            </View>

            {/* Result count */}
            <ThemedText
              style={[
                styles.resultCount,
                { color: theme.textTertiary as string },
              ]}
            >
              {filteredAttendees.length}{" "}
              {filteredAttendees.length === 1 ? "attendee" : "attendees"}
            </ThemedText>
          </View>
        }
        ListEmptyComponent={
          isError ? (
            <EventState
              title="Could not load attendees"
              message="Check your connection and try again."
              icon="wifi-off"
              actionLabel="Try again"
              onAction={() => void refetch()}
            />
          ) : isLoading ? (
            <View>
              <CardSkeleton />
              <CardSkeleton />
              <CardSkeleton />
            </View>
          ) : (
            renderEmpty
          )
        }
        contentContainerStyle={{
          paddingTop: getScreenContentTopPadding(headerHeight, Spacing.lg),
          paddingBottom: insets.bottom + Spacing["3xl"],
          paddingHorizontal: Spacing.lg,
          flexGrow: 1,
        }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={AppColors.accent}
          />
        }
      />

      {/* Attendee Detail Modal */}
      <Modal
        visible={selectedAttendee !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedAttendee(null)}
      >
        <View style={styles.overlay}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close attendee details"
            onPress={() => setSelectedAttendee(null)}
            style={StyleSheet.absoluteFill}
          />
          <Pressable
            style={[
              styles.modalCard,
              { backgroundColor: theme.cardBackground },
            ]}
            onPress={() => {}}
          >
            {selectedAttendee ? (
              <>
                <Pressable
                  onPress={() => setSelectedAttendee(null)}
                  style={styles.modalCloseBtn}
                  testID="button-close-modal"
                >
                  <Feather name="x" size={18} color={theme.textSecondary} />
                </Pressable>

                {/* Avatar */}
                <View
                  style={[
                    styles.modalAvatarWrap,
                    {
                      backgroundColor: selectedAttendee.checkedIn
                        ? `${AppColors.success}18`
                        : `${AppColors.accent}14`,
                    },
                  ]}
                >
                  <ThemedText
                    style={[
                      styles.modalInitials,
                      {
                        color: selectedAttendee.checkedIn
                          ? AppColors.success
                          : AppColors.accent,
                      },
                    ]}
                  >
                    {getInitials(selectedAttendee.name)}
                  </ThemedText>
                </View>

                <ThemedText style={[styles.modalName, { color: theme.text }]}>
                  {selectedAttendee.name}
                </ThemedText>
                <ThemedText
                  style={[styles.modalEmail, { color: theme.textSecondary }]}
                >
                  {selectedAttendee.email}
                </ThemedText>

                {/* Info Row */}
                <View
                  style={[
                    styles.modalInfoRow,
                    {
                      backgroundColor: theme.backgroundSecondary,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  <View style={styles.modalInfoCell}>
                    <ThemedText
                      style={[
                        styles.modalInfoLabel,
                        { color: theme.textTertiary as string },
                      ]}
                    >
                      Role
                    </ThemedText>
                    <ThemedText
                      style={[styles.modalInfoValue, { color: theme.text }]}
                      numberOfLines={1}
                    >
                      {selectedAttendee.role.charAt(0).toUpperCase() +
                        selectedAttendee.role.slice(1)}
                    </ThemedText>
                  </View>
                  <View
                    style={[
                      styles.modalInfoDivider,
                      { backgroundColor: theme.border },
                    ]}
                  />
                  <View style={styles.modalInfoCell}>
                    <ThemedText
                      style={[
                        styles.modalInfoLabel,
                        { color: theme.textTertiary as string },
                      ]}
                    >
                      Status
                    </ThemedText>
                    <ThemedText
                      style={[
                        styles.modalInfoValue,
                        {
                          color: selectedAttendee.checkedIn
                            ? AppColors.success
                            : "#D97706",
                        },
                      ]}
                    >
                      {selectedAttendee.checkedIn ? "Checked In" : "Pending"}
                    </ThemedText>
                  </View>
                </View>

                {selectedAttendee.role !== "staff" ? (
                  selectedAttendee.checkedIn ? (
                    <Pressable
                      onPress={() =>
                        checkOutMutation.mutate(selectedAttendee.id)
                      }
                      style={({ pressed }) => [
                        styles.actionBtn,
                        {
                          backgroundColor: `${AppColors.accent}14`,
                          borderColor: `${AppColors.accent}25`,
                          opacity: pressed ? 0.85 : 1,
                        },
                      ]}
                      testID="button-checkout-confirm"
                    >
                      <Feather
                        name="rotate-ccw"
                        size={18}
                        color={AppColors.accent}
                      />
                      <ThemedText
                        style={[
                          styles.actionBtnText,
                          { color: AppColors.accent },
                        ]}
                      >
                        Undo Check-in
                      </ThemedText>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() =>
                        checkInMutation.mutate(selectedAttendee.id)
                      }
                      style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1 }]}
                      testID="button-checkin-confirm"
                    >
                      <LinearGradient
                        colors={[AppColors.success, "#059669"]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={styles.actionBtnGrad}
                      >
                        <Feather name="check-circle" size={18} color="#fff" />
                        <ThemedText style={styles.actionBtnGradText}>
                          Check In
                        </ThemedText>
                      </LinearGradient>
                    </Pressable>
                  )
                ) : null}
              </>
            ) : null}
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingRoot: { flex: 1, alignItems: "center", justifyContent: "center" },

  filterRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  filterChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    gap: 5,
  },
  filterChipText: { fontSize: 12, fontWeight: "700" },
  filterBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
  },
  filterBadgeText: { fontSize: 11, fontWeight: "700" },

  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    height: 48,
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  searchInput: { flex: 1, fontSize: 15 },
  clearBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },

  resultCount: { fontSize: 12, fontWeight: "600", marginBottom: Spacing.md },

  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
  },
  modalCard: {
    width: "100%",
    maxWidth: 360,
    borderRadius: BorderRadius["2xl"],
    padding: Spacing["2xl"],
    ...Shadows.large,
    alignItems: "center",
  },
  modalCloseBtn: {
    alignSelf: "flex-end",
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.md,
  },
  modalAvatarWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.lg,
  },
  modalInitials: { fontSize: 28, fontWeight: "800" },
  modalName: {
    fontSize: 20,
    fontWeight: "800",
    marginBottom: 4,
    textAlign: "center",
  },
  modalEmail: { fontSize: 13, marginBottom: Spacing.xl, textAlign: "center" },
  modalInfoRow: {
    flexDirection: "row",
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    padding: Spacing.md,
    marginBottom: Spacing.xl,
    width: "100%",
  },
  modalInfoCell: { flex: 1, alignItems: "center", paddingVertical: Spacing.sm },
  modalInfoLabel: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  modalInfoValue: { fontSize: 15, fontWeight: "700" },
  modalInfoDivider: { width: 1 },

  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing["2xl"],
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    gap: Spacing.sm,
    width: "100%",
  },
  actionBtnText: { fontSize: 15, fontWeight: "700" },
  actionBtnGrad: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing["2xl"],
    borderRadius: BorderRadius.xl,
    gap: Spacing.sm,
    width: "100%",
  },
  actionBtnGradText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
