import React, { useState, useEffect, useRef } from "react";
import {
  StyleSheet,
  View,
  Pressable,
  Modal,
  FlatList,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import QRCode from "react-native-qrcode-svg";
import {
  createDrawerNavigator,
  DrawerContentScrollView,
  DrawerContentComponentProps,
} from "@react-navigation/drawer";
import { HeaderButton } from "@react-navigation/elements";
import { DrawerActions } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { CheckInSuccess } from "@/components/CheckInSuccess";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { useScreenOptions } from "@/hooks/useScreenOptions";
import { HeaderTitle } from "@/components/HeaderTitle";
import { AppColors, BorderRadius, Spacing, Shadows } from "@/constants/theme";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AdminEventProvider,
  useAdminEvent,
  AdminEventInfo,
} from "@/contexts/AdminEventContext";
import { useEventTheme } from "@/contexts/EventThemeContext";
import * as Haptics from "expo-haptics";
import { apiRequest } from "@/lib/query-client";
import { navigationRef } from "@/lib/navigationRef";

import AttendeeHomeScreen from "@/screens/attendee/AttendeeHomeScreen";
import AgendaScreen from "@/screens/attendee/AgendaScreen";
import SpeakersScreen from "@/screens/attendee/SpeakersScreen";
import MyQRCodeScreen from "@/screens/attendee/MyQRCodeScreen";
import NotificationsScreen from "@/screens/shared/NotificationsScreen";
import ProfileScreen from "@/screens/shared/ProfileScreen";
import CompaniesScreen from "@/screens/shared/CompaniesScreen";
import CompanyProfileScreen from "@/screens/shared/CompanyProfileScreen";
import SettingsScreen from "@/screens/shared/SettingsScreen";
import AboutScreen from "@/screens/shared/AboutScreen";
import HelpSupportScreen from "@/screens/shared/HelpSupportScreen";

import CaseStudyScanScreen from "@/screens/staff/CaseStudyScanScreen";
import CaseStudyDetailScreen from "@/screens/staff/CaseStudyDetailScreen";
import StaffDashboardScreen from "@/screens/staff/StaffDashboardScreen";
import ScanQRScreen from "@/screens/staff/ScanQRScreen";
import AttendeeSearchScreen from "@/screens/staff/AttendeeSearchScreen";
import StatsScreen from "@/screens/staff/StatsScreen";
import StaffScheduleScreen from "@/screens/staff/StaffScheduleScreen";
import PublishNotificationScreen from "@/screens/staff/PublishNotificationScreen";

import AdminEventControlScreen from "@/screens/admin/AdminEventControlScreen";
import AdminDashboardScreen from "@/screens/admin/AdminDashboardScreen";
import AdminUsersScreen from "@/screens/admin/AdminUsersScreen";
import AdminSpeakersScreen from "@/screens/admin/AdminSpeakersScreen";
import AdminCompaniesScreen from "@/screens/admin/AdminCompaniesScreen";
import AdminCaseStudiesScreen from "@/screens/admin/AdminCaseStudiesScreen";
import AdminTimetableScreen from "@/screens/admin/AdminTimetableScreen";
import AdminSecurityLogScreen from "@/screens/admin/AdminSecurityLogScreen";
import AdminAuditLogScreen from "@/screens/admin/AdminAuditLogScreen";
import AdminGDPRScreen from "@/screens/admin/AdminGDPRScreen";

export type DrawerParamList = {
  Home: undefined;
  Agenda: undefined;
  Speakers: undefined;
  Companies: undefined;
  CompanyProfile: { companyId: string };
  MyQRCode: undefined;
  Notifications: undefined;
  Profile: undefined;
  Settings: undefined;
  About: undefined;
  HelpSupport: undefined;
  Dashboard: undefined;
  CaseStudyScan: undefined;
  CaseStudyDetail: { caseStudyId: string };
  ScanQR: undefined;
  AttendeeSearch: { filter?: "all" | "pending" | "checked_in" } | undefined;
  Stats: undefined;
  StaffSchedule: undefined;
  PublishNotification: undefined;
  AdminEventControl: undefined;
  AdminDashboard: undefined;
  AdminUsers: undefined;
  AdminSpeakers: undefined;
  AdminCompanies: undefined;
  AdminCaseStudies: undefined;
  AdminTimetable: undefined;
  AdminSecurityLog: undefined;
  AdminAuditLog: undefined;
  AdminGDPR: undefined;
};

const Drawer = createDrawerNavigator<DrawerParamList>();

interface DrawerItemProps {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  isActive: boolean;
  onPress: () => void;
  theme: any;
  badge?: string;
}

