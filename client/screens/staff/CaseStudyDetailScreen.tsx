import React, { useState, useRef, useCallback } from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  Platform,
  Linking,
  ActivityIndicator,
  Alert,
  TextInput,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { getScreenContentTopPadding } from "@/hooks/useScreenOptions";
import {
  CameraView,
  useCameraPermissions,
  BarcodeScanningResult,
} from "expo-camera";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useFocusEffect,
  useIsFocused,
  useRoute,
} from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { EventState } from "@/components/EventState";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { useAdminEvent } from "@/contexts/AdminEventContext";
import { useAuth } from "@/contexts/AuthContext";
import { useEventTheme } from "@/contexts/EventThemeContext";
import { useTheme } from "@/hooks/useTheme";
import { AppColors, BorderRadius, Spacing, Shadows } from "@/constants/theme";
import * as Haptics from "expo-haptics";

interface CaseStudy {
  id: string;
  caseId: string;
  company: string;
  title: string;
  type: string;
  duration: string;
  room: string | null;
}

interface Attendee {
  id: string;
  name: string;
  email: string;
  assignedAt: string;
  checkedIn?: boolean;
}

interface SearchResult {
  id: string;
  name: string;
  email: string;
}

interface CheckInResult {
  success: boolean;
  alreadyAssigned?: boolean;
  alreadyCheckedIn?: boolean;
  notAssigned?: boolean;
  user?: { id: string; name: string; email: string };
  message?: string;
}

type ScanFeedback = {
  type: "success" | "warning" | "error";
  message: string;
  name?: string;
};

