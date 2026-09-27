import React, { useState, useMemo } from "react";
import {
  StyleSheet,
  View,
  FlatList,
  RefreshControl,
  Modal,
  Pressable,
  ScrollView,
  Linking,
  Platform,
  TextInput,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useQuery } from "@tanstack/react-query";
import { getScreenContentTopPadding } from "@/hooks/useScreenOptions";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { EmptyState } from "@/components/EmptyState";
import { CardSkeleton } from "@/components/SkeletonLoader";
import { useTheme } from "@/hooks/useTheme";
import { AppColors, BorderRadius, Spacing } from "@/constants/theme";
import { ImageLightbox } from "@/components/ImageLightbox";

interface Speaker {
  id: string;
  name: string;
  title?: string | null;
  bio?: string | null;
  photoUrl?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedin?: string | null;
}

function getSpeakerInitials(name: string) {
  return (
    name
      .split(" ")
      .slice(0, 2)
      .map((n) => n[0])
      .join("")
      .toUpperCase() || "?"
  );
}

function SpeakerAvatar({
  photoUrl,
  name,
  size,
  style,
}: {
  photoUrl?: string | null;
  name: string;
  size: number;
  style?: any;
}) {
  const radius = size / 2;
  if (photoUrl) {
    return (
      <ImageLightbox
        uri={photoUrl}
        style={[{ width: size, height: size, borderRadius: radius }, style]}
        resizeMode="cover"
        shape="circle"
      />
    );
  }
  return (
    <LinearGradient
      colors={[AppColors.primary, "#1a0080"]}
      style={[
        {
          width: size,
          height: size,
          borderRadius: radius,
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
    >
      <ThemedText
        style={{ color: "#fff", fontSize: size * 0.33, fontWeight: "800" }}
      >
        {getSpeakerInitials(name)}
      </ThemedText>
    </LinearGradient>
  );
}

export default function SpeakersScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const [selectedSpeaker, setSelectedSpeaker] = useState<Speaker | null>(null);
  const [search, setSearch] = useState("");

  const {
    data: speakers = [],
    isLoading,
    refetch,
    isRefetching,
  } = useQuery<Speaker[]>({
    queryKey: ["/api/speakers"],
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return speakers;
    const q = search.toLowerCase();
    return speakers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.title || "").toLowerCase().includes(q) ||
        (s.company || "").toLowerCase().includes(q),
    );
  }, [speakers, search]);

  const renderSpeaker = ({ item }: { item: Speaker }) => (
    <Pressable
      onPress={() => setSelectedSpeaker(item)}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.cardBackground,
          borderColor: theme.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
      testID={`card-speaker-${item.id}`}
    >
      <SpeakerAvatar
        photoUrl={item.photoUrl}
        name={item.name}
        size={52}
        style={{ marginRight: Spacing.md, flexShrink: 0 }}
      />
      <View style={styles.info}>
        <ThemedText
          style={[styles.name, { color: theme.text }]}
          numberOfLines={1}
        >
          {item.name}
        </ThemedText>
        {item.title ? (
          <ThemedText
            style={[styles.title, { color: theme.textSecondary }]}
            numberOfLines={1}
          >
            {item.title}
          </ThemedText>
        ) : null}
        {item.company ? (
          <View style={styles.companyRow}>
            <Feather name="briefcase" size={11} color={AppColors.accent} />
            <ThemedText
              style={[styles.company, { color: AppColors.accent }]}
              numberOfLines={1}
            >
              {item.company}
            </ThemedText>
          </View>
        ) : null}
      </View>
      <View
        style={[
          styles.chevronWrap,
          { backgroundColor: `${AppColors.accent}10` },
        ]}
      >
        <Feather name="chevron-right" size={16} color={AppColors.accent} />
      </View>
    </Pressable>
  );

  const handleContact = (
    type: "email" | "phone" | "linkedin",
    value: string,
  ) => {
    const url =
      type === "email"
        ? `mailto:${value}`
        : type === "phone"
          ? `tel:${value}`
          : value;
    Linking.openURL(url).catch(() => {});
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <View
        style={{
          paddingHorizontal: Spacing.lg,
          paddingTop: getScreenContentTopPadding(headerHeight, Spacing.md),
          paddingBottom: Spacing.sm,
        }}
      >
        <View
          style={[
            styles.searchBar,
            {
              backgroundColor: theme.backgroundSecondary,
              borderColor: theme.border,
            },
          ]}
        >
          <Feather name="search" size={16} color={theme.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            value={search}
            onChangeText={setSearch}
            placeholder="Search speakers..."
            placeholderTextColor={theme.textSecondary}
            testID="input-search-speakers"
          />
          {search.length > 0 ? (
            <Pressable onPress={() => setSearch("")}>
              <Feather name="x" size={16} color={theme.textSecondary} />
            </Pressable>
          ) : null}
        </View>
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderSpeaker}
        ListEmptyComponent={
          isLoading ? (
            <View>
              <CardSkeleton />
              <CardSkeleton />
            </View>
          ) : (
            <EmptyState
              image={require("../../../assets/images/empty-speakers.png")}
              title={search ? "No speakers found" : "Speakers Announced Soon"}
              message={
                search
                  ? "Try a different search term."
                  : "Our amazing lineup of speakers will be revealed shortly!"
              }
            />
          )
        }
        contentContainerStyle={{
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
        visible={!!selectedSpeaker}
        animationType="slide"
        presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}
        onRequestClose={() => setSelectedSpeaker(null)}
      >
        {selectedSpeaker ? (
          <SpeakerSheet
            speaker={selectedSpeaker}
            insets={insets}
            theme={theme}
            onClose={() => setSelectedSpeaker(null)}
            onContact={handleContact}
          />
        ) : null}
      </Modal>
    </View>
  );
}

function SpeakerSheet({
  speaker,
  insets,
  theme,
  onClose,
  onContact,
}: {
  speaker: Speaker;
  insets: any;
  theme: any;
  onClose: () => void;
  onContact: (type: "email" | "phone" | "linkedin", value: string) => void;
}) {
  return (
    <View style={[sheet.container, { backgroundColor: theme.backgroundRoot }]}>
      <View
        style={[
          sheet.header,
          {
            borderBottomColor: theme.border,
            paddingTop:
              Platform.OS === "android" ? insets.top + Spacing.md : Spacing.md,
          },
        ]}
      >
        <ThemedText
          style={[sheet.headerTitle, { color: theme.text }]}
          numberOfLines={1}
        >
          Speaker Profile
        </ThemedText>
        <Pressable
          onPress={onClose}
          style={[
            sheet.closeBtn,
            { backgroundColor: theme.backgroundSecondary },
          ]}
          testID="button-close-speaker"
        >
          <Feather name="x" size={18} color={theme.text} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[
          sheet.content,
          { paddingBottom: insets.bottom + Spacing["3xl"] },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient
          colors={[`${AppColors.primary}10`, `${AppColors.primary}03`]}
          style={sheet.heroSection}
        >
          <View style={sheet.avatarWrap}>
            <SpeakerAvatar
              photoUrl={speaker.photoUrl}
              name={speaker.name}
              size={92}
            />
          </View>
          <ThemedText style={[sheet.heroName, { color: theme.text }]}>
            {speaker.name}
          </ThemedText>
          {speaker.title ? (
            <ThemedText
              style={[sheet.heroTitle, { color: theme.textSecondary }]}
            >
              {speaker.title}
            </ThemedText>
          ) : null}
          {speaker.company ? (
            <View
              style={[
                sheet.companyPill,
                { backgroundColor: `${AppColors.accent}12` },
              ]}
            >
              <Feather name="briefcase" size={13} color={AppColors.accent} />
              <ThemedText
                style={[sheet.companyPillText, { color: AppColors.accent }]}
              >
                {speaker.company}
              </ThemedText>
            </View>
          ) : null}
        </LinearGradient>

        {speaker.bio ? (
          <View
            style={[
              sheet.section,
              {
                backgroundColor: theme.cardBackground,
                borderColor: theme.border,
              },
            ]}
          >
            <ThemedText
              style={[sheet.sectionLabel, { color: theme.textSecondary }]}
            >
              About
            </ThemedText>
            <ThemedText style={[sheet.bioText, { color: theme.text }]}>
              {speaker.bio}
            </ThemedText>
          </View>
        ) : null}

        {speaker.email || speaker.linkedin ? (
          <View
            style={[
              sheet.section,
              {
                backgroundColor: theme.cardBackground,
                borderColor: theme.border,
              },
            ]}
          >
            <ThemedText
              style={[sheet.sectionLabel, { color: theme.textSecondary }]}
            >
              Contact
            </ThemedText>
            {speaker.email ? (
              <ContactRow
                icon="mail"
                label="Email"
                value={speaker.email}
                onPress={() => onContact("email", speaker.email!)}
                theme={theme}
                showDivider={!!speaker.linkedin}
              />
            ) : null}
            {speaker.linkedin ? (
              <ContactRow
                icon="linkedin"
                label="LinkedIn"
                value="View Profile"
                onPress={() => onContact("linkedin", speaker.linkedin!)}
                theme={theme}
                showDivider={false}
              />
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function ContactRow({
  icon,
  label,
  value,
  onPress,
  theme,
  showDivider,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string;
  onPress: () => void;
  theme: any;
  showDivider: boolean;
}) {
  return (
    <>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          sheet.contactRow,
          { opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <View
          style={[
            sheet.contactIcon,
            { backgroundColor: `${AppColors.accent}12` },
          ]}
        >
          <Feather name={icon} size={15} color={AppColors.accent} />
        </View>
        <View style={sheet.contactInfo}>
          <ThemedText
            style={[sheet.contactLabel, { color: theme.textSecondary }]}
          >
            {label}
          </ThemedText>
          <ThemedText
            style={[sheet.contactValue, { color: theme.text }]}
            numberOfLines={1}
          >
            {value}
          </ThemedText>
        </View>
        <Feather name="external-link" size={14} color={theme.textSecondary} />
      </Pressable>
      {showDivider ? (
        <View style={[sheet.divider, { backgroundColor: theme.border }]} />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    gap: Spacing.sm,
  },
  searchInput: { flex: 1, fontSize: 15 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: BorderRadius.xl,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
  },
  info: { flex: 1 },
  name: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 2,
    letterSpacing: -0.1,
  },
  title: { fontSize: 13, marginBottom: 3 },
  companyRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  company: { fontSize: 12, fontWeight: "600" },
  chevronWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: Spacing.sm,
    flexShrink: 0,
  },
});

const sheet = StyleSheet.create({
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
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    gap: Spacing.xl,
  },
  heroSection: {
    borderRadius: BorderRadius["2xl"],
    padding: Spacing["2xl"],
    alignItems: "center",
  },
  avatarWrap: { marginBottom: Spacing.lg },
  heroName: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.3,
    textAlign: "center",
    marginBottom: 4,
  },
  heroTitle: { fontSize: 14, textAlign: "center", marginBottom: Spacing.md },
  companyPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
  },
  companyPillText: { fontSize: 13, fontWeight: "600" },
  section: {
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    borderWidth: 1,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.9,
    marginBottom: Spacing.md,
  },
  bioText: { fontSize: 14, lineHeight: 22 },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
  },
  contactIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.md,
  },
  contactInfo: { flex: 1 },
  contactLabel: { fontSize: 11, fontWeight: "500", marginBottom: 1 },
  contactValue: { fontSize: 14, fontWeight: "500" },
  divider: { height: 1, marginLeft: 48, marginVertical: 2 },
});
