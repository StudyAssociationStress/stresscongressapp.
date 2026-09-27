import React from "react";
import { View, StyleSheet, ScrollView, Pressable, Linking } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRoute, RouteProp } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getScreenContentTopPadding } from "@/hooks/useScreenOptions";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { Spacing, BorderRadius, Shadows } from "@/constants/theme";
import { ImageLightbox } from "@/components/ImageLightbox";
import * as Haptics from "expo-haptics";

interface Company {
  id: string;
  name: string;
  category: string;
  description: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
}

type CompanyProfileRouteParams = {
  CompanyProfile: {
    companyId: string;
  };
};

const CATEGORY_COLORS: Record<string, string> = {
  "Main Sponsor": "#D97706",
  "Master Partner": "#7C3AED",
  "Junior Partner": "#0891B2",
  "Port of Twente Partner": "#059669",
  "Other Partner": "#6366F1",
};

const CATEGORY_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  "Main Sponsor": "award",
  "Master Partner": "star",
  "Junior Partner": "users",
  "Port of Twente Partner": "truck",
  "Other Partner": "briefcase",
};

export default function CompanyProfileScreen() {
  const { theme } = useTheme();
  const { isAuthenticated } = useAuth();
  const route =
    useRoute<RouteProp<CompanyProfileRouteParams, "CompanyProfile">>();
  const { companyId } = route.params;
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { data: company, isLoading } = useQuery<Company>({
    queryKey: ["/api/companies", companyId],
    enabled: isAuthenticated && !!companyId,
    staleTime: 0,
  });

  const handleWebsite = () => {
    if (company?.websiteUrl) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      Linking.openURL(company.websiteUrl);
    }
  };

  if (isLoading || !company) {
    return (
      <ThemedView style={styles.loadingContainer}>
        <ThemedText>Loading...</ThemedText>
      </ThemedView>
    );
  }

  const categoryColor = CATEGORY_COLORS[company.category] || theme.primary;
  const categoryIcon = CATEGORY_ICONS[company.category] || "briefcase";

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: getScreenContentTopPadding(headerHeight, Spacing.lg),
            paddingBottom: insets.bottom + Spacing.xl,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.heroSection,
            { backgroundColor: `${categoryColor}10` },
          ]}
        >
          <View
            style={[
              styles.logoLarge,
              { backgroundColor: `${categoryColor}20` },
            ]}
          >
            {company.logoUrl ? (
              <ImageLightbox
                uri={company.logoUrl}
                style={styles.logoImage}
                resizeMode="contain"
              />
            ) : (
              <Feather name={categoryIcon} size={48} color={categoryColor} />
            )}
          </View>

          <View style={styles.companyNameContainer}>
            <ThemedText type="h2" style={styles.companyName}>
              {company.name}
            </ThemedText>
          </View>

          <View
            style={[styles.categoryPill, { backgroundColor: categoryColor }]}
          >
            <Feather name={categoryIcon} size={14} color="#FFFFFF" />
            <ThemedText style={styles.categoryPillText}>
              {company.category}
            </ThemedText>
          </View>
        </View>

        {company.description ? (
          <View
            style={[styles.section, { backgroundColor: theme.cardBackground }]}
          >
            <View style={styles.sectionHeader}>
              <Feather name="info" size={20} color={theme.primary} />
              <ThemedText type="h4" style={styles.sectionTitle}>
                About
              </ThemedText>
            </View>
            <ThemedText
              style={[styles.description, { color: theme.textSecondary }]}
            >
              {company.description}
            </ThemedText>
          </View>
        ) : null}

        {company.websiteUrl ? (
          <Pressable
            onPress={handleWebsite}
            style={({ pressed }) => [
              styles.actionButton,
              {
                backgroundColor: categoryColor,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Feather name="globe" size={22} color="#FFFFFF" />
            <ThemedText style={styles.actionButtonText}>
              Visit Website
            </ThemedText>
          </Pressable>
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  heroSection: {
    alignItems: "center",
    padding: Spacing.xl,
    borderRadius: BorderRadius.xl,
    gap: Spacing.md,
  },
  logoLarge: {
    width: 96,
    height: 96,
    borderRadius: BorderRadius.lg,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  logoImage: {
    width: 80,
    height: 80,
  },
  companyNameContainer: {
    alignItems: "center",
    gap: Spacing.sm,
  },
  companyName: {
    textAlign: "center",
  },
  categoryPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    gap: Spacing.xs,
  },
  categoryPillText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
  },
  section: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
    ...Shadows.small,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    fontSize: 16,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
  },
  actionsContainer: {
    gap: Spacing.md,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
    gap: Spacing.sm,
  },
  actionButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
});