export default function CaseStudyDetailScreen() {
  const route = useRoute<any>();
  const { caseStudyId } = route.params;
  const { adminEventId } = useAdminEvent();
  const { user } = useAuth();
  const eventTheme = useEventTheme();
  const eventId = route.params?.eventId || adminEventId;
  const isAdmin = user?.role === "admin";
  const eventReady = isAdmin ? !!adminEventId : !!eventTheme.eventId;
  const qs = eventId ? `?eventId=${eventId}` : "";
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { width } = useWindowDimensions();
  const { theme } = useTheme();
  const queryClient = useQueryClient();
  const isFocused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [scannedLock, setScannedLock] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [cameraSessionKey, setCameraSessionKey] = useState(0);
  const scanSize = Math.min(260, Math.max(180, width - 64));
  const [scanFeedback, setScanFeedback] = useState<ScanFeedback | null>(null);
  const lastScannedRef = useRef("");
  const [showManualCheckIn, setShowManualCheckIn] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useFocusEffect(
    useCallback(() => {
      setCameraError("");
      setCameraSessionKey((key) => key + 1);

      return () => {
        setScanning(false);
        setScannedLock(false);
        setScanFeedback(null);
        lastScannedRef.current = "";
      };
    }, []),
  );

  const {
    data: caseStudies = [],
    isLoading: loadingCaseStudies,
    isError: caseStudiesError,
    refetch: refetchCaseStudies,
  } = useQuery<CaseStudy[]>({
    queryKey: ["/api/case-studies/all", eventId],
    enabled: eventReady,
    queryFn: async () =>
      (await apiRequest(`/api/case-studies/all${qs}`)).json(),
  });

  const caseStudy = caseStudies.find((cs) => cs.id === caseStudyId);

  const {
    data: attendees = [],
    isLoading: loadingAttendees,
    isError: attendeesError,
    refetch: refetchAttendees,
  } = useQuery<Attendee[]>({
    queryKey: [`/api/case-studies/${caseStudyId}/attendees`, eventId],
    enabled: eventReady && !!caseStudy,
    queryFn: async () =>
      (
        await apiRequest(`/api/case-studies/${caseStudyId}/attendees${qs}`)
      ).json(),
  });

  const scanMutation = useMutation({
    mutationFn: async (qrCodeValue: string): Promise<CheckInResult> => {
      const response = await apiRequest(
        `/api/case-studies/${caseStudyId}/check-in${qs}`,
        {
          method: "POST",
          body: JSON.stringify({ qrCodeValue }),
        },
      );
      return response.json();
    },
    onSuccess: (data) => {
      const finishScan = (feedback: ScanFeedback, refreshList = false) => {
        setScanFeedback(feedback);
        setScanning(false);
        setScannedLock(false);
        lastScannedRef.current = "";
        if (refreshList) {
          void refetchAttendees();
        }
      };

      if (data.success && data.user) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        finishScan(
          {
            type: "success",
            message: "Checked in successfully",
            name: data.user.name,
          },
          true,
        );
      } else if (data.alreadyCheckedIn || data.alreadyAssigned) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        finishScan({
          type: "warning",
          message: data.message || "Already checked in for this case study",
          name: data.user?.name,
        });
      } else if (data.notAssigned) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        finishScan({
          type: "warning",
          message:
            data.message ||
            `This attendee is not assigned to ${
              caseStudy?.title || "this case study"
            }`,
        });
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        finishScan({
          type: "error",
          message: data.message || "Could not check in attendee",
        });
      }
    },
    onError: (err: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setScanFeedback({ type: "error", message: err.message || "Scan failed" });
      setScanning(false);
      setScannedLock(false);
      lastScannedRef.current = "";
    },
  });

  const manualCheckInMutation = useMutation({
    mutationFn: async (userId: string): Promise<CheckInResult> => {
      const response = await apiRequest(
        `/api/case-studies/${caseStudyId}/manual-check-in${qs}`,
        {
          method: "POST",
          body: JSON.stringify({ userId }),
        },
      );
      return response.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert(
          "Check-in complete",
          data.message || `${data.user?.name || "Attendee"} checked in`,
        );
        queryClient.invalidateQueries({
          queryKey: [`/api/case-studies/${caseStudyId}/attendees`, eventId],
        });
        setSearchQuery("");
        setSearchResults([]);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert(
          data.alreadyCheckedIn ? "Already checked in" : "Cannot check in",
          data.message ||
            "This attendee cannot be checked in to this case study.",
        );
      }
    },
    onError: (error: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        "Check-in failed",
        error.message || "Could not check in attendee",
      );
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest(
        `/api/case-studies/${caseStudyId}/attendees/${userId}${qs}`,
        { method: "DELETE" },
      );
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({
        queryKey: [`/api/case-studies/${caseStudyId}/attendees`, eventId],
      });
    },
  });

  const handleBarCodeScanned = (result: BarcodeScanningResult) => {
    if (scannedLock || !result.data) return;
    if (result.data === lastScannedRef.current) return;
    lastScannedRef.current = result.data;
    setScannedLock(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    scanMutation.mutate(result.data);
  };

  const handleResetScan = () => {
    setScanFeedback(null);
    setScannedLock(false);
    lastScannedRef.current = "";
  };

  const handleSearch = (text: string) => {
    setSearchQuery(text);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (text.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    searchTimeout.current = setTimeout(async () => {
      try {
        const url = new URL(
          `/api/attendees/search?q=${encodeURIComponent(text)}${eventId ? `&eventId=${eventId}` : ""}`,
          getApiUrl(),
        );
        const response = await apiRequest(url.pathname + url.search);
        const data = await response.json();
        setSearchResults(data);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  };

  const typeColor = caseStudy?.type?.toLowerCase().includes("long")
    ? "#7C3AED"
    : AppColors.accent;

  if (
    (isAdmin && !adminEventId) ||
    (!isAdmin && !eventTheme.isLoading && !eventTheme.eventId)
  ) {
    return (
      <View
        style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      >
        <EventState
          title={isAdmin ? "Select an event" : "No live event"}
          message={
            isAdmin
              ? "Choose an event year before opening case-study check-in."
              : "Case-study check-in becomes available when an event is published."
          }
          icon={isAdmin ? "layers" : "calendar"}
        />
      </View>
    );
  }

  if (!isAdmin && eventTheme.isLoading) {
    return (
      <View
        style={[
          styles.container,
          styles.center,
          { backgroundColor: theme.backgroundRoot },
        ]}
      >
        <ActivityIndicator size="large" color={AppColors.accent} />
      </View>
    );
  }

  if (caseStudiesError || attendeesError) {
    return (
      <ScrollView
        style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
        contentContainerStyle={{
          paddingTop: getScreenContentTopPadding(headerHeight, Spacing.lg),
          paddingBottom: insets.bottom + Spacing.xl,
          paddingHorizontal: Spacing.lg,
        }}
      >
        <EventState
          title="Could not load case-study check-in"
          message="Check your connection and try again."
          icon="wifi-off"
          actionLabel="Try again"
          onAction={() => {
            void refetchCaseStudies();
            void refetchAttendees();
          }}
        />
      </ScrollView>
    );
  }

  if (!loadingCaseStudies && !caseStudy) {
    return (
      <View
        style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      >
        <EventState
          title="Case study unavailable"
          message="This case study is not part of the selected event."
          icon="book-open"
        />
      </View>
    );
  }

  if (scanning) {
    if (!permission) {
      return (
        <View
          style={[
            styles.container,
            styles.center,
            { backgroundColor: theme.backgroundRoot },
          ]}
        >
          <ActivityIndicator size="large" color={AppColors.accent} />
        </View>
      );
    }

    if (!permission.granted) {
      return (
        <View
          style={[
            styles.container,
            styles.center,
            {
              backgroundColor: theme.backgroundRoot,
              paddingTop: getScreenContentTopPadding(headerHeight, 60),
            },
          ]}
        >
          <View
            style={[styles.permCard, { backgroundColor: theme.cardBackground }]}
          >
            <Feather name="camera" size={40} color={AppColors.accent} />
            <ThemedText type="h3" style={styles.permTitle}>
              Camera Access Required
            </ThemedText>
            <ThemedText
              style={[styles.permText, { color: theme.textSecondary }]}
            >
              Allow camera access to scan attendee QR codes
            </ThemedText>
            {permission.status === "denied" && !permission.canAskAgain ? (
              Platform.OS !== "web" ? (
                <Button
                  onPress={async () => {
                    try {
                      await Linking.openSettings();
                    } catch {}
                  }}
                  style={styles.fullWidth}
                >
                  Open Settings
                </Button>
              ) : (
                <ThemedText
                  style={[styles.permText, { color: theme.textSecondary }]}
                >
                  Enable camera in browser settings
                </ThemedText>
              )
            ) : (
              <Button onPress={requestPermission} style={styles.fullWidth}>
                Enable Camera
              </Button>
            )}
            <Pressable
              onPress={() => setScanning(false)}
              style={{ marginTop: Spacing.lg }}
            >
              <ThemedText
                style={{ color: AppColors.accent, fontWeight: "600" }}
              >
                Go Back
              </ThemedText>
            </Pressable>
          </View>
        </View>
      );
    }

    return (
      <View style={styles.container}>
        {Platform.OS === "web" ? (
          <View
            style={[
              styles.container,
              styles.center,
              { backgroundColor: theme.backgroundSecondary },
            ]}
          >
            <Feather name="camera-off" size={48} color={theme.textSecondary} />
            <ThemedText
              style={[styles.webText, { color: theme.textSecondary }]}
            >
              Camera scanning is available on iOS and Android
            </ThemedText>
            <Pressable
              onPress={() => setScanning(false)}
              style={{ marginTop: Spacing.xl }}
            >
              <ThemedText
                style={{
                  color: AppColors.accent,
                  fontWeight: "600",
                  fontSize: 16,
                }}
              >
                Go Back
              </ThemedText>
            </Pressable>
          </View>
        ) : (
          <CameraView
            key={`case-study-camera-${cameraSessionKey}`}
            style={styles.camera}
            testID="case-study-camera"
            facing="back"
            active={isFocused && scanning && !scannedLock}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={handleBarCodeScanned}
            onMountError={() =>
              setCameraError(
                "Camera could not start. Please close the scanner and try again.",
              )
            }
            onCameraReady={() => setCameraError("")}
          >
            <Pressable
              onPress={() => {
                setScanning(false);
                handleResetScan();
              }}
              style={[
                styles.closeBtn,
                { top: Platform.OS === "android" ? 12 : insets.top + 12 },
              ]}
              accessibilityLabel="Close case study scanner"
              testID="button-close-case-study-scanner"
            >
              <Feather name="x" size={24} color="#FFF" />
            </Pressable>

            <View style={styles.overlay}>
              <View
                style={[styles.scanArea, { width: scanSize, height: scanSize }]}
              >
                <View style={[styles.corner, styles.tl]} />
                <View style={[styles.corner, styles.tr]} />
                <View style={[styles.corner, styles.bl]} />
                <View style={[styles.corner, styles.br]} />
              </View>
            </View>

            <View
              style={[
                styles.bottomBar,
                { paddingBottom: insets.bottom + Spacing.xl },
              ]}
            >
              <ThemedText style={styles.scanLabel} numberOfLines={1}>
                {caseStudy?.title || "Case Study"}
              </ThemedText>

              {cameraError ? (
                <View
                  style={[
                    styles.feedbackBox,
                    { backgroundColor: "rgba(239,68,68,0.2)" },
                  ]}
                  testID="case-study-camera-error"
                  accessibilityLiveRegion="polite"
                >
                  <Feather
                    name="alert-circle"
                    size={20}
                    color={AppColors.error}
                  />
                  <ThemedText style={styles.feedbackMsg}>
                    {cameraError}
                  </ThemedText>
                </View>
              ) : scanFeedback ? (
                <View
                  style={[
                    styles.feedbackBox,
                    {
                      backgroundColor:
                        scanFeedback.type === "success"
                          ? "rgba(34,197,94,0.2)"
                          : scanFeedback.type === "warning"
                            ? "rgba(247,143,30,0.2)"
                            : "rgba(239,68,68,0.2)",
                    },
                  ]}
                  testID={`case-study-scan-feedback-${scanFeedback.type}`}
                  accessibilityLiveRegion="polite"
                >
                  <Feather
                    name={
                      scanFeedback.type === "success"
                        ? "check-circle"
                        : scanFeedback.type === "warning"
                          ? "alert-triangle"
                          : "alert-circle"
                    }
                    size={20}
                    color={
                      scanFeedback.type === "success"
                        ? AppColors.success
                        : scanFeedback.type === "warning"
                          ? AppColors.accent
                          : AppColors.error
                    }
                  />
                  {scanFeedback.name ? (
                    <ThemedText style={styles.feedbackName}>
                      {scanFeedback.name}
                    </ThemedText>
                  ) : null}
                  <ThemedText style={styles.feedbackMsg}>
                    {scanFeedback.message}
                  </ThemedText>
                </View>
              ) : scanMutation.isPending ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <ThemedText style={styles.instructionText}>
                  Scan attendee&apos;s event QR to check them into this case
                  study
                </ThemedText>
              )}

              {cameraError ? (
                <Pressable
                  onPress={() => {
                    setCameraError("");
                    setCameraSessionKey((key) => key + 1);
                  }}
                  style={styles.scanAgainBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Try Camera Again"
                  testID="button-retry-case-study-camera"
                >
                  <ThemedText style={styles.scanAgainText}>
                    Try Camera Again
                  </ThemedText>
                </Pressable>
              ) : null}

              {scannedLock ? (
                <Pressable
                  onPress={handleResetScan}
                  style={styles.scanAgainBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Scan Next"
                  testID="button-scan-next"
                >
                  <ThemedText style={styles.scanAgainText}>
                    Scan Next
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
          </CameraView>
        )}
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      contentContainerStyle={{
        paddingTop: getScreenContentTopPadding(headerHeight, Spacing.lg),
        paddingBottom: insets.bottom + Spacing.xl,
        paddingHorizontal: Spacing.lg,
      }}
    >
      {caseStudy ? (
        <View
          style={[
            styles.headerCard,
            { backgroundColor: theme.cardBackground },
            Shadows.small,
          ]}
        >
          <View
            style={[styles.typeBadge, { backgroundColor: `${typeColor}15` }]}
          >
            <ThemedText style={[styles.typeText, { color: typeColor }]}>
              {caseStudy.type}
            </ThemedText>
          </View>
          <ThemedText type="h3" style={styles.csTitle}>
            {caseStudy.title}
          </ThemedText>
          <View style={styles.csMetaRow}>
            <Feather name="briefcase" size={14} color={theme.textSecondary} />
            <ThemedText style={[styles.csMeta, { color: theme.textSecondary }]}>
              {caseStudy.company}
            </ThemedText>
          </View>
          <View style={styles.csMetaRow}>
            <Feather name="clock" size={14} color={theme.textSecondary} />
            <ThemedText style={[styles.csMeta, { color: theme.textSecondary }]}>
              {caseStudy.duration}
            </ThemedText>
          </View>
          {caseStudy.room ? (
            <View style={styles.csMetaRow}>
              <Feather name="map-pin" size={14} color={theme.textSecondary} />
              <ThemedText
                style={[styles.csMeta, { color: theme.textSecondary }]}
              >
                {caseStudy.room}
              </ThemedText>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.actionsRow}>
        <Pressable
          onPress={() => {
            setCameraError("");
            setCameraSessionKey((key) => key + 1);
            setScanFeedback(null);
            setScanning(true);
          }}
          style={({ pressed }) => [
            styles.actionBtn,
            {
              backgroundColor: AppColors.accent,
              opacity: pressed ? 0.9 : 1,
              flex: 1,
            },
          ]}
          testID="button-scan-case-study"
        >
          <Feather name="camera" size={18} color="#FFF" />
          <ThemedText style={styles.actionBtnText}>Scan QR</ThemedText>
        </Pressable>
        <Pressable
          onPress={() => setShowManualCheckIn(!showManualCheckIn)}
          style={({ pressed }) => [
            styles.actionBtn,
            { backgroundColor: "#7C3AED", opacity: pressed ? 0.9 : 1, flex: 1 },
          ]}
          testID="button-manual-check-in"
        >
          <Feather name="user-check" size={18} color="#FFF" />
          <ThemedText style={styles.actionBtnText}>Manual Check-in</ThemedText>
        </Pressable>
      </View>

      {scanFeedback ? (
        <View
          style={[
            styles.resultCard,
            {
              backgroundColor:
                scanFeedback.type === "success"
                  ? "rgba(34,197,94,0.12)"
                  : scanFeedback.type === "warning"
                    ? "rgba(247,143,30,0.12)"
                    : "rgba(239,68,68,0.12)",
              borderColor:
                scanFeedback.type === "success"
                  ? `${AppColors.success}55`
                  : scanFeedback.type === "warning"
                    ? `${AppColors.accent}55`
                    : `${AppColors.error}55`,
            },
          ]}
          testID={`case-study-last-scan-feedback-${scanFeedback.type}`}
        >
          <Feather
            name={
              scanFeedback.type === "success"
                ? "check-circle"
                : scanFeedback.type === "warning"
                  ? "alert-triangle"
                  : "alert-circle"
            }
            size={22}
            color={
              scanFeedback.type === "success"
                ? AppColors.success
                : scanFeedback.type === "warning"
                  ? AppColors.accent
                  : AppColors.error
            }
          />
          <View style={styles.resultText}>
            {scanFeedback.name ? (
              <ThemedText style={styles.resultName}>
                {scanFeedback.name}
              </ThemedText>
            ) : null}
            <ThemedText style={styles.resultMessage}>
              {scanFeedback.message}
            </ThemedText>
          </View>
          <Pressable
            onPress={() => {
              setScanFeedback(null);
              setCameraError("");
              setCameraSessionKey((key) => key + 1);
              setScanning(true);
            }}
            style={styles.resultScanAgain}
            testID="button-scan-another-case-study"
          >
            <ThemedText style={styles.resultScanAgainText}>
              Scan another
            </ThemedText>
          </Pressable>
        </View>
      ) : null}

      {showManualCheckIn ? (
        <View
          style={[
            styles.manualCheckInCard,
            { backgroundColor: theme.cardBackground },
            Shadows.small,
          ]}
        >
          <ThemedText type="h4" style={{ marginBottom: Spacing.md }}>
            Manually check in an attendee
          </ThemedText>
          <ThemedText
            style={[styles.manualCheckInHint, { color: theme.textSecondary }]}
          >
            Only attendees already assigned to this case study can be checked in
            here.
          </ThemedText>
          <View
            style={[
              styles.searchInput,
              {
                backgroundColor: theme.backgroundSecondary,
                borderColor: theme.border,
              },
            ]}
          >
            <Feather name="search" size={16} color={theme.textSecondary} />
            <TextInput
              value={searchQuery}
              onChangeText={handleSearch}
              placeholder="Search by name or email..."
              placeholderTextColor={theme.textSecondary}
              style={[styles.searchTextInput, { color: theme.text }]}
              autoCapitalize="none"
              testID="input-search-attendee"
            />
            {searchQuery.length > 0 ? (
              <Pressable
                onPress={() => {
                  setSearchQuery("");
                  setSearchResults([]);
                }}
              >
                <Feather name="x" size={16} color={theme.textSecondary} />
              </Pressable>
            ) : null}
          </View>

          {searching ? (
            <ActivityIndicator
              size="small"
              color={AppColors.accent}
              style={{ marginTop: Spacing.md }}
            />
          ) : searchResults.length > 0 ? (
            <View style={{ marginTop: Spacing.md }}>
              {searchResults.map((result) => {
                const assignedAttendee = attendees.find(
                  (attendee) => attendee.id === result.id,
                );
                return (
                  <View
                    key={result.id}
                    style={[
                      styles.searchResultRow,
                      { borderBottomColor: theme.border },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <ThemedText style={styles.searchName}>
                        {result.name}
                      </ThemedText>
                      <ThemedText
                        style={[
                          styles.searchEmail,
                          { color: theme.textSecondary },
                        ]}
                      >
                        {result.email}
                      </ThemedText>
                    </View>
                    {assignedAttendee?.checkedIn ? (
                      <View
                        style={[
                          styles.assignedBadge,
                          { backgroundColor: `${AppColors.success}15` },
                        ]}
                      >
                        <ThemedText
                          style={[
                            styles.assignedText,
                            { color: AppColors.success },
                          ]}
                        >
                          Checked in
                        </ThemedText>
                      </View>
                    ) : assignedAttendee ? (
                      <Pressable
                        onPress={() => manualCheckInMutation.mutate(result.id)}
                        style={({ pressed }) => [
                          styles.addBtn,
                          {
                            backgroundColor: "#7C3AED",
                            opacity: pressed ? 0.8 : 1,
                          },
                        ]}
                        disabled={manualCheckInMutation.isPending}
                        testID={`button-manual-check-in-${result.id}`}
                      >
                        <Feather name="user-check" size={14} color="#FFF" />
                        <ThemedText style={styles.addBtnText}>
                          Check in
                        </ThemedText>
                      </Pressable>
                    ) : (
                      <View
                        style={[
                          styles.assignedBadge,
                          { backgroundColor: `${theme.textSecondary}15` },
                        ]}
                      >
                        <ThemedText
                          style={[
                            styles.assignedText,
                            { color: theme.textSecondary },
                          ]}
                        >
                          Not assigned
                        </ThemedText>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          ) : searchQuery.length >= 2 ? (
            <ThemedText
              style={[styles.noResults, { color: theme.textSecondary }]}
            >
              No attendees found
            </ThemedText>
          ) : null}
        </View>
      ) : null}

      <View style={styles.attendeesHeader}>
        <View style={styles.attendeesHeaderLeft}>
          <ThemedText type="h4">Attendees</ThemedText>
          <View
            style={[
              styles.countBadge,
              { backgroundColor: `${AppColors.success}15` },
            ]}
          >
            <ThemedText
              style={[styles.countText, { color: AppColors.success }]}
            >
              {attendees.filter((a) => a.checkedIn).length}/{attendees.length}
            </ThemedText>
          </View>
        </View>
      </View>

      {loadingAttendees ? (
        <ActivityIndicator
          size="small"
          color={AppColors.accent}
          style={{ marginTop: Spacing.lg }}
        />
      ) : attendees.length === 0 ? (
        <View
          style={[
            styles.emptyAttendees,
            { backgroundColor: theme.cardBackground },
            Shadows.small,
          ]}
        >
          <Feather name="users" size={28} color={theme.textSecondary} />
          <ThemedText
            style={[styles.emptyText, { color: theme.textSecondary }]}
          >
            No attendees checked in yet
          </ThemedText>
          <ThemedText
            style={[styles.emptySubtext, { color: theme.textSecondary }]}
          >
            Scan an attendee&apos;s QR code or manually add them
          </ThemedText>
        </View>
      ) : (
        attendees.map((att, index) => (
          <View
            key={att.id}
            style={[
              styles.attendeeRow,
              {
                backgroundColor: theme.cardBackground,
                borderBottomColor: theme.border,
              },
              index === 0
                ? {
                    borderTopLeftRadius: BorderRadius.lg,
                    borderTopRightRadius: BorderRadius.lg,
                  }
                : null,
              index === attendees.length - 1
                ? {
                    borderBottomLeftRadius: BorderRadius.lg,
                    borderBottomRightRadius: BorderRadius.lg,
                    borderBottomWidth: 0,
                  }
                : null,
            ]}
          >
            <View
              style={[
                styles.attendeeAvatar,
                {
                  backgroundColor: att.checkedIn
                    ? `${AppColors.success}12`
                    : `${AppColors.accent}12`,
                },
              ]}
            >
              {att.checkedIn ? (
                <Feather name="check" size={16} color={AppColors.success} />
              ) : (
                <ThemedText
                  style={[styles.attendeeInitial, { color: AppColors.accent }]}
                >
                  {att.name.charAt(0).toUpperCase()}
                </ThemedText>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.attendeeName}>{att.name}</ThemedText>
              <ThemedText
                style={[styles.attendeeEmail, { color: theme.textSecondary }]}
              >
                {att.email}
              </ThemedText>
            </View>
            {att.checkedIn ? (
              <>
                <View
                  style={[
                    styles.checkedInBadge,
                    { backgroundColor: `${AppColors.success}15` },
                  ]}
                >
                  <ThemedText
                    style={[styles.checkedInText, { color: AppColors.success }]}
                  >
                    Checked In
                  </ThemedText>
                </View>
                <Pressable
                  onPress={() => removeMutation.mutate(att.id)}
                  style={({ pressed }) => [
                    styles.removeBtn,
                    {
                      backgroundColor: `${AppColors.warning}15`,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Reset check-in for ${att.name}`}
                  testID={`button-reset-${att.id}`}
                >
                  <Feather
                    name="rotate-ccw"
                    size={13}
                    color={AppColors.warning}
                  />
                </Pressable>
              </>
            ) : (
              <Pressable
                onPress={() => manualCheckInMutation.mutate(att.id)}
                style={({ pressed }) => [
                  styles.checkInBtn,
                  { opacity: pressed ? 0.75 : 1 },
                ]}
                disabled={manualCheckInMutation.isPending}
                accessibilityRole="button"
                accessibilityLabel={`Check in ${att.name}`}
                testID={`button-check-in-${att.id}`}
              >
                <Feather name="check" size={18} color="#FFF" />
              </Pressable>
            )}
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: {
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing["2xl"],
  },
  permCard: {
    borderRadius: BorderRadius["2xl"],
    padding: Spacing["3xl"],
    alignItems: "center",
    width: "100%",
    maxWidth: 340,
  },
  permTitle: {
    textAlign: "center",
    marginTop: Spacing.lg,
    marginBottom: Spacing.md,
  },
  permText: { textAlign: "center", marginBottom: Spacing.xl },
  fullWidth: { width: "100%" },
  webText: {
    marginTop: Spacing.xl,
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
  },
  camera: { flex: 1 },
  closeBtn: {
    position: "absolute",
    left: 16,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  scanArea: { width: 260, height: 260, backgroundColor: "transparent" },
  corner: {
    position: "absolute",
    width: 36,
    height: 36,
    borderColor: AppColors.accent,
  },
  tl: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 12,
  },
  tr: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 12,
  },
  bl: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 12,
  },
  br: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 12,
  },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.75)",
    paddingTop: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    alignItems: "center",
  },
  scanLabel: {
    color: AppColors.accent,
    fontSize: 14,
    fontWeight: "700",
    marginBottom: Spacing.sm,
    letterSpacing: 0.5,
  },
  instructionText: { color: "#FFF", fontSize: 15, textAlign: "center" },
  feedbackBox: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    width: "100%",
  },
  feedbackName: {
    color: "#FFF",
    fontWeight: "700",
    fontSize: 16,
    marginTop: 4,
  },
  feedbackMsg: { color: "rgba(255,255,255,0.85)", fontSize: 13, marginTop: 2 },
  scanAgainBtn: {
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.full,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  scanAgainText: { color: "#FFF", fontWeight: "600" },
  headerCard: {
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  typeBadge: {
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 3,
    borderRadius: BorderRadius.full,
    alignSelf: "flex-start",
    marginBottom: Spacing.sm,
  },
  typeText: { fontSize: 11, fontWeight: "700" },
  csTitle: { fontSize: 20, marginBottom: Spacing.md },
  csMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  csMeta: { fontSize: 14 },
  actionsRow: {
    flexDirection: "row",
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  resultCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  resultText: {
    flex: 1,
  },
  resultName: {
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 2,
  },
  resultMessage: {
    fontSize: 13,
  },
  resultScanAgain: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    backgroundColor: AppColors.accent,
  },
  resultScanAgainText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "700",
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md + 2,
    borderRadius: BorderRadius.lg,
  },
  actionBtnText: { color: "#FFF", fontSize: 15, fontWeight: "700" },
  manualCheckInCard: {
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  manualCheckInHint: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: Spacing.md,
  },
  searchInput: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    height: 44,
  },
  searchTextInput: { flex: 1, fontSize: 15, height: "100%" },
  searchResultRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
  },
  searchName: { fontSize: 15, fontWeight: "600" },
  searchEmail: { fontSize: 13, marginTop: 2 },
  assignedBadge: {
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
  },
  assignedText: { fontSize: 12, fontWeight: "600" },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: BorderRadius.md,
  },
  addBtnText: { color: "#FFF", fontSize: 13, fontWeight: "600" },
  noResults: { textAlign: "center", marginTop: Spacing.lg, fontSize: 14 },
  attendeesHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.md,
  },
  attendeesHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  countBadge: {
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
  },
  countText: { fontSize: 13, fontWeight: "700" },
  emptyAttendees: {
    borderRadius: BorderRadius.xl,
    padding: Spacing["2xl"],
    alignItems: "center",
    gap: Spacing.sm,
  },
  emptyText: { fontSize: 15, fontWeight: "500" },
  emptySubtext: { fontSize: 13, textAlign: "center" },
  attendeeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    gap: Spacing.md,
  },
  attendeeAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  attendeeInitial: { fontSize: 16, fontWeight: "700" },
  attendeeName: { fontSize: 15, fontWeight: "600" },
  attendeeEmail: { fontSize: 12, marginTop: 1 },
  removeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: "center",
    alignItems: "center",
  },
  checkInBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: AppColors.success,
    justifyContent: "center",
    alignItems: "center",
  },
  checkedInBadge: {
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 3,
    borderRadius: BorderRadius.full,
    marginRight: Spacing.sm,
  },
  checkedInText: { fontSize: 11, fontWeight: "700" },
});
