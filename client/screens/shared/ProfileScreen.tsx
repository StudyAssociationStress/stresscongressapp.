import React from "react";
import { StyleSheet, View, ScrollView, Pressable } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { getScreenContentTopPadding } from "@/hooks/useScreenOptions";
import { useNavigation } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { AppColors, BorderRadius, Spacing, Shadows } from "@/constants/theme";
import * as Haptics from "expo-haptics";
import { ImageLightbox } from "@/components/ImageLightbox";

function getInitials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { user, logout } = useAuth();
  const navigation = useNavigation();

  const isAdmin = user?.role === "admin";
  const isStaff = user?.role === "staff";
  const roleColor = isAdmin
    ? "#8B5CF6"
    : isStaff
      ? AppColors.accent
      : AppColors.primary;
  const roleLabel = isAdmin
    ? "Administrator"
    : isStaff
      ? "Staff Member"
      : "Attendee";
  const roleIcon = isAdmin
    ? ("shield" as const)
    : isStaff
      ? ("star" as const)
      : ("user" as const);
  const gradientColors: [string, string] = isAdmin
    ? ["#4C1D95", "#6D28D9"]
    : isStaff
      ? [AppColors.primary, "#1a0a7a"]
      : [AppColors.primary, "#1a0a7a"];

  const initials = user?.name ? getInitials(user.name) : "U";

  const menuSections = [
    {
      title: "Account",
      items: [
        {
          icon: "mail" as const,
          label: user?.email || "",
          sublabel: "Email address",
          onPress: undefined as any,
        },
        {
          icon: roleIcon,
          label: roleLabel,
          sublabel: "Your role",
          onPress: undefined as any,
        },
      ],
    },
    {
      title: "Support",
      items: [
        {
          icon: "help-circle" as const,
          label: "Help & Support",
          sublabel: "Get assistance",
          onPress: () => navigation.navigate("HelpSupport" as never),
        },
        {
          icon: "info" as const,
          label: "About",
          sublabel: "App information",
          onPress: () => navigation.navigate("About" as never),
        },
      ],
    },
  ];

  const handleLogout = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    logout();
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      contentContainerStyle={{
        paddingTop: getScreenContentTopPadding(headerHeight, Spacing.lg),
        paddingBottom: insets.bottom + Spacing["3xl"],
        paddingHorizontal: Spacing.lg,
      }}
      showsVerticalScrollIndicator={false}
    >
      {/* Profile Hero */}
      <LinearGradient
        colors={gradientColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.heroCard}
      >
        <View style={styles.heroBlob} />
        <View style={styles.heroBlob2} />

        <View style={styles.avatarWrap}>
          {user?.photoUrl ? (
            <ImageLightbox
              uri={user.photoUrl}
              style={styles.avatarImage}
              resizeMode="cover"
              shape="circle"
            />
          ) : (
            <ThemedText style={styles.avatarInitials}>{initials}</ThemedText>
          )}
        </View>
        <ThemedText style={styles.heroName}>{user?.name || "User"}</ThemedText>
        <ThemedText style={styles.heroEmail}>{user?.email}</ThemedText>

        <View style={styles.heroBadgeRow}>
          <View
            style={[styles.rolePill, { backgroundColor: `${roleColor}35` }]}
          >
            <ThemedText style={styles.roleText}>{roleLabel}</ThemedText>
          </View>
          {user?.checkedIn ? (
            <View style={styles.checkedPill}>
              <Feather
                name="check-circle"
                size={12}
                color={AppColors.success}
              />
              <ThemedText style={styles.checkedText}>Checked In</ThemedText>
            </View>
          ) : null}
        </View>
      </LinearGradient>

      {/* Info + Navigation Sections */}
      {menuSections.map((section) => (
        <View key={section.title} style={styles.section}>
          <ThemedText
            style={[
              styles.sectionLabel,
              { color: theme.textTertiary as string },
            ]}
          >
            {section.title}
          </ThemedText>
          <View
            style={[
              styles.menuCard,
              {
                backgroundColor: theme.cardBackground,
                borderColor: theme.border,
              },
            ]}
          >
            {section.items.map((item, index) => (
              <React.Fragment key={item.label}>
                <Pressable
                  style={({ pressed }) => [
                    styles.menuRow,
                    { opacity: pressed && item.onPress ? 0.7 : 1 },
                  ]}
                  onPress={item.onPress}
                  disabled={!item.onPress}
                >
                  <View
                    style={[
                      styles.menuIconWrap,
                      { backgroundColor: `${roleColor}12` },
                    ]}
                  >
                    <Feather name={item.icon} size={17} color={roleColor} />
                  </View>
                  <View style={styles.menuTextWrap}>
                    <ThemedText
                      style={[styles.menuLabel, { color: theme.text }]}
                      numberOfLines={1}
                    >
                      {item.label}
                    </ThemedText>
                    <ThemedText
                      style={[
                        styles.menuSublabel,
                        { color: theme.textTertiary as string },
                      ]}
                    >
                      {item.sublabel}
                    </ThemedText>
                  </View>
                  {item.onPress ? (
                    <Feather
                      name="chevron-right"
                      size={16}
                      color={theme.textTertiary as string}
                    />
                  ) : null}
                </Pressable>
                {index < section.items.length - 1 ? (
                  <View
                    style={[styles.divider, { backgroundColor: theme.border }]}
                  />
                ) : null}
              </React.Fragment>
            ))}
          </View>
        </View>
      ))}

      {/* Sign Out */}
      <Pressable
        onPress={handleLogout}
        style={({ pressed }) => [
          styles.logoutBtn,
          {
            backgroundColor: `${AppColors.error}0D`,
            borderColor: `${AppColors.error}20`,
            opacity: pressed ? 0.8 : 1,
          },
        ]}
        testID="button-logout-profile"
      >
        <View
          style={[
            styles.logoutIcon,
            { backgroundColor: `${AppColors.error}14` },
          ]}
        >
          <Feather name="log-out" size={17} color={AppColors.error} />
        </View>
        <ThemedText style={[styles.logoutText, { color: AppColors.error }]}>
          Sign Out
        </ThemedText>
        <Feather
          name="chevron-right"
          size={16}
          color={AppColors.error}
          style={{ opacity: 0.4 }}
        />
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  heroCard: {
    borderRadius: BorderRadius["2xl"],
    padding: Spacing["2xl"],
    alignItems: "center",
    marginBottom: Spacing["2xl"],
    overflow: "hidden",
  },
  heroBlob: {
    position: "absolute",
    top: -40,
    right: -40,
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  heroBlob2: {
    position: "absolute",
    bottom: -50,
    left: -50,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  avatarWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.lg,
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.3)",
  },
  avatarInitials: { color: "#fff", fontSize: 34, fontWeight: "800" },
  avatarImage: { width: 90, height: 90, borderRadius: 45 },
  heroName: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.3,
    marginBottom: 4,
    textAlign: "center",
  },
  heroEmail: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 14,
    marginBottom: Spacing.lg,
    textAlign: "center",
  },
  heroBadgeRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    flexWrap: "wrap",
    justifyContent: "center",
  },
  rolePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
  },
  roleText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  checkedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: `${AppColors.success}22`,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
  },
  checkedText: { color: AppColors.success, fontSize: 12, fontWeight: "700" },

  section: { marginBottom: Spacing.xl },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: Spacing.md,
  },
  menuCard: {
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    overflow: "hidden",
    ...Shadows.card,
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  menuIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  menuTextWrap: { flex: 1 },
  menuLabel: { fontSize: 15, fontWeight: "600", marginBottom: 2 },
  menuSublabel: { fontSize: 12 },
  divider: { height: 1, marginLeft: 68 },

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
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  logoutText: { flex: 1, fontSize: 15, fontWeight: "700" },
});
