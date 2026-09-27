import React, { useCallback, useEffect, useState } from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  Switch,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { getScreenContentTopPadding } from "@/hooks/useScreenOptions";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/query-client";
import { confirmAction, confirmDestructive } from "@/lib/confirm-destructive";
import { AppColors, BorderRadius, Spacing, Shadows } from "@/constants/theme";
import * as Haptics from "expo-haptics";
import { getNotificationDeviceId } from "@/lib/notification-device";

type DeviceSession = {
  id: string;
  deviceId: string;
  userAgent?: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
};

function deviceName(userAgent?: string | null): string {
  if (!userAgent) return "Unknown device";
  if (/iphone/i.test(userAgent)) return "iPhone";
  if (/ipad/i.test(userAgent)) return "iPad";
  if (/android/i.test(userAgent)) return "Android device";
  if (/macintosh|mac os/i.test(userAgent)) return "Mac";
  if (/windows/i.test(userAgent)) return "Windows computer";
  return "Web browser";
}

function formatLastSeen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Last seen recently";
  return `Last seen ${date.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  })}`;
}

function SettingRow({
  icon,
  label,
  description,
  onPress,
  rightEl,
  iconColor,
  theme,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  description?: string;
  onPress?: () => void;
  rightEl?: React.ReactNode;
  iconColor?: string;
  theme: any;
}) {
  const color = iconColor || AppColors.accent;
  return (
    <Pressable
      style={({ pressed }) => [
        styles.settingRow,
        { opacity: pressed && onPress ? 0.7 : 1 },
      ]}
      onPress={onPress}
      disabled={!onPress && !rightEl}
    >
      <View style={[styles.settingIcon, { backgroundColor: `${color}12` }]}>
        <Feather name={icon} size={18} color={color} />
      </View>
      <View style={styles.settingText}>
        <ThemedText style={[styles.settingLabel, { color: theme.text }]}>
          {label}
        </ThemedText>
        {description ? (
          <ThemedText
            style={[styles.settingDesc, { color: theme.textSecondary }]}
          >
            {description}
          </ThemedText>
        ) : null}
      </View>
      {rightEl ? (
        rightEl
      ) : onPress ? (
        <Feather name="chevron-right" size={16} color={theme.textTertiary} />
      ) : null}
    </Pressable>
  );
}