function DrawerItem({
  icon,
  label,
  isActive,
  onPress,
  theme,
  badge,
}: DrawerItemProps) {
  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={({ pressed }) => [
        styles.drawerItem,
        isActive && { backgroundColor: theme.drawerActiveBackground },
        { opacity: pressed ? 0.75 : 1 },
      ]}
    >
      <View
        style={[
          styles.drawerItemIconWrap,
          isActive && { backgroundColor: `${theme.drawerActiveTint}18` },
        ]}
      >
        <Feather
          name={icon}
          size={18}
          color={isActive ? theme.drawerActiveTint : theme.drawerInactiveTint}
        />
      </View>
      <ThemedText
        style={[
          styles.drawerItemLabel,
          {
            color: isActive ? theme.drawerActiveTint : theme.drawerInactiveTint,
          },
          isActive && { fontWeight: "600" },
        ]}
        numberOfLines={1}
      >
        {label}
      </ThemedText>
      {badge ? (
        <View style={[styles.badge, { backgroundColor: AppColors.accent }]}>
          <ThemedText style={styles.badgeText}>{badge}</ThemedText>
        </View>
      ) : null}
    </Pressable>
  );
}

function SectionLabel({ label, theme }: { label: string; theme: any }) {
  return (
    <ThemedText style={[styles.sectionLabel, { color: theme.textTertiary }]}>
      {label}
    </ThemedText>
  );
}

function AttendeeHeaderTitle() {
  const eventTheme = useEventTheme();
  return (
    <HeaderTitle
      title={eventTheme.eventId ? eventTheme.eventName : "No live event"}
    />
  );
}

