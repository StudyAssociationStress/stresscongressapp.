import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  StyleSheet,
  View,
  FlatList,
  RefreshControl,
  Pressable,
  Modal,
  ScrollView,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import QRCode from "react-native-qrcode-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useFocusEffect } from "@react-navigation/native";
import { getScreenContentTopPadding } from "@/hooks/useScreenOptions";
import { useQuery } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { EmptyState } from "@/components/EmptyState";
import { CardSkeleton } from "@/components/SkeletonLoader";
import { CheckInSuccess } from "@/components/CheckInSuccess";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/hooks/useTheme";
import { AppColors, BorderRadius, Spacing, Shadows } from "@/constants/theme";

interface CaseStudy {
  id: string;
  caseId: string;
  company: string;
  title: string;
  type: string;
  duration: string;
  description?: string | null;
  room?: string | null;
  sortOrder: number;
  userCheckedIn?: boolean;
}

export default function AgendaScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { user } = useAuth();
  const [selectedCase, setSelectedCase] = useState<CaseStudy | null>(null);
  const [celebrationCase, setCelebrationCase] = useState<CaseStudy | null>(
    null,
  );
  const prevCheckedInRef = useRef<Set<string>>(new Set());
  const hasReceivedInitialCaseStudiesRef = useRef(false);

  const {
    data: caseStudies = [],
    isLoading,
    refetch,
    isRefetching,
  } = useQuery<CaseStudy[]>({
    queryKey: ["/api/case-studies"],
    refetchInterval: 2000,
  });

  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  useEffect(() => {
    if (caseStudies.length === 0) return;
    const current = new Set(
      caseStudies.filter((cs) => cs.userCheckedIn).map((cs) => cs.id),
    );
    if (hasReceivedInitialCaseStudiesRef.current) {
      for (const cs of caseStudies) {
        if (cs.userCheckedIn && !prevCheckedInRef.current.has(cs.id)) {
          setCelebrationCase(cs);
          setSelectedCase(null);
          break;
        }
      }
    }
    prevCheckedInRef.current = current;
    hasReceivedInitialCaseStudiesRef.current = true;
  }, [caseStudies]);

  const getTypeColor = (type: string) =>
    type.toLowerCase().includes("long") ? "#7C3AED" : AppColors.accent;

  const renderCaseStudy = ({
    item,
    index,
  }: {
    item: CaseStudy;
    index: number;
  }) => {
    const color = getTypeColor(item.type);
    return (
      <Pressable
        onPress={() => setSelectedCase(item)}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: theme.cardBackground,
            borderColor: theme.cardBorder,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
        testID={`card-case-study-${index}`}
      >
        {item.userCheckedIn ? (
          <View
            style={[styles.checkedBar, { backgroundColor: AppColors.success }]}
          />
        ) : null}
        <View style={styles.cardBody}>
          <View style={[styles.typePill, { backgroundColor: `${color}12` }]}>
            <ThemedText style={[styles.typeText, { color }]}>
              {item.type}
            </ThemedText>
          </View>
          <ThemedText
            style={[styles.cardTitle, { color: theme.text }]}
            numberOfLines={2}
          >
            {item.title}
          </ThemedText>
          <View style={styles.metaRow}>
            <Feather name="briefcase" size={12} color={theme.textSecondary} />
            <ThemedText
              style={[
                styles.metaText,
                styles.metaCompany,
                { color: theme.textSecondary },
              ]}
              numberOfLines={2}
            >
              {item.company}
            </ThemedText>
            <View style={[styles.metaDot, { backgroundColor: theme.border }]} />
            <Feather name="clock" size={12} color={theme.textSecondary} />
            <ThemedText
              style={[
                styles.metaText,
                styles.metaDuration,
                { color: theme.textSecondary },
              ]}
              numberOfLines={1}
            >
              {item.duration}
            </ThemedText>
          </View>
        </View>
        <View style={[styles.chevronWrap, { backgroundColor: `${color}10` }]}>
          {item.userCheckedIn ? (
            <Feather name="check" size={18} color={AppColors.success} />
          ) : (
            <Feather name="chevron-right" size={18} color={color} />
          )}
        </View>
      </Pressable>
    );
  };

  const renderHeader = () => (
    <View
      style={[styles.countPill, { backgroundColor: `${AppColors.accent}12` }]}
    >
      <Feather name="book-open" size={15} color={AppColors.accent} />
      <ThemedText style={[styles.countText, { color: AppColors.accent }]}>
        {caseStudies.length} case{" "}
        {caseStudies.length === 1 ? "study" : "studies"} assigned to you
      </ThemedText>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <FlatList
        data={caseStudies}
        keyExtractor={(item) => item.id}
        renderItem={renderCaseStudy}
        ListHeaderComponent={caseStudies.length > 0 ? renderHeader : null}
        ListEmptyComponent={
          isLoading ? (
            <View>
              <CardSkeleton />
              <CardSkeleton />
            </View>
          ) : (
            <EmptyState
              image={require("../../../assets/images/empty-agenda.png")}
              title="No Case Studies Assigned"
              message="Your case studies will appear here once they are assigned."
            />
          )
        }
        contentContainerStyle={{
          paddingTop: getScreenContentTopPadding(headerHeight, Spacing.xl),
          paddingBottom: insets.bottom + Spacing["3xl"],
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
        visible={!!selectedCase}
        animationType="slide"
        presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}
        onRequestClose={() => setSelectedCase(null)}
      >
        {selectedCase ? (
          <CaseDetailSheet
            item={selectedCase}
            insets={insets}
            theme={theme}
            attendeeName={user?.name || "Attendee"}
            attendeeEmail={user?.email || ""}
            qrCodeValue={user?.qrCodeValue || "NO_QR_CODE"}
            onClose={() => setSelectedCase(null)}
          />
        ) : null}
      </Modal>

      <Modal
        visible={!!celebrationCase}
        animationType="fade"
        transparent
        statusBarTranslucent
        onRequestClose={() => {
          setCelebrationCase(null);
          refetch();
        }}
      >
        {celebrationCase ? (
          <CheckInSuccess
            attendeeName={celebrationCase.title}
            variant="caseStudy"
            caseStudyCompany={celebrationCase.title}
            onDismiss={() => {
              setCelebrationCase(null);
              refetch();
            }}
          />
        ) : null}
      </Modal>
    </View>
  );
}

