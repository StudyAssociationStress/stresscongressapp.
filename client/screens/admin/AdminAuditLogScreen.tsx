import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  Alert,
  Modal,
  Platform,
  TextInput,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useAdminEvent } from "@/contexts/AdminEventContext";
import { AppColors, BorderRadius, Spacing, Shadows } from "@/constants/theme";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

interface AuditEntry {
  id: string;
  adminEmail: string;
  action: string;
  targetId: string | null;
  targetType: string | null;
  metadata: string | null;
  createdAt: string;
}

interface AuditPage {
  entries: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const ACTION_LABELS: Record<
  string,
  { label: string; icon: string; color: string }
> = {
  create_user: { label: "User Created", icon: "user-plus", color: "#059669" },
  update_user: { label: "User Updated", icon: "edit-2", color: "#0369A1" },
  delete_user: { label: "User Deleted", icon: "user-x", color: "#DC2626" },
  delete_all_users: {
    label: "All Users Deleted",
    icon: "trash-2",
    color: "#DC2626",
  },
  assign_case_study: {
    label: "Case Study Assigned",
    icon: "book-open",
    color: "#7C3AED",
  },
  unassign_case_study: {
    label: "Case Study Unassigned",
    icon: "book",
    color: "#D97706",
  },
  publish_notification: {
    label: "Notification Published",
    icon: "send",
    color: "#BE185D",
  },
  create_case_study: {
    label: "Case Study Created",
    icon: "plus-circle",
    color: "#059669",
  },
  delete_case_study: {
    label: "Case Study Deleted",
    icon: "trash-2",
    color: "#DC2626",
  },
  create_speaker: { label: "Speaker Created", icon: "mic", color: "#059669" },
  delete_speaker: {
    label: "Speaker Deleted",
    icon: "trash-2",
    color: "#DC2626",
  },
  create_company: {
    label: "Company Created",
    icon: "briefcase",
    color: "#059669",
  },
  delete_company: {
    label: "Company Deleted",
    icon: "trash-2",
    color: "#DC2626",
  },
  update_event: {
    label: "Event Updated",
    icon: "edit-2",
    color: "#0369A1",
  },
  create_event: {
    label: "Event Created",
    icon: "plus-circle",
    color: "#059669",
  },
};

function getAction(action: string) {
  return (
    ACTION_LABELS[action] ?? {
      label: action.replace(/_/g, " "),
      icon: "activity",
      color: "#6B7280",
    }
  );
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }) +
    " " +
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  );
}

function parseMetadata(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    return Object.entries(obj)
      .map(([k, v]) => `${k}: ${v}`)
      .join(" · ");
  } catch {
    return null;
  }
}

