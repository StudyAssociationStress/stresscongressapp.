import React from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  Linking,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { getScreenContentTopPadding } from "@/hooks/useScreenOptions";
import { useQuery } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { AppColors, BorderRadius, Spacing, Shadows } from "@/constants/theme";

const APP_SUPPORT_EMAIL = "stresscongressapp@gmail.com";
const CONGRESS_SUPPORT_EMAIL = "secretary@stress.utwente.nl";

interface SupportContact {
  id: string;
  type: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  description: string | null;
  websiteUrl: string | null;
  sortOrder: number;
}

function ContactCard({
  contact,
  theme,
}: {
  contact: SupportContact;
  theme: any;
}) {
  const hasInfo =
    contact.name ||
    contact.email ||
    contact.phone ||
    contact.description ||
    contact.websiteUrl;

  return (
    <View
      style={[
        styles.contactCard,
        { backgroundColor: theme.cardBackground },
        Shadows.small,
      ]}
    >
      {hasInfo ? (
        <>
          {contact.name ? (
            <ThemedText style={styles.contactName}>{contact.name}</ThemedText>
          ) : null}
          {contact.description ? (
            <ThemedText
              style={[
                styles.contactDescription,
                { color: theme.textSecondary },
              ]}
            >
              {contact.description}
            </ThemedText>
          ) : null}
          {contact.email ? (
            <Pressable
              style={({ pressed }) => [
                styles.contactRow,
                { opacity: pressed ? 0.7 : 1 },
              ]}
              onPress={() => Linking.openURL(`mailto:${contact.email}`)}
            >
              <View
                style={[
                  styles.contactIconWrap,
                  { backgroundColor: `${AppColors.accent}12` },
                ]}
              >
                <Feather name="mail" size={16} color={AppColors.accent} />
              </View>
              <ThemedText
                style={[styles.contactValue, { color: AppColors.accent }]}
              >
                {contact.email}
              </ThemedText>
              <Feather
                name="external-link"
                size={14}
                color={theme.textSecondary}
              />
            </Pressable>
          ) : null}
          {contact.phone ? (
            <Pressable
              style={({ pressed }) => [
                styles.contactRow,
                { opacity: pressed ? 0.7 : 1 },
              ]}
              onPress={() => Linking.openURL(`tel:${contact.phone}`)}
            >
              <View
                style={[
                  styles.contactIconWrap,
                  { backgroundColor: `${AppColors.accent}12` },
                ]}
              >
                <Feather name="phone" size={16} color={AppColors.accent} />
              </View>
              <ThemedText
                style={[styles.contactValue, { color: AppColors.accent }]}
              >
                {contact.phone}
              </ThemedText>
              <Feather
                name="external-link"
                size={14}
                color={theme.textSecondary}
              />
            </Pressable>
          ) : null}
          {contact.websiteUrl ? (
            <Pressable
              style={({ pressed }) => [
                styles.contactRow,
                { opacity: pressed ? 0.7 : 1 },
              ]}
              onPress={() => Linking.openURL(contact.websiteUrl!)}
            >
              <View
                style={[
                  styles.contactIconWrap,
                  { backgroundColor: `${AppColors.accent}12` },
                ]}
              >
                <Feather name="globe" size={16} color={AppColors.accent} />
              </View>
              <ThemedText
                style={[styles.contactValue, { color: AppColors.accent }]}
                numberOfLines={1}
              >
                {contact.websiteUrl}
              </ThemedText>
              <Feather
                name="external-link"
                size={14}
                color={theme.textSecondary}
              />
            </Pressable>
          ) : null}
        </>
      ) : (
        <ThemedText style={[styles.emptyText, { color: theme.textSecondary }]}>
          Contact information will be available soon.
        </ThemedText>
      )}
    </View>
  );
}

export default function HelpSupportScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();

  const { data: contacts = [], isLoading } = useQuery<SupportContact[]>({
    queryKey: ["/api/support-contacts"],
  });

  const itContacts = contacts
    .filter((c) => c.type === "it_support")
    .map((contact) => ({ ...contact, email: APP_SUPPORT_EMAIL }));
  const congressContacts = contacts
    .filter((c) => c.type === "congress")
    .map((contact) => ({ ...contact, email: CONGRESS_SUPPORT_EMAIL }));

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      contentContainerStyle={{
        paddingTop: getScreenContentTopPadding(headerHeight, Spacing.xl),
        paddingBottom: insets.bottom + Spacing.xl,
        paddingHorizontal: Spacing.lg,
      }}
    >
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View
            style={[
              styles.sectionIconWrap,
              { backgroundColor: `${AppColors.accent}15` },
            ]}
          >
            <Feather name="phone-call" size={20} color={AppColors.accent} />
          </View>
          <View>
            <ThemedText type="h3" style={styles.sectionTitle}>
              Stress Congress Contact
            </ThemedText>
            <ThemedText
              style={[styles.sectionSubtitle, { color: theme.textSecondary }]}
            >
              Event organization team
            </ThemedText>
          </View>
        </View>
        {isLoading ? (
          <ActivityIndicator
            size="small"
            color={AppColors.accent}
            style={{ paddingVertical: Spacing.xl }}
          />
        ) : congressContacts.length > 0 ? (
          congressContacts.map((contact) => (
            <ContactCard key={contact.id} contact={contact} theme={theme} />
          ))
        ) : (
          <ContactCard
            contact={{
              id: "congress-support",
              type: "congress",
              name: "Stress Congress",
              email: CONGRESS_SUPPORT_EMAIL,
              phone: null,
              description: "Contact the Stress Congress organization team",
              websiteUrl: null,
              sortOrder: 0,
            }}
            theme={theme}
          />
        )}
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View
            style={[
              styles.sectionIconWrap,
              { backgroundColor: `${AppColors.accent}15` },
            ]}
          >
            <Feather name="smartphone" size={20} color={AppColors.accent} />
          </View>
          <View>
            <ThemedText type="h3" style={styles.sectionTitle}>
              IT & App Support
            </ThemedText>
            <ThemedText
              style={[styles.sectionSubtitle, { color: theme.textSecondary }]}
            >
              Technical help with the app
            </ThemedText>
          </View>
        </View>
        {isLoading ? (
          <ActivityIndicator
            size="small"
            color={AppColors.accent}
            style={{ paddingVertical: Spacing.xl }}
          />
        ) : itContacts.length > 0 ? (
          itContacts.map((contact) => (
            <ContactCard key={contact.id} contact={contact} theme={theme} />
          ))
        ) : (
          <ContactCard
            contact={{
              id: "app-support",
              type: "it_support",
              name: "App Support",
              email: APP_SUPPORT_EMAIL,
              phone: null,
              description: "Technical help with the app",
              websiteUrl: null,
              sortOrder: 0,
            }}
            theme={theme}
          />
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  section: {
    marginBottom: Spacing.xl,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  sectionIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  sectionTitle: {
    fontSize: 17,
  },
  sectionSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  contactCard: {
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
  },
  contactName: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: Spacing.xs,
  },
  contactDescription: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  contactIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  contactValue: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
  },
  emptyText: {
    fontSize: 14,
    textAlign: "center",
    paddingVertical: Spacing.lg,
  },
});