function CaseDetailSheet({
  item,
  insets,
  theme,
  attendeeName,
  attendeeEmail,
  qrCodeValue,
  onClose,
}: {
  item: CaseStudy;
  insets: any;
  theme: any;
  attendeeName: string;
  attendeeEmail: string;
  qrCodeValue: string;
  onClose: () => void;
}) {
  const [showQr, setShowQr] = useState(false);
  const color = item.type.toLowerCase().includes("long")
    ? "#7C3AED"
    : AppColors.accent;

  return (
    <View style={[modal.container, { backgroundColor: theme.backgroundRoot }]}>
      <View
        style={[
          modal.header,
          {
            borderBottomColor: theme.border,
            paddingTop:
              Platform.OS === "android" ? insets.top + Spacing.md : Spacing.md,
          },
        ]}
      >
        <ThemedText
          style={[modal.headerTitle, { color: theme.text }]}
          numberOfLines={1}
        >
          Case Study Details
        </ThemedText>
        <Pressable
          onPress={onClose}
          style={[
            modal.closeBtn,
            { backgroundColor: theme.backgroundSecondary },
          ]}
          testID="button-close-detail"
        >
          <Feather name="x" size={18} color={theme.text} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[
          modal.content,
          { paddingBottom: insets.bottom + 104 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[modal.typePill, { backgroundColor: `${color}12` }]}>
          <ThemedText style={[modal.typeText, { color }]}>
            {item.type}
          </ThemedText>
        </View>
        <ThemedText style={[modal.title, { color: theme.text }]}>
          {item.title}
        </ThemedText>

        <View
          style={[
            modal.metaCard,
            {
              backgroundColor: theme.cardBackground,
              borderColor: theme.cardBorder,
            },
          ]}
        >
          {[
            {
              icon: "briefcase" as const,
              label: item.company,
              color: AppColors.accent,
            },
            {
              icon: "clock" as const,
              label: item.duration,
              color: AppColors.accent,
            },
            {
              icon: "map-pin" as const,
              label: item.room || "Room: To be assigned",
              color: AppColors.success,
            },
            {
              icon: "hash" as const,
              label: item.caseId,
              color: theme.textSecondary,
            },
          ].map((row, i, arr) => (
            <React.Fragment key={row.label}>
              <View style={modal.metaRow}>
                <View
                  style={[
                    modal.metaIcon,
                    { backgroundColor: `${row.color}12` },
                  ]}
                >
                  <Feather name={row.icon} size={13} color={row.color} />
                </View>
                <ThemedText
                  style={[modal.metaLabel, { color: theme.textSecondary }]}
                >
                  {row.label}
                </ThemedText>
              </View>
              {i < arr.length - 1 ? (
                <View
                  style={[modal.divider, { backgroundColor: theme.border }]}
                />
              ) : null}
            </React.Fragment>
          ))}
        </View>

        {item.description ? (
          <View
            style={[
              modal.descCard,
              {
                backgroundColor: theme.cardBackground,
                borderColor: theme.cardBorder,
              },
            ]}
          >
            <ThemedText style={[modal.descLabel, { color: theme.text }]}>
              Description
            </ThemedText>
            <ThemedText
              style={[modal.descText, { color: theme.textSecondary }]}
            >
              {item.description}
            </ThemedText>
          </View>
        ) : null}

        {item.userCheckedIn ? (
          <LinearGradient
            colors={[`${AppColors.success}18`, `${AppColors.success}06`]}
            style={modal.qrSection}
          >
            <View style={modal.checkedIcon}>
              <Feather name="check" size={30} color="#FFFFFF" />
            </View>
            <ThemedText style={[modal.qrTitle, { color: AppColors.success }]}>
              Checked In
            </ThemedText>
            <ThemedText style={[modal.qrSub, { color: theme.textSecondary }]}>
              You&apos;ve been checked in for this case study
            </ThemedText>
          </LinearGradient>
        ) : (
          <View
            style={[
              modal.qrSection,
              {
                backgroundColor: theme.cardBackground,
                borderColor: theme.cardBorder,
                borderWidth: 1,
              },
            ]}
          >
            <Feather name="grid" size={32} color={AppColors.accent} />
            <ThemedText style={[modal.qrTitle, { color: theme.text }]}>
              Use your event QR code
            </ThemedText>
            <ThemedText style={[modal.qrSub, { color: theme.textSecondary }]}>
              Show the same QR from your Event Access Pass to staff for
              case-study check-in.
            </ThemedText>
          </View>
        )}
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Show my QR code"
        testID="button-case-study-quick-qr"
        onPress={() => setShowQr(true)}
        style={[
          modal.quickQrButton,
          {
            bottom: insets.bottom + Spacing.lg,
            backgroundColor: theme.cardBackground,
            borderColor: theme.border,
          },
        ]}
      >
        <Feather name="grid" size={22} color={AppColors.primary} />
      </Pressable>

      {showQr ? (
        <View style={modal.quickQrOverlay}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close QR code"
            onPress={() => setShowQr(false)}
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[
              modal.quickQrCard,
              {
                backgroundColor: theme.cardBackground,
                borderColor: theme.border,
              },
            ]}
            testID="case-study-quick-qr-modal"
          >
            <View style={modal.quickQrHeader}>
              <View>
                <ThemedText style={[modal.quickQrTitle, { color: theme.text }]}>
                  My QR Code
                </ThemedText>
                <ThemedText
                  style={[
                    modal.quickQrSubtitle,
                    { color: theme.textSecondary },
                  ]}
                >
                  Show this to staff for check-in
                </ThemedText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close QR code"
                hitSlop={10}
                onPress={() => setShowQr(false)}
                style={modal.quickQrClose}
              >
                <Feather name="x" size={22} color={theme.textSecondary} />
              </Pressable>
            </View>
            <View style={modal.quickQrFrame}>
              <QRCode
                value={qrCodeValue}
                size={220}
                color="#111827"
                backgroundColor="#FFFFFF"
              />
            </View>
            <ThemedText style={[modal.quickQrName, { color: theme.text }]}>
              {attendeeName}
            </ThemedText>
            <ThemedText
              style={[modal.quickQrEmail, { color: theme.textSecondary }]}
            >
              {attendeeEmail}
            </ThemedText>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  countPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
    borderRadius: BorderRadius.full,
    alignSelf: "flex-start",
    marginBottom: Spacing.xl,
  },
  countText: { fontSize: 13, fontWeight: "600" },
  card: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: BorderRadius.xl,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    overflow: "hidden",
    ...Shadows.card,
  },
  checkedBar: { width: 4, alignSelf: "stretch" },
  cardBody: { flex: 1, padding: Spacing.lg },
  typePill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: BorderRadius.full,
    alignSelf: "flex-start",
    marginBottom: Spacing.sm,
  },
  typeText: { fontSize: 11, fontWeight: "700" },
  cardTitle: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: Spacing.sm,
    letterSpacing: -0.1,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexWrap: "wrap",
  },
  metaText: { fontSize: 12, minWidth: 0, flexShrink: 1 },
  metaCompany: { flex: 1 },
  metaDuration: { maxWidth: 90 },
  metaDot: { width: 3, height: 3, borderRadius: 2, marginHorizontal: 2 },
  chevronWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.lg,
    marginLeft: 4,
    flexShrink: 0,
  },
});