export default function AdminAuditLogScreen() {
  const { theme } = useTheme();
  const { auditEvents } = useAdminEvent();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [auditEventId, setAuditEventId] = useState<string | null>(null);
  const [showEventPicker, setShowEventPicker] = useState(false);
  const [search, setSearch] = useState("");
  const [event, setEvent] = useState("");
  const [action, setAction] = useState("");
  const [outcome, setOutcome] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const selectedAuditEvent = auditEvents.find(
    (candidate) => candidate.id === auditEventId,
  );
  const sortedAuditEvents = useMemo(
    () =>
      [...auditEvents].sort((a, b) => {
        const aCreatedAt = a.createdAt ? Date.parse(a.createdAt) : NaN;
        const bCreatedAt = b.createdAt ? Date.parse(b.createdAt) : NaN;
        if (Number.isFinite(aCreatedAt) && Number.isFinite(bCreatedAt)) {
          return bCreatedAt - aCreatedAt;
        }
        if (Number.isFinite(bCreatedAt)) return 1;
        if (Number.isFinite(aCreatedAt)) return -1;
        return b.year - a.year || a.name.localeCompare(b.name);
      }),
    [auditEvents],
  );

  useEffect(() => {
    if (
      auditEventId &&
      !auditEvents.some((candidate) => candidate.id === auditEventId)
    ) {
      setAuditEventId(null);
    }
  }, [auditEventId, auditEvents]);

  useEffect(
    () => setPage(1),
    [search, event, action, outcome, dateFrom, dateTo, auditEventId],
  );

  const queryUrl = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (auditEventId) params.set("eventId", auditEventId);
    for (const [key, value] of Object.entries({
      search,
      event,
      action,
      outcome,
      dateFrom,
      dateTo,
    })) {
      if (value.trim()) params.set(key, value.trim());
    }
    return `/api/admin/audit-log?${params.toString()}`;
  }, [page, search, event, action, outcome, dateFrom, dateTo, auditEventId]);

  const { data, isLoading } = useQuery<AuditPage>({
    queryKey: [queryUrl, auditEventId],
    queryFn: async () => {
      const res = await apiRequest(queryUrl);
      return res.json();
    },
    enabled: !!auditEventId,
  });
  const entries = data?.entries ?? [];

  const downloadAudit = async () => {
    try {
      if (!auditEventId) {
        Alert.alert(
          "Select an event",
          "Choose an event before exporting its audit history.",
        );
        return;
      }
      const response = await apiRequest(
        `/api/admin/audit-log/export?eventId=${encodeURIComponent(auditEventId)}`,
      );
      if (Platform.OS === "web") {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "audit-log.csv";
        link.click();
        URL.revokeObjectURL(url);
      } else {
        const text = await response.text();
        const target = `${FileSystem.cacheDirectory}audit-log.csv`;
        await FileSystem.writeAsStringAsync(target, text);
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(target, {
            mimeType: "text/csv",
            dialogTitle: "Save audit export",
            UTI: "public.comma-separated-values-text",
          });
        } else {
          Alert.alert(
            "Sharing unavailable",
            "This device cannot open the share sheet. Please try again on iOS or Android.",
          );
        }
      }
    } catch {
      Alert.alert(
        "Download failed",
        "We could not prepare the audit export. Please try again.",
      );
    }
  };

  const renderItem = ({ item }: { item: AuditEntry }) => {
    const actionMeta = getAction(item.action);
    const detail = parseMetadata(item.metadata);
    return (
      <View
        style={[
          styles.row,
          { backgroundColor: theme.cardBackground, borderColor: theme.border },
        ]}
      >
        <View
          style={[
            styles.iconWrap,
            { backgroundColor: `${actionMeta.color}14` },
          ]}
        >
          <Feather
            name={actionMeta.icon as any}
            size={16}
            color={actionMeta.color}
          />
        </View>
        <View style={styles.rowBody}>
          <ThemedText style={[styles.actionLabel, { color: theme.text }]}>
            {actionMeta.label}
          </ThemedText>
          <ThemedText
            style={[styles.adminEmail, { color: theme.textSecondary }]}
          >
            {item.adminEmail}
          </ThemedText>
          {detail ? (
            <ThemedText
              style={[styles.detail, { color: theme.textTertiary as string }]}
              numberOfLines={1}
            >
              {detail}
            </ThemedText>
          ) : null}
        </View>
        <ThemedText
          style={[styles.time, { color: theme.textTertiary as string }]}
        >
          {formatTime(item.createdAt)}
        </ThemedText>
      </View>
    );
  };

  const inputStyle = [
    styles.filterInput,
    {
      color: theme.text,
      backgroundColor: theme.cardBackground,
      borderColor: theme.border,
    },
  ];
  const filterOptions = [
    { label: "Event", value: event, set: setEvent, placeholder: "Target type" },
    {
      label: "Action",
      value: action,
      set: setAction,
      placeholder: "Action (e.g. create_user)",
    },
    {
      label: "Outcome",
      value: outcome,
      set: setOutcome,
      placeholder: "Outcome (e.g. success)",
    },
  ];

  return (
    <ScrollView
      style={{ backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={{
        paddingTop: Spacing.lg,
        paddingBottom: insets.bottom + Spacing["3xl"],
        paddingHorizontal: Spacing.lg,
      }}
      showsVerticalScrollIndicator={false}
    >
      <View>
        <View style={[styles.header, { backgroundColor: AppColors.primary }]}>
          <Feather name="shield" size={18} color="#fff" />
          <ThemedText style={styles.headerTitle}>Admin Audit Log</ThemedText>
          <ThemedText style={styles.headerSub}>
            Search and investigate the complete admin history
          </ThemedText>
          <Pressable style={styles.downloadButton} onPress={downloadAudit}>
            <Feather name="download" size={14} color={AppColors.primary} />
            <ThemedText style={styles.downloadText}>
              Download audit CSV
            </ThemedText>
          </Pressable>
        </View>
        <View
          style={[
            styles.scopeCard,
            {
              backgroundColor: theme.cardBackground,
              borderColor: theme.border,
            },
          ]}
        >
          <ThemedText
            style={[styles.filterLabel, { color: theme.textSecondary }]}
          >
            Audit history for
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose audit history event"
            onPress={() => setShowEventPicker(true)}
            style={[
              styles.scopeButton,
              {
                borderColor: theme.border,
                backgroundColor: theme.backgroundRoot,
              },
            ]}
          >
            <View style={styles.scopeButtonText}>
              <ThemedText style={{ color: theme.text, fontWeight: "700" }}>
                {selectedAuditEvent?.name ?? "Select an event"}
              </ThemedText>
              {selectedAuditEvent ? (
                <ThemedText
                  style={{ color: theme.textSecondary, fontSize: 12 }}
                >
                  {selectedAuditEvent.year}
                  {selectedAuditEvent.deleted ? " · Deleted · Read-only" : ""}
                </ThemedText>
              ) : null}
            </View>
            <Feather
              name="chevron-down"
              size={16}
              color={theme.textSecondary as string}
            />
          </Pressable>
        </View>
        <Modal
          visible={showEventPicker}
          transparent
          animationType="fade"
          onRequestClose={() => setShowEventPicker(false)}
        >
          <View style={styles.pickerOverlay}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close audit event picker"
              onPress={() => setShowEventPicker(false)}
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
              <ThemedText style={[styles.pickerTitle, { color: theme.text }]}>
                Choose audit history event
              </ThemedText>
              <ScrollView
                style={[
                  styles.pickerList,
                  {
                    height: Math.max(180, Math.min(windowHeight * 0.58, 520)),
                  },
                ]}
                nestedScrollEnabled
                showsVerticalScrollIndicator
                testID="audit-event-picker-list"
                contentContainerStyle={styles.pickerListContent}
              >
                {sortedAuditEvents.length > 0 ? (
                  sortedAuditEvents.map((item) => (
                    <Pressable
                      key={item.id}
                      testID={`audit-event-picker-item-${item.id}`}
                      onPress={() => {
                        setAuditEventId(item.id);
                        setShowEventPicker(false);
                      }}
                      style={[
                        styles.pickerItem,
                        {
                          borderColor: theme.border,
                          backgroundColor:
                            item.id === auditEventId
                              ? `${AppColors.primary}10`
                              : "transparent",
                        },
                      ]}
                    >
                      <View style={styles.scopeButtonText}>
                        <ThemedText
                          style={{ color: theme.text, fontWeight: "700" }}
                        >
                          {item.name}
                        </ThemedText>
                        <ThemedText
                          style={{ color: theme.textSecondary, fontSize: 12 }}
                        >
                          {item.year}
                          {item.deleted ? " · Deleted · Read-only" : ""}
                        </ThemedText>
                      </View>
                      {item.id === auditEventId ? (
                        <Feather
                          name="check"
                          size={16}
                          color={AppColors.primary}
                        />
                      ) : null}
                    </Pressable>
                  ))
                ) : (
                  <ThemedText
                    style={{
                      color: theme.textSecondary,
                      padding: Spacing.lg,
                    }}
                  >
                    No events with audit history are available.
                  </ThemedText>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>
        <View style={styles.filters}>
          <ThemedText
            style={[styles.filterLabel, { color: theme.textSecondary }]}
          >
            Search actor, action, target, or event
          </ThemedText>
          <TextInput
            style={inputStyle}
            value={search}
            onChangeText={setSearch}
            placeholder="Search audit history..."
            placeholderTextColor={theme.textTertiary as string}
            autoCapitalize="none"
            clearButtonMode="while-editing"
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            {filterOptions.map((filter) => (
              <View key={filter.label} style={styles.filterGroup}>
                <ThemedText
                  style={[styles.filterLabel, { color: theme.textSecondary }]}
                >
                  {filter.label}
                </ThemedText>
                <TextInput
                  style={[inputStyle, styles.smallInput]}
                  value={filter.value}
                  onChangeText={filter.set}
                  placeholder={filter.placeholder}
                  placeholderTextColor={theme.textTertiary as string}
                  autoCapitalize="none"
                />
              </View>
            ))}
          </ScrollView>
          <View style={styles.dateRow}>
            <View style={styles.dateField}>
              <ThemedText
                style={[styles.filterLabel, { color: theme.textSecondary }]}
              >
                From (YYYY-MM-DD)
              </ThemedText>
              <TextInput
                style={inputStyle}
                value={dateFrom}
                onChangeText={setDateFrom}
                placeholder="2026-01-01"
                placeholderTextColor={theme.textTertiary as string}
              />
            </View>
            <View style={styles.dateField}>
              <ThemedText
                style={[styles.filterLabel, { color: theme.textSecondary }]}
              >
                To (YYYY-MM-DD)
              </ThemedText>
              <TextInput
                style={inputStyle}
                value={dateTo}
                onChangeText={setDateTo}
                placeholder="2026-12-31"
                placeholderTextColor={theme.textTertiary as string}
              />
            </View>
          </View>
          <ThemedText style={[styles.total, { color: theme.textSecondary }]}>
            {isLoading
              ? "Loading audit history…"
              : `${data?.total ?? 0} matching event${data?.total === 1 ? "" : "s"}`}
          </ThemedText>
        </View>
        {data && data.totalPages > 1 ? (
          <View style={styles.pagination}>
            <Pressable
              disabled={page <= 1}
              onPress={() => setPage((current) => current - 1)}
              style={[
                styles.pageButton,
                { borderColor: theme.border, opacity: page <= 1 ? 0.4 : 1 },
              ]}
            >
              <Feather name="chevron-left" size={16} color={theme.text} />
            </Pressable>
            <ThemedText
              style={[styles.pageText, { color: theme.textSecondary }]}
            >
              Page {data.page} of {data.totalPages}
            </ThemedText>
            <Pressable
              disabled={page >= data.totalPages}
              onPress={() => setPage((current) => current + 1)}
              style={[
                styles.pageButton,
                {
                  borderColor: theme.border,
                  opacity: page >= data.totalPages ? 0.4 : 1,
                },
              ]}
            >
              <Feather name="chevron-right" size={16} color={theme.text} />
            </Pressable>
          </View>
        ) : null}
      </View>
      {isLoading ? (
        <ActivityIndicator
          style={{ marginTop: 48 }}
          color={AppColors.primary}
        />
      ) : entries.length > 0 ? (
        entries.map((item, index) => (
          <React.Fragment key={item.id}>
            {index > 0 ? <View style={{ height: Spacing.sm }} /> : null}
            {renderItem({ item })}
          </React.Fragment>
        ))
      ) : (
        <View style={styles.empty}>
          <Feather
            name="activity"
            size={32}
            color={theme.textTertiary as string}
          />
          <ThemedText
            style={[styles.emptyText, { color: theme.textSecondary }]}
          >
            No audit events yet
          </ThemedText>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: {
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    marginBottom: Spacing.xl,
    gap: 6,
  },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "800" },
  headerSub: { color: "rgba(255,255,255,0.65)", fontSize: 13 },
  downloadButton: {
    marginTop: 8,
    backgroundColor: "#fff",
    borderRadius: BorderRadius.lg,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  downloadText: { color: AppColors.primary, fontSize: 12, fontWeight: "700" },
  scopeCard: {
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    gap: 6,
  },
  scopeButton: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  scopeButtonText: { flex: 1, gap: 3 },
  pickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  pickerSheet: {
    maxHeight: "80%",
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    paddingTop: Spacing.xl,
  },
  pickerTitle: {
    fontSize: 17,
    fontWeight: "800",
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  pickerList: {
    flexGrow: 0,
    flexShrink: 1,
    minHeight: 0,
  },
  pickerListContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  pickerItem: {
    minHeight: 56,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    flexDirection: "row",
    alignItems: "center",
  },
  filters: { marginBottom: Spacing.md, gap: 8 },
  filterRow: { gap: Spacing.sm },
  filterGroup: { width: 190, gap: 5 },
  dateRow: { flexDirection: "row", gap: Spacing.sm },
  dateField: { flex: 1, gap: 5 },
  filterLabel: { fontSize: 11, fontWeight: "700" },
  filterInput: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    minHeight: 42,
    paddingHorizontal: Spacing.md,
    fontSize: 13,
  },
  smallInput: { minHeight: 38, paddingHorizontal: Spacing.sm },
  total: { fontSize: 12, marginTop: 4 },
  pagination: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  pageButton: {
    width: 36,
    height: 36,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  pageText: { fontSize: 12, fontWeight: "700" },

  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    padding: Spacing.md,
    gap: Spacing.md,
    ...Shadows.card,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  rowBody: { flex: 1, gap: 2 },
  actionLabel: { fontSize: 14, fontWeight: "700" },
  adminEmail: { fontSize: 12 },
  detail: { fontSize: 11, marginTop: 2 },
  time: { fontSize: 11, flexShrink: 0, marginTop: 2 },

  empty: { alignItems: "center", paddingTop: 64, gap: 12 },
  emptyText: { fontSize: 15 },
});
