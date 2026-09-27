import React from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { getScreenContentTopPadding } from "@/hooks/useScreenOptions";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { EventState } from "@/components/EventState";
import { useAdminEvent } from "@/contexts/AdminEventContext";
import { useAuth } from "@/contexts/AuthContext";
import { useEventTheme } from "@/contexts/EventThemeContext";
import { useTheme } from "@/hooks/useTheme";
import { AppColors, BorderRadius, Spacing, Shadows } from "@/constants/theme";

interface CaseStudy {
  id: string;
  caseId: string;
  company: string;
  title: string;
  type: string;
  duration: string;
  description: string | null;
  room: string | null;
  sortOrder: number;
}

export default function CaseStudyScanScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { user } = useAuth();
  const { adminEventId } = useAdminEvent();
  const eventTheme = useEventTheme();
  const navigation = useNavigation<any>();
  const qs = adminEventId ? `?eventId=${adminEventId}` : "";

  const isAdmin = user?.role === "admin";
  const eventReady = isAdmin ? !!adminEventId : !!eventTheme.eventId;
  const {
    data: caseStudies = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<CaseStudy[]>({
    queryKey: ["/api/case-studies/all", adminEventId],
    enabled: eventReady,
    queryFn: async () => {
      const { apiRequest } = await import("@/lib/query-client");
      return (await apiRequest(`/api/case-studies/all${qs}`)).json();
    },
  });

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
          message="Choose an event year before opening case-study check-in."
          icon="layers"
        />
      </View>
    );
  }

  if (!isAdmin && !eventTheme.isLoading && !eventTheme.eventId) {
    return (
      <View
        style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      >
        <EventState
          title="No live event"
          message="Case-study check-in becomes available when an event is published."
          icon="calendar"
        />
      </View>
    );
  }

  const getTypeColor = (type: string) => {
    return type.toLowerCase().includes("long") ? "#7C3AED" : AppColors.accent;
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      contentContainerStyle={{
        paddingTop: getScreenContentTopPadding(headerHeight, Spacing.lg),
        paddingBottom: insets.bottom + Spacing.xl,
        paddingHorizontal: Spacing.lg,
      }}
    >
      <View style={styles.headerRow}>
        <ThemedText type="h3" style={styles.sectionTitle}>
          Case Studies
        </ThemedText>
        <View
          style={[
            styles.countBadge,
            { backgroundColor: `${AppColors.accent}15` },
          ]}
        >
          <ThemedText style={[styles.countText, { color: AppColors.accent }]}>
            {caseStudies.length}
          </ThemedText>
        </View>
      </View>

      <ThemedText style={[styles.subtitle, { color: theme.textSecondary }]}>
        Tap a case study to scan attendees or manage participants
      </ThemedText>

      {isError ? (
        <EventState
          title="Could not load case studies"
          message="Check your connection and try again."
          icon="wifi-off"
          actionLabel="Try again"
          onAction={() => void refetch()}
        />
      ) : isLoading ? (
        <ActivityIndicator
          size="large"
          color={AppColors.accent}
          style={{ paddingVertical: Spacing["3xl"] }}
        />
      ) : caseStudies.length === 0 ? (
        <View
          style={[
            styles.emptyCard,
            { backgroundColor: theme.cardBackground },
            Shadows.small,
          ]}
        >
          <View
            style={[
              styles.emptyIcon,
              { backgroundColor: `${AppColors.accent}10` },
            ]}
          >
            <Feather name="book-open" size={36} color={AppColors.accent} />
          </View>
          <ThemedText type="h4" style={styles.emptyTitle}>
            No Case Studies Yet
          </ThemedText>
          <ThemedText
            style={[styles.emptyText, { color: theme.textSecondary }]}
          >
            Case studies can be added through the database. They will appear
            here automatically.
          </ThemedText>
        </View>
      ) : (
        caseStudies.map((cs) => {
          const typeColor = getTypeColor(cs.type);
          return (
            <Pressable
              key={cs.id}
              onPress={() =>
                navigation.navigate("CaseStudyDetail", {
                  caseStudyId: cs.id,
                  eventId: adminEventId || eventTheme.eventId,
                })
              }
              style={({ pressed }) => [
                styles.caseCard,
                {
                  backgroundColor: theme.cardBackground,
                  opacity: pressed ? 0.85 : 1,
                },
                Shadows.small,
              ]}
              testID={`card-casestudy-${cs.caseId}`}
            >
              <View style={styles.caseCardTop}>
                <View
                  style={[
                    styles.typeBadge,
                    { backgroundColor: `${typeColor}15` },
                  ]}
                >
                  <ThemedText style={[styles.typeText, { color: typeColor }]}>
                    {cs.type}
                  </ThemedText>
                </View>
                <Feather
                  name="chevron-right"
                  size={20}
                  color={theme.textSecondary}
                />
              </View>
              <ThemedText style={styles.caseTitle}>{cs.title}</ThemedText>
              <View style={styles.caseMetaRow}>
                <View style={styles.metaItem}>
                  <Feather
                    name="briefcase"
                    size={13}
                    color={theme.textSecondary}
                  />
                  <ThemedText
                    style={[styles.metaText, { color: theme.textSecondary }]}
                  >
                    {cs.company}
                  </ThemedText>
                </View>
                <View style={styles.metaItem}>
                  <Feather name="clock" size={13} color={theme.textSecondary} />
                  <ThemedText
                    style={[styles.metaText, { color: theme.textSecondary }]}
                  >
                    {cs.duration}
                  </ThemedText>
                </View>
              </View>
              {cs.room ? (
                <View style={styles.metaItem}>
                  <Feather
                    name="map-pin"
                    size={13}
                    color={theme.textSecondary}
                  />
                  <ThemedText
                    style={[styles.metaText, { color: theme.textSecondary }]}
                  >
                    {cs.room}
                  </ThemedText>
                </View>
              ) : null}
            </Pressable>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingRoot: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.xs,
  },
  sectionTitle: {
    fontSize: 20,
  },
  countBadge: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
  },
  countText: {
    fontSize: 13,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 14,
    marginBottom: Spacing.xl,
  },
  emptyCard: {
    borderRadius: BorderRadius.xl,
    padding: Spacing["3xl"],
    alignItems: "center",
    gap: Spacing.md,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  emptyTitle: {
    fontSize: 18,
  },
  emptyText: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  caseCard: {
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
  },
  caseCardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.sm,
  },
  typeBadge: {
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 3,
    borderRadius: BorderRadius.full,
  },
  typeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  caseTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: Spacing.sm,
  },
  caseMetaRow: {
    flexDirection: "row",
    gap: Spacing.lg,
    marginBottom: 4,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  metaText: {
    fontSize: 13,
  },
});