const modal = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
  },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: "600" },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.xl },
  typePill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
    alignSelf: "flex-start",
    marginBottom: Spacing.md,
  },
  typeText: { fontSize: 12, fontWeight: "700" },
  title: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.3,
    marginBottom: Spacing.xl,
  },
  metaCard: {
    borderRadius: BorderRadius.xl,
    padding: Spacing.md,
    marginBottom: Spacing.xl,
    borderWidth: 1,
    ...Shadows.card,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm + 2,
  },
  metaIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.md,
  },
  metaLabel: { fontSize: 14, flex: 1 },
  divider: { height: 1, marginLeft: 44 },
  descCard: {
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    marginBottom: Spacing.xl,
    borderWidth: 1,
    ...Shadows.card,
  },
  descLabel: { fontSize: 14, fontWeight: "700", marginBottom: Spacing.sm },
  descText: { fontSize: 14, lineHeight: 22 },
  qrSection: {
    borderRadius: BorderRadius.xl,
    padding: Spacing["2xl"],
    alignItems: "center",
    marginBottom: Spacing.xl,
  },
  qrTitle: {
    fontSize: 17,
    fontWeight: "700",
    marginTop: Spacing.md,
    marginBottom: 4,
  },
  qrSub: { fontSize: 13, marginBottom: Spacing.xl, textAlign: "center" },
  qrFrame: {
    padding: Spacing.lg,
    backgroundColor: "#FFFFFF",
    borderRadius: BorderRadius.lg,
  },
  checkedIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: AppColors.success,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.md,
  },
  quickQrButton: {
    position: "absolute",
    right: Spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    zIndex: 20,
    ...Shadows.medium,
    elevation: 8,
  },
  quickQrOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 30,
    elevation: 12,
    backgroundColor: "rgba(0,0,0,0.52)",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xl,
  },
  quickQrCard: {
    width: "100%",
    maxWidth: 360,
    borderRadius: BorderRadius["2xl"],
    borderWidth: 1,
    padding: Spacing.xl,
    alignItems: "center",
    ...Shadows.large,
  },
  quickQrHeader: {
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: Spacing.lg,
  },
  quickQrTitle: { fontSize: 20, fontWeight: "800" },
  quickQrSubtitle: { fontSize: 13, marginTop: 3 },
  quickQrClose: { padding: 2 },
  quickQrFrame: {
    backgroundColor: "#FFFFFF",
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
  },
  quickQrName: {
    fontSize: 18,
    fontWeight: "700",
    marginTop: Spacing.lg,
  },
  quickQrEmail: { fontSize: 13, marginTop: 3 },
});