function SectionCard({
  title,
  children,
  theme,
}: {
  title: string;
  children: React.ReactNode;
  theme: any;
}) {
  return (
    <View style={styles.sectionBlock}>
      <ThemedText style={[styles.sectionLabel, { color: theme.textTertiary }]}>
        {title}
      </ThemedText>
      <View
        style={[
          styles.sectionCard,
          {
            backgroundColor: theme.cardBackground,
            borderColor: theme.cardBorder,
          },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme, isDark, setMode } = useTheme();
  const { user, logout, notificationDeviceId: contextDeviceId } = useAuth();
  const userId = user?.id;
  const [deviceId, setDeviceId] = useState(contextDeviceId);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [preferencesLoading, setPreferencesLoading] = useState(true);

  const [pushNotifications, setPushNotifications] = useState(true);
  const [sessionAlerts, setSessionAlerts] = useState(true);
  const [devices, setDevices] = useState<DeviceSession[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [revokingDevice, setRevokingDevice] = useState<string | null>(null);

  useEffect(() => {
    if (contextDeviceId) setDeviceId(contextDeviceId);
  }, [contextDeviceId]);

  useEffect(() => {
    if (!userId || !deviceId) return;
    setPreferencesLoading(true);
    apiRequest(
      `/api/users/notification-preferences?deviceId=${encodeURIComponent(deviceId)}`,
    )
      .then((res) => res.json())
      .then((prefs) => {
        setPushNotifications(prefs.pushEnabled);
        setSessionAlerts(prefs.sessionAlerts);
        setPreferenceError(null);
      })
      .catch(() => setPreferenceError("Could not load notification settings."))
      .finally(() => setPreferencesLoading(false));
  }, [userId, deviceId]);

  const loadDevices = useCallback(async () => {
    if (!userId) return;
    setDevicesLoading(true);
    try {
      const response = await apiRequest(
        `/api/auth/devices?deviceId=${encodeURIComponent(deviceId)}`,
      );
      if (!response.ok) throw new Error("Unable to load devices");
      setDevices(await response.json());
    } catch {
      Alert.alert("Error", "Could not load your signed-in devices.");
    } finally {
      setDevicesLoading(false);
    }
  }, [deviceId, userId]);

  useEffect(() => {
    if (userId && deviceId) loadDevices();
  }, [deviceId, loadDevices, userId]);

  const revokeDevice = async (device: DeviceSession) => {
    const isCurrent = device.current || device.deviceId === deviceId;
    const confirmed = await confirmDestructive(
      isCurrent ? "Sign out this device?" : "Revoke this device?",
      isCurrent
        ? "This will sign you out on the device you are using now."
        : "This device will no longer be able to access your account.",
      isCurrent ? "Sign out" : "Revoke device",
    );
    if (!confirmed) return;

    setRevokingDevice(device.id);
    try {
      const response = await apiRequest(`/api/auth/devices/${device.id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Revoke failed");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (isCurrent) {
        await logout();
      } else {
        await loadDevices();
      }
    } catch {
      Alert.alert("Error", "Could not revoke this device. Please try again.");
    } finally {
      setRevokingDevice(null);
    }
  };

  const updatePreference = async (
    key: "pushEnabled" | "sessionAlerts",
    value: boolean,
  ) => {
    if (!deviceId) return;
    const setters = {
      pushEnabled: setPushNotifications,
      sessionAlerts: setSessionAlerts,
    };
    setters[key](value);
    setPreferenceError(null);
    try {
      await apiRequest("/api/users/notification-preferences", {
        method: "PUT",
        body: JSON.stringify({ deviceId, [key]: value }),
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      setters[key](!value);
      setPreferenceError("Could not save that setting. Please try again.");
    }
  };

  const switchProps = (value: boolean) => ({
    trackColor: {
      false: theme.backgroundTertiary,
      true: `${AppColors.accent}60`,
    },
    thumbColor: value ? AppColors.accent : theme.textSecondary,
    ios_backgroundColor: theme.backgroundTertiary,
  });

  const [gdprLoading, setGdprLoading] = useState<"data" | "deletion" | null>(
    null,
  );

  const handleLogout = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    logout();
  };

  const handleRequestData = async () => {
    const confirmed = await confirmAction(
      "Request My Data",
      "We will email you a copy of all personal data we hold about you. An administrator will process your request within 30 days.",
      "Send Request",
    );
    if (!confirmed) return;

    setGdprLoading("data");
    try {
      await apiRequest("/api/auth/request-data", { method: "POST" });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        "Request Submitted",
        "Your data request has been received. You will be contacted within 30 days.",
      );
    } catch (error) {
      Alert.alert(
        "Error",
        error instanceof Error
          ? error.message
          : "Failed to submit request. Please try again.",
      );
    } finally {
      setGdprLoading(null);
    }
  };

  const handleRequestDeletion = async () => {
    const confirmed = await confirmDestructive(
      "Delete My Account",
      "This will submit a request to permanently delete your account and all associated data. An administrator will process your request within 30 days. You can continue using the app until then.",
      "Submit Deletion Request",
    );
    if (!confirmed) return;

    setGdprLoading("deletion");
    try {
      await apiRequest("/api/auth/request-deletion", { method: "POST" });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        "Request Submitted",
        "Your account deletion request has been received. You will be notified once it has been processed.",
      );
    } catch (error) {
      Alert.alert(
        "Error",
        error instanceof Error
          ? error.message
          : "Failed to submit request. Please try again.",
      );
    } finally {
      setGdprLoading(null);
    }
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      contentContainerStyle={{
        paddingTop: getScreenContentTopPadding(headerHeight, Spacing.xl),
        paddingBottom: insets.bottom + Spacing["3xl"],
        paddingHorizontal: Spacing.lg,
      }}
      showsVerticalScrollIndicator={false}
    >
      <SectionCard title="Account" theme={theme}>
        <SettingRow
          icon="user"
          label={user?.name || "User"}
          description={user?.email}
          theme={theme}
        />
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <SettingRow
          icon="shield"
          label="Role"
          description={
            user?.role === "admin"
              ? "Administrator"
              : user?.role === "staff"
                ? "Staff Member"
                : "Attendee"
          }
          iconColor={
            user?.role === "admin"
              ? "#8B5CF6"
              : user?.role === "staff"
                ? AppColors.accent
                : AppColors.primary
          }
          theme={theme}
        />
      </SectionCard>

      <SectionCard title="Notifications" theme={theme}>
        {preferencesLoading ? (
          <ThemedText
            style={{ color: theme.textSecondary, padding: Spacing.sm }}
          >
            Loading saved notification settings…
          </ThemedText>
        ) : null}
        {preferenceError ? (
          <Pressable
            onPress={() => {
              setDeviceId("");
              getNotificationDeviceId()
                .then(setDeviceId)
                .catch(() => {});
            }}
            accessibilityRole="button"
          >
            <ThemedText style={{ color: AppColors.error, padding: Spacing.sm }}>
              {preferenceError} Tap to retry.
            </ThemedText>
          </Pressable>
        ) : null}
        <SettingRow
          icon="bell"
          label="Push Notifications"
          description="Receive push notifications"
          theme={theme}
          rightEl={
            <Switch
              value={pushNotifications}
              onValueChange={(v) => updatePreference("pushEnabled", v)}
              {...switchProps(pushNotifications)}
            />
          }
        />
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <SettingRow
          icon="alert-circle"
          label="Session Alerts"
          description="Notifications for schedule changes"
          theme={theme}
          rightEl={
            <Switch
              value={sessionAlerts}
              onValueChange={(v) => updatePreference("sessionAlerts", v)}
              {...switchProps(sessionAlerts)}
            />
          }
        />
      </SectionCard>

      <SectionCard title="Appearance" theme={theme}>
        <SettingRow
          icon="moon"
          label="Dark Mode"
          description={
            isDark ? "A darker interface is enabled" : "Use a darker interface"
          }
          theme={theme}
          rightEl={
            <Switch
              value={isDark}
              onValueChange={(enabled) => {
                setMode(enabled ? "dark" : "light");
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              {...switchProps(isDark)}
              accessibilityLabel="Toggle dark mode"
            />
          }
        />
      </SectionCard>

      <SectionCard title="Signed-in devices" theme={theme}>
        <ThemedText
          style={[styles.deviceIntro, { color: theme.textSecondary }]}
        >
          Review where your account is signed in and remove devices you no
          longer recognize.
        </ThemedText>
        {devicesLoading ? (
          <ThemedText
            style={{ color: theme.textSecondary, padding: Spacing.sm }}
          >
            Loading devices…
          </ThemedText>
        ) : devices.length === 0 ? (
          <ThemedText
            style={{ color: theme.textSecondary, padding: Spacing.sm }}
          >
            No active devices found.
          </ThemedText>
        ) : (
          devices.map((device, index) => (
            <React.Fragment key={device.id}>
              {index > 0 ? (
                <View
                  style={[styles.divider, { backgroundColor: theme.border }]}
                />
              ) : null}
              <View style={styles.deviceRow}>
                <View
                  style={[
                    styles.deviceIcon,
                    { backgroundColor: `${AppColors.primary}12` },
                  ]}
                >
                  <Feather name="monitor" size={18} color={AppColors.primary} />
                </View>
                <View style={styles.deviceText}>
                  <View style={styles.deviceTitleRow}>
                    <ThemedText
                      style={[styles.settingLabel, { color: theme.text }]}
                    >
                      {deviceName(device.userAgent)}
                    </ThemedText>
                    {device.current ? (
                      <View style={styles.currentBadge}>
                        <ThemedText style={styles.currentBadgeText}>
                          This device
                        </ThemedText>
                      </View>
                    ) : null}
                  </View>
                  <ThemedText
                    style={[styles.settingDesc, { color: theme.textSecondary }]}
                  >
                    {formatLastSeen(device.lastSeenAt)}
                  </ThemedText>
                  <Pressable
                    onPress={() => revokeDevice(device)}
                    disabled={revokingDevice === device.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Revoke ${deviceName(device.userAgent)}`}
                  >
                    <ThemedText
                      style={[
                        styles.revokeText,
                        {
                          color:
                            revokingDevice === device.id
                              ? theme.textTertiary
                              : AppColors.error,
                        },
                      ]}
                    >
                      {revokingDevice === device.id
                        ? "Revoking…"
                        : "Revoke device"}
                    </ThemedText>
                  </Pressable>
                </View>
              </View>
            </React.Fragment>
          ))
        )}
      </SectionCard>

      {user?.role === "attendee" && (
        <SectionCard title="My Data & Privacy" theme={theme}>
          <SettingRow
            icon="download"
            label="Request My Data"
            description="Receive a copy of all data we hold about you"
            onPress={gdprLoading ? undefined : handleRequestData}
            theme={theme}
            iconColor="#0369A1"
          />
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <SettingRow
            icon="trash-2"
            label="Delete My Account"
            description="Request permanent deletion of your account"
            onPress={gdprLoading ? undefined : handleRequestDeletion}
            theme={theme}
            iconColor={AppColors.error}
          />
        </SectionCard>
      )}

      <Pressable
        onPress={handleLogout}
        style={({ pressed }) => [
          styles.logoutBtn,
          {
            backgroundColor: `${AppColors.error}0C`,
            borderColor: `${AppColors.error}18`,
            opacity: pressed ? 0.75 : 1,
          },
        ]}
      >
        <View
          style={[
            styles.logoutIcon,
            { backgroundColor: `${AppColors.error}12` },
          ]}
        >
          <Feather name="log-out" size={17} color={AppColors.error} />
        </View>
        <ThemedText style={[styles.logoutText, { color: AppColors.error }]}>
          Sign Out
        </ThemedText>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  sectionBlock: { marginBottom: Spacing.xl },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.9,
    marginBottom: Spacing.sm,
  },
  sectionCard: {
    borderRadius: BorderRadius.xl,
    padding: Spacing.md,
    borderWidth: 1,
    ...Shadows.card,
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
  },
  settingIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.lg,
  },
  settingText: { flex: 1 },
  settingLabel: { fontSize: 15, fontWeight: "500" },
  settingDesc: { fontSize: 12, marginTop: 1 },
  deviceIntro: {
    fontSize: 13,
    lineHeight: 19,
    paddingHorizontal: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  deviceRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.sm,
  },
  deviceIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.lg,
  },
  deviceText: { flex: 1 },
  deviceTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  currentBadge: {
    backgroundColor: `${AppColors.success}18`,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
  },
  currentBadgeText: {
    color: AppColors.success,
    fontSize: 10,
    fontWeight: "700",
  },
  revokeText: { fontSize: 12, fontWeight: "600", marginTop: Spacing.sm },
  divider: { height: 1, marginLeft: 56 },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    gap: Spacing.md,
  },
  logoutIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  logoutText: { fontSize: 15, fontWeight: "600" },
});