function EventSwitcherButton({ theme }: { theme: any }) {
  const {
    adminEventId,
    adminEventName,
    adminEventStatus,
    allEvents,
    setAdminEvent,
    isLoadingEvents,
  } = useAdminEvent();
  const insets = useSafeAreaInsets();
  const [showPicker, setShowPicker] = useState(false);

  if (isLoadingEvents || allEvents.length === 0) return null;

  const statusColor =
    adminEventStatus === "published"
      ? (AppColors.success ?? "#16a34a")
      : adminEventStatus === "archived"
        ? "#9CA3AF"
        : "#F59E0B";
  const statusLabel =
    adminEventStatus === "published"
      ? "Live"
      : adminEventStatus === "archived"
        ? "Archived"
        : "Draft";

  return (
    <>
      <Pressable
        onPress={() => setShowPicker(true)}
        style={[
          styles.eventSwitcher,
          {
            backgroundColor: `${AppColors.primary}10`,
            borderColor: `${AppColors.primary}25`,
          },
        ]}
        testID="button-switch-event"
      >
        <View
          style={[styles.eventSwitcherDot, { backgroundColor: statusColor }]}
        />
        <View style={{ flex: 1 }}>
          <ThemedText
            style={[styles.eventSwitcherLabel, { color: theme.textSecondary }]}
          >
            Managing Event
          </ThemedText>
          <ThemedText
            style={[styles.eventSwitcherName, { color: theme.text }]}
            numberOfLines={1}
          >
            {adminEventName || "Select event"}
          </ThemedText>
        </View>
        <View
          style={[styles.statusPill, { backgroundColor: `${statusColor}15` }]}
        >
          <ThemedText style={[styles.statusPillText, { color: statusColor }]}>
            {statusLabel}
          </ThemedText>
        </View>
        <Feather name="chevron-down" size={14} color={theme.textSecondary} />
      </Pressable>

      <Modal
        visible={showPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPicker(false)}
      >
        <View style={styles.pickerOverlay}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close event switcher"
            onPress={() => setShowPicker(false)}
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[
              styles.pickerSheet,
              {
                backgroundColor: theme.cardBackground,
                paddingBottom: insets.bottom + Spacing.lg,
              },
            ]}
          >
            <View style={styles.pickerHandle} />
            <ThemedText style={[styles.pickerTitle, { color: theme.text }]}>
              Switch Event Context
            </ThemedText>
            <ThemedText
              style={[styles.pickerSub, { color: theme.textSecondary }]}
            >
              Select which event year you are managing
            </ThemedText>
            <FlatList
              data={allEvents}
              keyExtractor={(e) => e.id}
              style={styles.pickerList}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }: { item: AdminEventInfo }) => {
                const isSelected = item.id === adminEventId;
                const sc =
                  item.status === "published"
                    ? (AppColors.success ?? "#16a34a")
                    : item.status === "archived"
                      ? "#9CA3AF"
                      : "#F59E0B";
                const sl =
                  item.status === "published"
                    ? "Live"
                    : item.status === "archived"
                      ? "Archived"
                      : "Draft";
                return (
                  <Pressable
                    onPress={() => {
                      setAdminEvent(item);
                      setShowPicker(false);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                    style={[
                      styles.pickerItem,
                      {
                        backgroundColor: isSelected
                          ? `${AppColors.primary}10`
                          : "transparent",
                        borderColor: isSelected
                          ? `${AppColors.primary}30`
                          : theme.border,
                      },
                    ]}
                    testID={`button-select-event-${item.id}`}
                  >
                    <View style={{ flex: 1 }}>
                      <ThemedText
                        style={[styles.pickerItemName, { color: theme.text }]}
                      >
                        {item.name}
                      </ThemedText>
                      <ThemedText
                        style={[
                          styles.pickerItemYear,
                          { color: theme.textSecondary },
                        ]}
                      >
                        {item.year}
                      </ThemedText>
                    </View>
                    <View
                      style={[
                        styles.statusPill,
                        { backgroundColor: `${sc}15` },
                      ]}
                    >
                      <ThemedText
                        style={[styles.statusPillText, { color: sc }]}
                      >
                        {sl}
                      </ThemedText>
                    </View>
                    {isSelected ? (
                      <Feather
                        name="check"
                        size={16}
                        color={AppColors.primary}
                        style={{ marginLeft: 8 }}
                      />
                    ) : null}
                  </Pressable>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

function CustomDrawerContent(props: DrawerContentComponentProps) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { user, logout } = useAuth();
  const { data: drawerNotifications = [] } = useQuery<{ read?: boolean }[]>({
    queryKey: ["/api/notifications"],
    enabled: !!user,
    refetchInterval: 15000,
  });
  const unreadNotificationCount = drawerNotifications.filter(
    (item) => !item.read,
  ).length;
  const { state, navigation } = props;

  const isStaff = user?.role === "staff";
  const isAdmin = user?.role === "admin";
  const currentRouteName = state.routes[state.index]?.name;

  const roleColor = isAdmin
    ? "#8B5CF6"
    : isStaff
      ? AppColors.accent
      : AppColors.primary;
  const roleLabel = isAdmin ? "Admin" : isStaff ? "Staff" : "Attendee";

  const staffMainItems = [
    { name: "Dashboard", icon: "home" as const, label: "Dashboard" },
    { name: "ScanQR", icon: "camera" as const, label: "Scan QR Code" },
    {
      name: "CaseStudyScan",
      icon: "book-open" as const,
      label: "Case Study Scanning",
    },
    { name: "AttendeeSearch", icon: "search" as const, label: "Attendee List" },
    { name: "StaffSchedule", icon: "calendar" as const, label: "Schedule" },
    { name: "Stats", icon: "bar-chart-2" as const, label: "Statistics" },
  ];

  const staffBrowseItems = [
    { name: "Companies", icon: "briefcase" as const, label: "Companies" },
    {
      name: "PublishNotification",
      icon: "send" as const,
      label: "Publish Notification",
    },
    { name: "Notifications", icon: "bell" as const, label: "Notifications" },
  ];

  const adminMainItems = [
    {
      name: "AdminEventControl",
      icon: "layers" as const,
      label: "Event Years",
    },
    { name: "AdminDashboard", icon: "shield" as const, label: "Admin Panel" },
    { name: "AdminUsers", icon: "users" as const, label: "Manage Users" },
    { name: "AdminSpeakers", icon: "mic" as const, label: "Manage Speakers" },
    {
      name: "AdminCompanies",
      icon: "briefcase" as const,
      label: "Manage Companies",
    },
    {
      name: "AdminCaseStudies",
      icon: "book-open" as const,
      label: "Manage Case Studies",
    },
    {
      name: "AdminTimetable",
      icon: "clock" as const,
      label: "Manage Timetable",
    },
    {
      name: "AdminSecurityLog",
      icon: "activity" as const,
      label: "Security Log",
    },
    { name: "AdminAuditLog", icon: "shield" as const, label: "Audit Log" },
    { name: "AdminGDPR", icon: "user-x" as const, label: "GDPR Requests" },
    {
      name: "Notifications",
      icon: "bell" as const,
      label: "Notification History",
    },
  ];

  const adminStaffItems = [
    { name: "Dashboard", icon: "home" as const, label: "Check-in Dashboard" },
    { name: "ScanQR", icon: "camera" as const, label: "Scan QR Code" },
    {
      name: "CaseStudyScan",
      icon: "book-open" as const,
      label: "Case Study Scanning",
    },
    { name: "AttendeeSearch", icon: "search" as const, label: "Attendee List" },
    { name: "Stats", icon: "bar-chart-2" as const, label: "Statistics" },
    {
      name: "PublishNotification",
      icon: "send" as const,
      label: "Publish Announcement",
    },
  ];

  const attendeeMainItems = [
    { name: "Home", icon: "home" as const, label: "Home" },
    { name: "StaffSchedule", icon: "clock" as const, label: "Timetable" },
    { name: "Agenda", icon: "book-open" as const, label: "My Case Studies" },
    { name: "Companies", icon: "briefcase" as const, label: "Companies" },
    { name: "Speakers", icon: "users" as const, label: "Speakers" },
    { name: "MyQRCode", icon: "grid" as const, label: "My QR Code" },
    { name: "Notifications", icon: "bell" as const, label: "Notifications" },
  ];

  const accountItems = [
    { name: "Profile", icon: "user" as const, label: "Profile" },
    { name: "Settings", icon: "settings" as const, label: "Settings" },
    { name: "About", icon: "info" as const, label: "About" },
  ];

  const handleLogout = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    logout();
  };

  return (
    <View
      style={[
        styles.drawerWrapper,
        { backgroundColor: theme.drawerBackground },
      ]}
    >
      <DrawerContentScrollView
        {...props}
        // DrawerContentScrollView already applies the platform safe-area inset.
        // Adding it here again creates a large blank band on Android.
        contentContainerStyle={styles.drawerContent}
        style={{ backgroundColor: theme.drawerBackground }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.userCard,
            { backgroundColor: theme.backgroundSecondary },
          ]}
        >
          <LinearGradient
            colors={
              isAdmin
                ? ["#8B5CF6", "#7C3AED"]
                : isStaff
                  ? [AppColors.accent, "#E07B0E"]
                  : [AppColors.primary, "#1a0080"]
            }
            style={styles.avatarGradient}
          >
            <ThemedText style={styles.avatarInitials}>
              {(user?.name || "U")
                .split(" ")
                .slice(0, 2)
                .map((n) => n[0])
                .join("")
                .toUpperCase()}
            </ThemedText>
          </LinearGradient>
          <View style={styles.userMeta}>
            <ThemedText
              style={[styles.userName, { color: theme.text }]}
              numberOfLines={1}
            >
              {user?.name || "User"}
            </ThemedText>
            <ThemedText
              style={[styles.userEmail, { color: theme.textSecondary }]}
              numberOfLines={1}
            >
              {user?.email || ""}
            </ThemedText>
            <View
              style={[styles.rolePill, { backgroundColor: `${roleColor}14` }]}
            >
              <ThemedText style={[styles.roleText, { color: roleColor }]}>
                {roleLabel}
              </ThemedText>
            </View>
          </View>
        </View>

        <View style={styles.menuSection}>
          {isAdmin ? (
            <>
              <EventSwitcherButton theme={theme} />
              <SectionLabel label="Admin" theme={theme} />
              {adminMainItems.map((item) => (
                <DrawerItem
                  key={item.name}
                  icon={item.icon}
                  label={item.label}
                  isActive={currentRouteName === item.name}
                  onPress={() => navigation.navigate(item.name)}
                  theme={theme}
                />
              ))}
              <SectionLabel label="Staff Tools" theme={theme} />
              {adminStaffItems.map((item) => (
                <DrawerItem
                  key={item.name}
                  icon={item.icon}
                  label={item.label}
                  isActive={currentRouteName === item.name}
                  onPress={() => navigation.navigate(item.name)}
                  theme={theme}
                />
              ))}
            </>
          ) : isStaff ? (
            <>
              {staffMainItems.map((item) => (
                <DrawerItem
                  key={item.name}
                  icon={item.icon}
                  label={item.label}
                  isActive={currentRouteName === item.name}
                  onPress={() => navigation.navigate(item.name)}
                  theme={theme}
                />
              ))}
              <SectionLabel label="Browse" theme={theme} />
              {staffBrowseItems.map((item) => (
                <DrawerItem
                  key={item.name}
                  icon={item.icon}
                  label={item.label}
                  isActive={currentRouteName === item.name}
                  onPress={() => navigation.navigate(item.name)}
                  theme={theme}
                  badge={
                    item.name === "Notifications" && unreadNotificationCount > 0
                      ? String(unreadNotificationCount)
                      : undefined
                  }
                />
              ))}
            </>
          ) : (
            attendeeMainItems.map((item) => (
              <DrawerItem
                key={item.name}
                icon={item.icon}
                label={item.label}
                isActive={currentRouteName === item.name}
                onPress={() => navigation.navigate(item.name)}
                theme={theme}
                badge={
                  item.name === "Notifications" && unreadNotificationCount > 0
                    ? String(unreadNotificationCount)
                    : undefined
                }
              />
            ))
          )}

          <SectionLabel label="Account" theme={theme} />
          {accountItems.map((item) => (
            <DrawerItem
              key={item.name}
              icon={item.icon}
              label={item.label}
              isActive={currentRouteName === item.name}
              onPress={() => navigation.navigate(item.name)}
              theme={theme}
            />
          ))}
        </View>
      </DrawerContentScrollView>

      <View
        style={[
          styles.footer,
          {
            borderTopColor: theme.border,
            paddingBottom: insets.bottom + Spacing.md,
            backgroundColor: theme.drawerBackground,
          },
        ]}
      >
        <Pressable
          onPress={handleLogout}
          style={({ pressed }) => [
            styles.logoutButton,
            { opacity: pressed ? 0.7 : 1 },
          ]}
          testID="button-logout"
        >
          <View style={styles.logoutIconWrap}>
            <Feather name="log-out" size={17} color={AppColors.error} />
          </View>
          <ThemedText style={[styles.logoutText, { color: AppColors.error }]}>
            Sign Out
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

interface UserNotification {
  id: string;
  title: string;
  message: string;
  type?: "announcement" | "reminder" | "alert";
  createdAt: string;
  read?: boolean;
}

function InAppNotificationPopup({
  user,
  onOpen,
}: {
  user: { role?: string } | null | undefined;
  onOpen: () => void;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [notification, setNotification] = useState<UserNotification | null>(
    null,
  );
  const initialIdsRef = useRef<Set<string> | null>(null);
  const shownIdsRef = useRef(new Set<string>());

  const { data: notifications = [] } = useQuery<UserNotification[]>({
    queryKey: ["/api/notifications"],
    enabled: user?.role === "attendee" || user?.role === "staff",
    refetchInterval: 15000,
  });

  useEffect(() => {
    if (!notifications.length) {
      if (initialIdsRef.current === null) initialIdsRef.current = new Set();
      return;
    }

    if (initialIdsRef.current === null) {
      initialIdsRef.current = new Set(notifications.map((item) => item.id));
      return;
    }

    const nextNotification = notifications.find(
      (item) =>
        !item.read &&
        !item.id.startsWith("reminder-") &&
        !initialIdsRef.current?.has(item.id) &&
        !shownIdsRef.current.has(item.id),
    );

    if (nextNotification) {
      shownIdsRef.current.add(nextNotification.id);
      setNotification(nextNotification);
    }
  }, [notifications]);

  const close = () => setNotification(null);
  const notificationId = notification?.id;

  useEffect(() => {
    if (!notificationId) return;
    const timer = setTimeout(() => setNotification(null), 2800);
    return () => clearTimeout(timer);
  }, [notificationId]);

  const openNotification = async () => {
    if (!notification) return;
    try {
      await apiRequest(`/api/notifications/${notification.id}/read`, {
        method: "POST",
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    } catch {
      // The notification centre will still show the item as unread if marking it fails.
    } finally {
      close();
      onOpen();
    }
  };

  if (!notification) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <View
        style={[
          styles.notificationOverlay,
          { paddingTop: insets.top + Spacing.md },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss notification"
          onPress={close}
          style={StyleSheet.absoluteFill}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open notification: ${notification.title}`}
          onPress={() => void openNotification()}
          style={[
            styles.notificationPopup,
            {
              backgroundColor: theme.cardBackground,
              borderColor: theme.border,
            },
          ]}
        >
          <View
            style={[
              styles.notificationPopupIcon,
              { backgroundColor: `${AppColors.accent}16` },
            ]}
          >
            <Feather name="bell" size={20} color={AppColors.accent} />
          </View>
          <View style={styles.notificationPopupBody}>
            <ThemedText
              style={[
                styles.notificationPopupEyebrow,
                { color: AppColors.accent },
              ]}
            >
              New notification
            </ThemedText>
            <ThemedText
              style={[styles.notificationPopupTitle, { color: theme.text }]}
              numberOfLines={1}
            >
              {notification.title}
            </ThemedText>
            <ThemedText
              style={[
                styles.notificationPopupMessage,
                { color: theme.textSecondary },
              ]}
              numberOfLines={2}
            >
              {notification.message}
            </ThemedText>
            <ThemedText
              style={[
                styles.notificationPopupAction,
                { color: AppColors.accent },
              ]}
            >
              Tap to view
            </ThemedText>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss notification"
            hitSlop={10}
            onPress={close}
            style={styles.notificationPopupClose}
          >
            <Feather name="x" size={18} color={theme.textTertiary} />
          </Pressable>
        </Pressable>
      </View>
    </Modal>
  );
}

function DrawerNavigatorInner() {
  const { theme } = useTheme();
  const { user, refreshUser } = useAuth();
  const screenOptions = useScreenOptions();
  const [showWelcome, setShowWelcome] = useState(false);
  const [showQuickQr, setShowQuickQr] = useState(false);
  const previousCheckedInRef = useRef<boolean | null>(null);
  const insets = useSafeAreaInsets();

  const isStaff = user?.role === "staff";
  const isAdmin = user?.role === "admin";
  const isAttendee = user?.role === "attendee";

  useEffect(() => {
    if (!isAttendee) return;
    if (user?.checkedIn) {
      if (previousCheckedInRef.current === false) {
        setShowQuickQr(false);
        setShowWelcome(true);
      }
      previousCheckedInRef.current = true;
      return;
    }
    previousCheckedInRef.current = false;
    const interval = setInterval(async () => {
      await refreshUser();
    }, 5000);
    return () => clearInterval(interval);
  }, [isAttendee, refreshUser, user?.checkedIn]);

  return (
    <View style={{ flex: 1 }}>
      <Drawer.Navigator
        drawerContent={(props) => <CustomDrawerContent {...props} />}
        screenOptions={({ navigation: nav }) => {
          return {
            ...screenOptions,
            ...(isAdmin
              ? {
                  headerTransparent: false,
                  headerStyle: {
                    backgroundColor: theme.backgroundRoot,
                    // Let React Navigation calculate the native header height.
                    // A fixed 88px header is too short on iPhones with the
                    // larger status-bar/safe-area inset and clips the title
                    // and header actions.
                    ...(Platform.OS === "web" ? { height: 64 } : {}),
                  },
                }
              : {}),
            drawerType: Platform.OS === "web" ? "permanent" : "front",
            drawerPosition: "left",
            drawerStyle: {
              width: 300,
              backgroundColor: theme.drawerBackground,
            },
            headerLeft: () => (
              <HeaderButton
                onPress={() => nav.dispatch(DrawerActions.toggleDrawer())}
                style={{ marginLeft: 8 }}
                testID="button-open-drawer"
              >
                <Feather name="menu" size={24} color={theme.text} />
              </HeaderButton>
            ),
          };
        }}
        initialRouteName={
          isAdmin ? "AdminEventControl" : isStaff ? "Dashboard" : "Home"
        }
      >
        {isAdmin ? (
          <>
            <Drawer.Screen
              name="Dashboard"
              component={StaffDashboardScreen}
              options={{
                headerTitle: () => <HeaderTitle title="Check-in Dashboard" />,
                headerTransparent: false,
                headerStyle: { backgroundColor: theme.backgroundRoot },
              }}
            />
            <Drawer.Screen
              name="AdminEventControl"
              component={AdminEventControlScreen}
              options={{
                headerTitle: () => <HeaderTitle title="Event Control Panel" />,
                // Keep this title on an opaque, theme-coloured header. The
                // control screen starts below a transparent header and its
                // gradient/card content can otherwise reduce title contrast.
                headerTransparent: false,
                headerStyle: { backgroundColor: theme.backgroundRoot },
              }}
            />
            <Drawer.Screen
              name="AdminDashboard"
              component={AdminDashboardScreen}
              options={{
                headerTitle: () => <HeaderTitle title="Admin Panel" />,
                headerTransparent: false,
                headerStyle: { backgroundColor: theme.backgroundRoot },
              }}
            />
            <Drawer.Screen
              name="AdminUsers"
              component={AdminUsersScreen}
              options={{
                headerTitle: () => <HeaderTitle title="Manage Users" />,
                headerTransparent: false,
              }}
            />
            <Drawer.Screen
              name="AdminSpeakers"
              component={AdminSpeakersScreen}
              options={{
                headerTitle: "Manage Speakers",
                headerTransparent: false,
              }}
            />
            <Drawer.Screen
              name="AdminCompanies"
              component={AdminCompaniesScreen}
              options={{
                headerTitle: "Manage Companies",
                headerTransparent: false,
              }}
            />
            <Drawer.Screen
              name="AdminCaseStudies"
              component={AdminCaseStudiesScreen}
              options={{
                headerTitle: () => <HeaderTitle title="Manage Case Studies" />,
                headerTransparent: false,
              }}
            />
            <Drawer.Screen
              name="AdminTimetable"
              component={AdminTimetableScreen}
              options={{
                headerTitle: "Manage Timetable",
                headerTransparent: false,
              }}
            />
            <Drawer.Screen
              name="AdminSecurityLog"
              component={AdminSecurityLogScreen}
              options={{
                headerTitle: "Security Log",
                headerTransparent: false,
              }}
            />
            <Drawer.Screen
              name="AdminAuditLog"
              component={AdminAuditLogScreen}
              options={{ headerTitle: "Audit Log", headerTransparent: false }}
            />
            <Drawer.Screen
              name="AdminGDPR"
              component={AdminGDPRScreen}
              options={{
                headerTitle: "GDPR Requests",
                headerTransparent: false,
              }}
            />
            <Drawer.Screen
              name="ScanQR"
              component={ScanQRScreen}
              options={{
                headerTitle: "Scan QR Code",
                headerTransparent: false,
              }}
            />
            <Drawer.Screen
              name="CaseStudyScan"
              component={CaseStudyScanScreen}
              options={{ headerTitle: "Case Study Scanning" }}
            />
            <Drawer.Screen
              name="CaseStudyDetail"
              component={CaseStudyDetailScreen}
              options={{
                headerTitle: "Case Study",
                drawerItemStyle: { display: "none" },
              }}
            />
            <Drawer.Screen
              name="AttendeeSearch"
              component={AttendeeSearchScreen}
              options={{ headerTitle: "Attendee List" }}
            />
            <Drawer.Screen
              name="Stats"
              component={StatsScreen}
              options={{ headerTitle: "Statistics" }}
            />
            <Drawer.Screen
              name="PublishNotification"
              component={PublishNotificationScreen}
              options={{ headerTitle: "Publish Notification" }}
            />
            <Drawer.Screen
              name="Notifications"
              component={NotificationsScreen}
              options={{ headerTitle: "Notifications" }}
            />
            <Drawer.Screen
              name="Profile"
              component={ProfileScreen}
              options={{ headerTitle: "Profile" }}
            />
            <Drawer.Screen
              name="Settings"
              component={SettingsScreen}
              options={{ headerTitle: "Settings" }}
            />
            <Drawer.Screen
              name="HelpSupport"
              component={HelpSupportScreen}
              options={{
                headerTitle: "Help & Support",
                drawerItemStyle: { display: "none" },
              }}
            />
            <Drawer.Screen
              name="About"
              component={AboutScreen}
              options={{ headerTitle: "About" }}
            />
          </>
        ) : isStaff ? (
          <>
            <Drawer.Screen
              name="Dashboard"
              component={StaffDashboardScreen}
              options={{
                headerTitle: () => <HeaderTitle title="Staff Dashboard" />,
              }}
            />
            <Drawer.Screen
              name="ScanQR"
              component={ScanQRScreen}
              options={{
                headerTitle: "Scan QR Code",
                headerTransparent: false,
              }}
            />
            <Drawer.Screen
              name="CaseStudyScan"
              component={CaseStudyScanScreen}
              options={{ headerTitle: "Case Study Scanning" }}
            />
            <Drawer.Screen
              name="CaseStudyDetail"
              component={CaseStudyDetailScreen}
              options={{
                headerTitle: "Case Study",
                drawerItemStyle: { display: "none" },
              }}
            />
            <Drawer.Screen
              name="AttendeeSearch"
              component={AttendeeSearchScreen}
              options={{ headerTitle: "Attendee List" }}
            />
            <Drawer.Screen
              name="StaffSchedule"
              component={StaffScheduleScreen}
              options={{ headerTitle: "Timetable" }}
            />
            <Drawer.Screen
              name="Stats"
              component={StatsScreen}
              options={{ headerTitle: "Statistics" }}
            />
            <Drawer.Screen
              name="Companies"
              component={CompaniesScreen}
              options={{ headerTitle: "Companies" }}
            />
            <Drawer.Screen
              name="CompanyProfile"
              component={CompanyProfileScreen}
              options={{
                headerTitle: "Company",
                drawerItemStyle: { display: "none" },
              }}
            />
            <Drawer.Screen
              name="PublishNotification"
              component={PublishNotificationScreen}
              options={{ headerTitle: "Publish Notification" }}
            />
            <Drawer.Screen
              name="Notifications"
              component={NotificationsScreen}
              options={{ headerTitle: "Notifications" }}
            />
            <Drawer.Screen
              name="Profile"
              component={ProfileScreen}
              options={{ headerTitle: "Profile" }}
            />
            <Drawer.Screen
              name="Settings"
              component={SettingsScreen}
              options={{ headerTitle: "Settings" }}
            />
            <Drawer.Screen
              name="HelpSupport"
              component={HelpSupportScreen}
              options={{
                headerTitle: "Help & Support",
                drawerItemStyle: { display: "none" },
              }}
            />
            <Drawer.Screen
              name="About"
              component={AboutScreen}
              options={{ headerTitle: "About" }}
            />
          </>
        ) : (
          <>
            <Drawer.Screen
              name="Home"
              component={AttendeeHomeScreen}
              options={{
                headerTitle: () => <AttendeeHeaderTitle />,
              }}
            />
            <Drawer.Screen
              name="Agenda"
              component={AgendaScreen}
              options={{ headerTitle: "My Case Studies" }}
            />
            <Drawer.Screen
              name="Speakers"
              component={SpeakersScreen}
              options={{ headerTitle: "Speakers" }}
            />
            <Drawer.Screen
              name="Companies"
              component={CompaniesScreen}
              options={{ headerTitle: "Companies" }}
            />
            <Drawer.Screen
              name="CompanyProfile"
              component={CompanyProfileScreen}
              options={{
                headerTitle: "Company",
                drawerItemStyle: { display: "none" },
              }}
            />
            <Drawer.Screen
              name="StaffSchedule"
              component={StaffScheduleScreen}
              options={{ headerTitle: "Timetable" }}
            />
            <Drawer.Screen
              name="MyQRCode"
              component={MyQRCodeScreen}
              options={{ headerTitle: "My QR Code" }}
            />
            <Drawer.Screen
              name="Notifications"
              component={NotificationsScreen}
              options={{ headerTitle: "Notifications" }}
            />
            <Drawer.Screen
              name="Profile"
              component={ProfileScreen}
              options={{ headerTitle: "Profile" }}
            />
            <Drawer.Screen
              name="Settings"
              component={SettingsScreen}
              options={{ headerTitle: "Settings" }}
            />
            <Drawer.Screen
              name="HelpSupport"
              component={HelpSupportScreen}
              options={{
                headerTitle: "Help & Support",
                drawerItemStyle: { display: "none" },
              }}
            />
            <Drawer.Screen
              name="About"
              component={AboutScreen}
              options={{ headerTitle: "About" }}
            />
          </>
        )}
      </Drawer.Navigator>

      <Modal visible={showWelcome} transparent animationType="fade">
        <CheckInSuccess
          attendeeName={user?.name ?? ""}
          onDismiss={() => setShowWelcome(false)}
        />
      </Modal>
      {isAttendee ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Show my QR code"
            testID="button-quick-qr"
            onPress={() => setShowQuickQr(true)}
            style={[
              styles.quickQrButton,
              {
                bottom: insets.bottom + Spacing.lg,
                backgroundColor: theme.cardBackground,
                borderColor: theme.border,
              },
            ]}
          >
            <Feather name="grid" size={21} color={AppColors.primary} />
          </Pressable>
          <Modal
            visible={showQuickQr}
            transparent
            animationType="fade"
            onRequestClose={() => setShowQuickQr(false)}
          >
            <View style={styles.quickQrOverlay}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close QR code"
                onPress={() => setShowQuickQr(false)}
                style={StyleSheet.absoluteFill}
              />
              <View
                style={[
                  styles.quickQrCard,
                  {
                    backgroundColor: theme.cardBackground,
                    borderColor: theme.border,
                  },
                ]}
                testID="quick-qr-modal"
              >
                <View style={styles.quickQrHeader}>
                  <View>
                    <ThemedText
                      style={[styles.quickQrTitle, { color: theme.text }]}
                    >
                      My QR Code
                    </ThemedText>
                    <ThemedText
                      style={[
                        styles.quickQrSubtitle,
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
                    onPress={() => setShowQuickQr(false)}
                    style={styles.quickQrClose}
                    testID="button-close-quick-qr"
                  >
                    <Feather name="x" size={22} color={theme.textSecondary} />
                  </Pressable>
                </View>
                <View style={styles.quickQrFrame}>
                  <QRCode
                    value={user?.qrCodeValue || "NO_QR_CODE"}
                    size={220}
                    color="#111827"
                    backgroundColor="#FFFFFF"
                  />
                </View>
                <ThemedText style={[styles.quickQrName, { color: theme.text }]}>
                  {user?.name || "Attendee"}
                </ThemedText>
                <ThemedText
                  style={[styles.quickQrEmail, { color: theme.textSecondary }]}
                >
                  {user?.email}
                </ThemedText>
              </View>
            </View>
          </Modal>
        </>
      ) : null}
      <InAppNotificationPopup
        user={user}
        onOpen={() => navigationRef.navigate("Notifications" as never)}
      />
    </View>
  );
}

export default function DrawerNavigator() {
  return (
    <AdminEventProvider>
      <DrawerNavigatorInner />
    </AdminEventProvider>
  );
}

const styles = StyleSheet.create({
  drawerWrapper: { flex: 1 },
  drawerContent: { paddingBottom: Spacing.lg },

  userCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
    padding: Spacing.lg,
    borderRadius: BorderRadius.xl,
  },
  avatarGradient: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  avatarInitials: { color: "#fff", fontSize: 18, fontWeight: "800" },
  userMeta: { flex: 1 },
  userName: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 1,
    letterSpacing: -0.2,
  },
  userEmail: { fontSize: 12, marginBottom: 6 },
  rolePill: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
  },
  roleText: { fontSize: 11, fontWeight: "700", letterSpacing: 0.3 },

  menuSection: { paddingHorizontal: Spacing.md },

  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginLeft: Spacing.md,
    marginTop: Spacing.lg,
    marginBottom: Spacing.xs,
  },

  drawerItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
    marginBottom: 2,
  },
  drawerItemIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  drawerItemLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: "400",
    letterSpacing: -0.1,
  },

  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
    paddingVertical: 0,
  },
  badgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 20,
    textAlign: "center",
    textAlignVertical: "center",
    includeFontPadding: false,
  },

  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
  },
  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
  },
  logoutIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: `${AppColors.error}0F`,
    alignItems: "center",
    justifyContent: "center",
  },
  logoutText: { fontSize: 15, fontWeight: "600" },

  eventSwitcher: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
  },
  eventSwitcherDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  eventSwitcherLabel: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  eventSwitcherName: { fontSize: 13, fontWeight: "600", marginTop: 1 },

  statusPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
  },
  statusPillText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.3 },

  pickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  pickerSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "90%",
    paddingTop: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  pickerList: {
    flexShrink: 1,
    minHeight: 0,
  },
  pickerHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#ccc",
    alignSelf: "center",
    marginBottom: Spacing.md,
  },
  pickerTitle: { fontSize: 17, fontWeight: "700", marginBottom: Spacing.xs },
  pickerSub: { fontSize: 13, marginBottom: Spacing.lg },
  notificationOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.28)",
    justifyContent: "flex-start",
    paddingHorizontal: Spacing.md,
  },
  notificationPopup: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Shadows.medium,
  },
  notificationPopupIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  notificationPopupBody: { flex: 1 },
  notificationPopupEyebrow: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  notificationPopupTitle: { fontSize: 15, fontWeight: "700", marginBottom: 3 },
  notificationPopupMessage: { fontSize: 13, lineHeight: 18 },
  notificationPopupAction: { fontSize: 12, fontWeight: "700", marginTop: 7 },
  notificationPopupClose: { padding: 2 },
  quickQrButton: {
    position: "absolute",
    right: Spacing.lg,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    zIndex: 50,
    ...Shadows.medium,
    elevation: 10,
  },
  quickQrOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
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
  pickerItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    marginBottom: Spacing.sm,
  },
  pickerItemName: { fontSize: 14, fontWeight: "600" },
  pickerItemYear: { fontSize: 12, marginTop: 2 },
});
