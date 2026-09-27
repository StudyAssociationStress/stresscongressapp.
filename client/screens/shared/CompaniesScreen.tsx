import React, { useState, useMemo } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  TextInput,
  RefreshControl,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getScreenContentTopPadding } from "@/hooks/useScreenOptions";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useTheme } from "@/hooks/useTheme";
import { ImageLightbox } from "@/components/ImageLightbox";
import { useAuth } from "@/contexts/AuthContext";
import { Spacing, BorderRadius } from "@/constants/theme";
import * as Haptics from "expo-haptics";

interface Company {
  id: string;
  name: string;
  category: string;
  description: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
}

const CAT_COLORS: Record<string, string> = {
  "Main Sponsor": "#D97706",
  "Master Partner": "#7C3AED",
  "Junior Partner": "#0891B2",
  "Port of Twente Partner": "#059669",
  "Other Partner": "#6366F1",
};

const CAT_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  "Main Sponsor": "award",
  "Master Partner": "star",
  "Junior Partner": "users",
  "Port of Twente Partner": "truck",
  "Other Partner": "briefcase",
};

const CAT_ORDER = [
  "Main Sponsor",
  "Master Partner",
  "Junior Partner",
  "Port of Twente Partner",
  "Other Partner",
];

export default function CompaniesScreen() {
  const { theme } = useTheme();
  const navigation = useNavigation<any>();
  const { isAuthenticated } = useAuth();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const {
    data: companies = [],
    isLoading,
    refetch,
    isRefetching,
  } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
    enabled: isAuthenticated,
    staleTime: 0,
  });

  const categories = useMemo(() => {
    const cats = new Set(companies.map((c) => c.category));
    return Array.from(cats).sort((a, b) => {
      const ai = CAT_ORDER.indexOf(a),
        bi = CAT_ORDER.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
  }, [companies]);

  const filteredCompanies = useMemo(() => {
    let result = companies;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.category.toLowerCase().includes(q),
      );
    }
    if (selectedCategory)
      result = result.filter((c) => c.category === selectedCategory);
    return result;
  }, [companies, searchQuery, selectedCategory]);

  const sections = useMemo(() => {
    const groups: Record<string, Company[]> = {};
    filteredCompanies.forEach((c) => {
      if (!groups[c.category]) groups[c.category] = [];
      groups[c.category].push(c);
    });
    return Object.entries(groups)
      .map(([category, items]) => ({ category, items }))
      .sort((a, b) => {
        const ai = CAT_ORDER.indexOf(a.category),
          bi = CAT_ORDER.indexOf(b.category);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      });
  }, [filteredCompanies]);

  const handleCompanyPress = (company: Company) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate("CompanyProfile", { companyId: company.id });
  };

  const handleCategoryPress = (cat: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedCategory((prev) => (prev === cat ? null : cat));
  };

  const renderCompanyCard = (company: Company) => {
    const color = CAT_COLORS[company.category] || theme.primary;
    const icon = CAT_ICONS[company.category] || "briefcase";
    return (
      <Pressable
        key={company.id}
        onPress={() => handleCompanyPress(company)}
        style={({ pressed }) => [
          styles.companyCard,
          {
            backgroundColor: theme.cardBackground,
            borderColor: theme.cardBorder,
            opacity: pressed ? 0.88 : 1,
          },
        ]}
      >
        <View style={[styles.logoWrap, { backgroundColor: `${color}12` }]}>
          {company.logoUrl ? (
            <ImageLightbox
              uri={company.logoUrl}
              style={styles.logoImg}
              resizeMode="contain"
            />
          ) : (
            <Feather name={icon} size={24} color={color} />
          )}
        </View>
        <View style={styles.companyInfo}>
          <View style={styles.nameRow}>
            <ThemedText
              style={[styles.companyName, { color: theme.text }]}
              numberOfLines={1}
            >
              {company.name}
            </ThemedText>
          </View>
          <View style={[styles.catTag, { backgroundColor: `${color}10` }]}>
            <ThemedText style={[styles.catTagText, { color }]}>
              {company.category.split(" / ")[0]}
            </ThemedText>
          </View>
          {company.description ? (
            <ThemedText
              style={[styles.desc, { color: theme.textSecondary }]}
              numberOfLines={2}
            >
              {company.description}
            </ThemedText>
          ) : null}
        </View>
        <Feather
          name="chevron-right"
          size={16}
          color={theme.textTertiary as string}
        />
      </Pressable>
    );
  };

  const renderSection = ({
    item,
  }: {
    item: { category: string; items: Company[] };
  }) => {
    const color = CAT_COLORS[item.category] || theme.primary;
    const icon = CAT_ICONS[item.category] || "briefcase";
    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={[styles.sectionIcon, { backgroundColor: `${color}12` }]}>
            <Feather name={icon} size={16} color={color} />
          </View>
          <ThemedText style={[styles.sectionTitle, { color }]}>
            {item.category}
          </ThemedText>
          <View
            style={[
              styles.countBadge,
              { backgroundColor: theme.backgroundSecondary },
            ]}
          >
            <ThemedText
              style={[styles.countText, { color: theme.textSecondary }]}
            >
              {item.items.length}
            </ThemedText>
          </View>
        </View>
        {item.items.map((c) => renderCompanyCard(c))}
      </View>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <View
        style={[
          styles.searchArea,
          {
            paddingTop: getScreenContentTopPadding(headerHeight, Spacing.md),
          },
        ]}
      >
        <View
          style={[
            styles.searchBox,
            {
              backgroundColor: theme.backgroundSecondary,
              borderColor: theme.border,
            },
          ]}
        >
          <Feather name="search" size={17} color={theme.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            placeholder="Search companies..."
            placeholderTextColor={theme.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 ? (
            <Pressable onPress={() => setSearchQuery("")}>
              <Feather name="x" size={16} color={theme.textSecondary} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {categories.length > 0 ? (
        <View style={styles.filtersWrap}>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={categories}
            keyExtractor={(item) => item}
            contentContainerStyle={styles.filterList}
            renderItem={({ item }) => {
              const active = selectedCategory === item;
              const color = CAT_COLORS[item] || theme.primary;
              return (
                <Pressable
                  onPress={() => handleCategoryPress(item)}
                  style={[
                    styles.filterChip,
                    {
                      backgroundColor: active ? color : `${color}10`,
                      borderColor: active ? color : `${color}30`,
                    },
                  ]}
                >
                  <ThemedText
                    style={[
                      styles.filterChipText,
                      { color: active ? "#fff" : color },
                    ]}
                  >
                    {item.split(" / ")[0]}
                  </ThemedText>
                </Pressable>
              );
            }}
          />
        </View>
      ) : null}

      {isLoading ? (
        <View style={styles.centeredMsg}>
          <ThemedText style={{ color: theme.textSecondary }}>
            Loading...
          </ThemedText>
        </View>
      ) : sections.length === 0 ? (
        <View style={styles.centeredMsg}>
          <Feather name="briefcase" size={44} color={theme.textSecondary} />
          <ThemedText
            style={[styles.emptyText, { color: theme.textSecondary }]}
          >
            No companies found
          </ThemedText>
        </View>
      ) : (
        <FlatList
          data={sections}
          keyExtractor={(item) => item.category}
          renderItem={renderSection}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + Spacing["3xl"] },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={theme.primary}
            />
          }
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchArea: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    height: 48,
    borderRadius: BorderRadius.xl,
    gap: Spacing.sm,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 15 },
  filtersWrap: { marginBottom: Spacing.md },
  filterList: { paddingHorizontal: Spacing.lg, gap: Spacing.sm },
  filterChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  filterChipText: { fontSize: 12, fontWeight: "600" },
  listContent: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.xl,
    paddingTop: Spacing.md,
  },
  section: { gap: Spacing.sm },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: 4,
  },
  sectionIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: -0.1,
  },
  countBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
  },
  countText: { fontSize: 11, fontWeight: "600" },
  companyCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
  },
  logoWrap: {
    width: 52,
    height: 52,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.md,
    overflow: "hidden",
    flexShrink: 0,
  },
  logoImg: { width: 40, height: 40 },
  companyInfo: { flex: 1, gap: 4 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  companyName: {
    fontSize: 15,
    fontWeight: "600",
    flex: 1,
    letterSpacing: -0.1,
  },
  catTag: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  catTagText: { fontSize: 11, fontWeight: "700" },
  desc: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  centeredMsg: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
  },
  emptyText: { fontSize: 15 },
});
