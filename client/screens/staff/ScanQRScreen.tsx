import React, { useState, useRef, useCallback } from "react";
import {
  StyleSheet,
  View,
  Platform,
  Pressable,
  Linking,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import {
  CameraView,
  useCameraPermissions,
  BarcodeScanningResult,
} from "expo-camera";
import { Feather } from "@expo/vector-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { EventState } from "@/components/EventState";
import { apiRequest } from "@/lib/query-client";
import { useAdminEvent } from "@/contexts/AdminEventContext";
import { useAuth } from "@/contexts/AuthContext";
import { useEventTheme } from "@/contexts/EventThemeContext";
import { useTheme } from "@/hooks/useTheme";
import { AppColors, BorderRadius, Spacing } from "@/constants/theme";
import * as Haptics from "expo-haptics";

interface CheckInResponse {
  success: boolean;
  message?: string;
  user?: {
    name: string;
    email: string;
  };
  alreadyCheckedIn?: boolean;
}

export default function ScanQRScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { theme } = useTheme();
  const { user } = useAuth();
  const { adminEventId } = useAdminEvent();
  const eventTheme = useEventTheme();
  const queryClient = useQueryClient();
  const isFocused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [checkedInName, setCheckedInName] = useState("");
  const [error, setError] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [cameraSessionKey, setCameraSessionKey] = useState(0);
  const lastScannedRef = useRef<string>("");
  const scanSize = Math.min(280, Math.max(180, width - 48));
  const isAdmin = user?.role === "admin";
  const eventReady = isAdmin ? !!adminEventId : !!eventTheme.eventId;

  useFocusEffect(
    useCallback(() => {
      setScanned(false);
      setShowSuccess(false);
      setError("");
      setCameraError("");
      setCameraSessionKey((key) => key + 1);
      lastScannedRef.current = "";
    }, []),
  );

  const checkInMutation = useMutation({
    mutationFn: async (qrCodeValue: string): Promise<CheckInResponse> => {
      const qs = adminEventId ? `?eventId=${adminEventId}` : "";
      const response = await apiRequest(`/api/check-in${qs}`, {
        method: "POST",
        body: JSON.stringify({ qrCodeValue }),
      });
      return response.json();
    },
    onSuccess: (data) => {
      if (data.success && data.user) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setCheckedInName(data.user.name);
        setShowSuccess(true);
        queryClient.invalidateQueries({
          queryKey: ["/api/stats", adminEventId],
        });
        queryClient.invalidateQueries({
          queryKey: ["/api/recent-checkins", adminEventId],
        });
        queryClient.invalidateQueries({
          queryKey: ["/api/attendees", adminEventId],
        });
        setTimeout(handleSuccessDismiss, 1400);
      } else if (data.alreadyCheckedIn) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setError(`${data.user?.name || "Attendee"} is already checked in`);
        setTimeout(() => {
          setError("");
          setScanned(false);
          lastScannedRef.current = "";
        }, 2500);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setError(data.message || "Check-in failed");
        setTimeout(() => {
          setError("");
          setScanned(false);
          lastScannedRef.current = "";
        }, 2500);
      }
    },
    onError: (err: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(err.message || "Check-in failed");
      setTimeout(() => {
        setError("");
        setScanned(false);
        lastScannedRef.current = "";
      }, 2500);
    },
  });

  const handleBarCodeScanned = (result: BarcodeScanningResult) => {
    if (scanned || !result.data) return;
    if (result.data === lastScannedRef.current) return;

    lastScannedRef.current = result.data;
    setScanned(true);
    setError("");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    checkInMutation.mutate(result.data);
  };

  const handleSuccessDismiss = () => {
    setShowSuccess(false);
    setScanned(false);
    lastScannedRef.current = "";
  };

  const handleScanAgain = () => {
    setScanned(false);
    setError("");
    lastScannedRef.current = "";
  };

  if (!isAdmin && eventTheme.isLoading) {
    return (
      <View
        style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
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
          message="Choose an event year before scanning attendee QR codes."
          icon="layers"
        />
      </View>
    );
  }

  if (!eventReady) {
    return null;
  }

  if (!permission) {
    return (
      <View
        style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      >
        <ActivityIndicator size="large" color={AppColors.accent} />
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
          message="QR check-in becomes available when an event is published."
          icon="calendar"
        />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View
        style={[
          styles.container,
          styles.permissionContainer,
          {
            backgroundColor: theme.backgroundRoot,
            paddingTop: 60,
          },
        ]}
      >
        <View
          style={[
            styles.permissionCard,
            { backgroundColor: theme.cardBackground },
          ]}
        >
          <View
            style={[
              styles.iconContainer,
              { backgroundColor: `${AppColors.accent}15` },
            ]}
          >
            <Feather name="camera" size={40} color={AppColors.accent} />
          </View>
          <ThemedText type="h3" style={styles.permissionTitle}>
            Camera Access Required
          </ThemedText>
          <ThemedText
            style={[styles.permissionText, { color: theme.textSecondary }]}
          >
            To scan attendee QR codes, please allow camera access
          </ThemedText>
          {permission.status === "denied" && !permission.canAskAgain ? (
            Platform.OS !== "web" ? (
              <Button
                onPress={async () => {
                  try {
                    await Linking.openSettings();
                  } catch {}
                }}
                style={styles.permissionButton}
              >
                Open Settings
              </Button>
            ) : (
              <ThemedText
                style={[styles.permissionText, { color: theme.textSecondary }]}
              >
                Please enable camera in your browser settings
              </ThemedText>
            )
          ) : (
            <Button onPress={requestPermission} style={styles.permissionButton}>
              Enable Camera
            </Button>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {Platform.OS === "web" ? (
        <View
          style={[
            styles.webPlaceholder,
            { backgroundColor: theme.backgroundSecondary },
          ]}
        >
          <Feather name="camera-off" size={48} color={theme.textSecondary} />
          <ThemedText style={[styles.webText, { color: theme.textSecondary }]}>
            Camera scanning is available on iOS and Android
          </ThemedText>
          <ThemedText
            style={[styles.webSubtext, { color: theme.textSecondary }]}
          >
            Open this scanner in Expo Go on a mobile device to scan attendee QR
            codes
          </ThemedText>
        </View>
      ) : (
        <CameraView
          key={`staff-camera-${cameraSessionKey}`}
          style={styles.camera}
          testID="staff-camera"
          facing="back"
          active={isFocused && !scanned}
          barcodeScannerSettings={{
            barcodeTypes: ["qr"],
          }}
          onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
          onMountError={() =>
            setCameraError(
              "Camera could not start. Please close the scanner and try again.",
            )
          }
          onCameraReady={() => setCameraError("")}
        >
          <View style={styles.overlay}>
            <View
              style={[styles.scanArea, { width: scanSize, height: scanSize }]}
            >
              <View style={[styles.corner, styles.topLeft]} />
              <View style={[styles.corner, styles.topRight]} />
              <View style={[styles.corner, styles.bottomLeft]} />
              <View style={[styles.corner, styles.bottomRight]} />
            </View>
          </View>

          <View
            style={[
              styles.bottomBar,
              { paddingBottom: insets.bottom + Spacing.xl },
            ]}
          >
            {showSuccess ? (
              <View style={styles.successContainer}>
                <Feather
                  name="check-circle"
                  size={20}
                  color={AppColors.success}
                />
                <ThemedText style={styles.successText}>
                  {checkedInName} checked in
                </ThemedText>
              </View>
            ) : cameraError || error ? (
              <View style={styles.errorContainer}>
                <Feather
                  name="alert-circle"
                  size={20}
                  color={AppColors.error}
                />
                <ThemedText style={styles.errorText}>
                  {cameraError || error}
                </ThemedText>
              </View>
            ) : scanned ? (
              <ThemedText style={styles.instructionText}>
                Processing...
              </ThemedText>
            ) : (
              <ThemedText style={styles.instructionText}>
                Position QR code within the frame
              </ThemedText>
            )}

            {cameraError ? (
              <Pressable
                onPress={() => {
                  setCameraError("");
                  setCameraSessionKey((key) => key + 1);
                }}
                style={[
                  styles.scanAgainButton,
                  { backgroundColor: "rgba(255,255,255,0.2)" },
                ]}
                testID="button-retry-camera"
              >
                <ThemedText style={styles.scanAgainText}>
                  Try Camera Again
                </ThemedText>
              </Pressable>
            ) : null}

            {scanned && !checkInMutation.isPending ? (
              <Pressable
                onPress={handleScanAgain}
                style={[
                  styles.scanAgainButton,
                  { backgroundColor: "rgba(255,255,255,0.2)" },
                ]}
                testID="button-scan-another"
              >
                <ThemedText style={styles.scanAgainText}>
                  Scan Another
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        </CameraView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  permissionContainer: {
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing["2xl"],
  },
  permissionCard: {
    borderRadius: BorderRadius["2xl"],
    padding: Spacing["3xl"],
    alignItems: "center",
    width: "100%",
    maxWidth: 340,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing.xl,
  },
  permissionTitle: {
    textAlign: "center",
    marginBottom: Spacing.md,
  },
  permissionText: {
    textAlign: "center",
    marginBottom: Spacing.xl,
  },
  permissionButton: {
    width: "100%",
  },
  webPlaceholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing["2xl"],
  },
  webText: {
    marginTop: Spacing.xl,
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
  },
  webSubtext: {
    marginTop: Spacing.sm,
    textAlign: "center",
  },
  camera: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  scanArea: {
    width: 280,
    height: 280,
    backgroundColor: "transparent",
  },
  corner: {
    position: "absolute",
    width: 40,
    height: 40,
    borderColor: "#FFFFFF",
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 12,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 12,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 12,
  },
  bottomRight: {
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
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingTop: Spacing.xl,
    paddingHorizontal: Spacing.xl,
    alignItems: "center",
  },
  instructionText: {
    color: "#FFFFFF",
    fontSize: 16,
    textAlign: "center",
  },
  errorContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(239,68,68,0.2)",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  successContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: "rgba(255,255,255,0.94)",
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  successText: {
    color: AppColors.success,
    fontSize: 15,
    fontWeight: "700",
  },
  errorText: {
    color: AppColors.error,
    marginLeft: Spacing.sm,
    fontWeight: "500",
  },
  scanAgainButton: {
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.full,
  },
  scanAgainText: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
});
