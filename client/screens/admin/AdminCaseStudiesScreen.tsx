import React, {
  useState,
  useMemo,
  useLayoutEffect,
  useEffect,
  useCallback,
} from "react";
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  Modal,
  ScrollView,
  ActivityIndicator,
  Alert,
  TextInput,
  Platform,
} from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import { useAdminEvent } from "@/contexts/AdminEventContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { apiRequest } from "@/lib/query-client";
import { requireAdminEvent } from "@/lib/admin-event-guard";
import { confirmDestructive } from "@/lib/confirm-destructive";
import { AppColors, BorderRadius, Spacing } from "@/constants/theme";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import {
  parseImportArrayBuffer,
  parseImportBase64,
  SUPPORTED_IMPORT_EXTENSIONS,
} from "@/lib/user-import";
import type { CaseStudy } from "@shared/schema";

const ITEM_HEIGHT = 126;

const CS_TYPES = ["Long Case", "Short Case"];

interface CSForm {
  caseId: string;
  company: string;
  title: string;
  type: string;
  duration: string;
  description: string;
  room: string;
  attendeeEmails: string;
}
const DEFAULT_CS: CSForm = {
  caseId: "",
  company: "",
  title: "",
  type: "Long Case",
  duration: "60 min",
  description: "",
  room: "",
  attendeeEmails: "",
};
const EMPTY_CASE_STUDIES: CaseStudy[] = [];

interface Attendee {
  id: string;
  name: string;
  email: string;
  assignedAt: string;
  checkedIn: boolean;
}

interface AttendeeOption {
  id: string;
  name: string;
  email: string;
  photoUrl?: string | null;
}

function getAttendeeInitials(name: string) {
  return (
    name
      .split(" ")
      .slice(0, 2)
      .map((n) => n[0])
      .join("")
      .toUpperCase() || "?"
  );
}

function Field({ label, value, onChange, placeholder, multiline, theme }: any) {
  return (
    <>
      <ThemedText style={[styles.fieldLabel, { color: theme.textSecondary }]}>
        {label}
      </ThemedText>
      <TextInput
        style={[
          styles.input,
          {
            backgroundColor: theme.backgroundSecondary,
            color: theme.text,
            borderColor: theme.border,
            height: multiline ? 80 : undefined,
          },
        ]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        multiline={multiline}
      />
    </>
  );
}

function CSFormModal({
  visible,
  onClose,
  onSave,
  item,
  isSaving,
  theme,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (f: CSForm) => void;
  item: CaseStudy | null;
  isSaving: boolean;
  theme: any;
}) {
  const [form, setForm] = useState<CSForm>(DEFAULT_CS);
  React.useEffect(() => {
    if (visible)
      setForm(
        item
          ? {
              caseId: item.caseId,
              company: item.company,
              title: item.title,
              type: item.type,
              duration: item.duration,
              description: item.description || "",
              room: item.room || "",
              attendeeEmails: "",
            }
          : DEFAULT_CS,
      );
  }, [visible, item]);
  const set = (k: keyof CSForm) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }));
  const pickEmails = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/plain", "text/csv", "*/*"],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0] as any;
      if (!SUPPORTED_IMPORT_EXTENSIONS.test(asset.name || "")) {
        throw new Error(
          "Choose a CSV, TSV, TXT, XLS, XLSX, XLSM, XLSB, or ODS file.",
        );
      }
      const isWorkbook = /\.(xlsx|xls|xlsm|xlsb|ods)$/i.test(asset.name || "");
      if (isWorkbook) {
        const rows =
          Platform.OS === "web" && asset.file?.arrayBuffer
            ? parseImportArrayBuffer(await asset.file.arrayBuffer())
            : parseImportBase64(
                await FileSystem.readAsStringAsync(asset.uri, {
                  encoding: FileSystem.EncodingType.Base64,
                }),
              );
        set("attendeeEmails")(
          rows
            .map((row) => row.email)
            .filter(Boolean)
            .join("\n"),
        );
      } else {
        const text =
          Platform.OS === "web" && asset.file?.text
            ? await asset.file.text()
            : await FileSystem.readAsStringAsync(asset.uri);
        set("attendeeEmails")(text);
      }
    } catch (error: any) {
      Alert.alert(
        "Could not read file",
        error?.message || "Choose a text or CSV file.",
      );
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: theme.cardBackground }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <ThemedText type="h4">
              {item ? "Edit Case Study" : "Add Case Study"}
            </ThemedText>
            <Pressable onPress={onClose} hitSlop={8}>
              <Feather name="x" size={22} color={theme.text} />
            </Pressable>
          </View>
          <ScrollView
            style={styles.sheetBody}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Case ID *"
                  value={form.caseId}
                  onChange={set("caseId")}
                  placeholder="cs-009"
                  theme={theme}
                />
              </View>
              <View style={{ flex: 1, marginLeft: Spacing.md }}>
                <Field
                  label="Duration *"
                  value={form.duration}
                  onChange={set("duration")}
                  placeholder="60 min"
                  theme={theme}
                />
              </View>
            </View>
            <Field
              label="Title *"
              value={form.title}
              onChange={set("title")}
              placeholder="Case study title"
              theme={theme}
            />
            <Field
              label="Company *"
              value={form.company}
              onChange={set("company")}
              placeholder="Sponsoring company"
              theme={theme}
            />
            <Field
              label="Room"
              value={form.room}
              onChange={set("room")}
              placeholder="Room B3"
              theme={theme}
            />
            <Field
              label="Description"
              value={form.description}
              onChange={set("description")}
              placeholder="Brief description…"
              multiline
              theme={theme}
            />
            <View style={styles.emailLabelRow}>
              <ThemedText
                style={[styles.fieldLabel, { color: theme.textSecondary }]}
              >
                Attendee emails (optional)
              </ThemedText>
              <Pressable
                onPress={pickEmails}
                style={[
                  styles.uploadEmailsButton,
                  { backgroundColor: `${AppColors.primary}12` },
                ]}
                testID="button-upload-case-study-emails"
              >
                <Feather name="upload" size={14} color={AppColors.primary} />
                <ThemedText
                  style={{
                    color: AppColors.primary,
                    fontSize: 12,
                    fontWeight: "700",
                  }}
                >
                  Upload
                </ThemedText>
              </Pressable>
            </View>
            <TextInput
              style={[
                styles.input,
                styles.emailInput,
                {
                  backgroundColor: theme.backgroundSecondary,
                  color: theme.text,
                  borderColor: theme.border,
                },
              ]}
              value={form.attendeeEmails}
              onChangeText={set("attendeeEmails")}
              placeholder="Paste one email per line, or upload a CSV/text file"
              placeholderTextColor={theme.textSecondary}
              multiline
              autoCapitalize="none"
              testID="input-case-study-attendee-emails"
            />
            <ThemedText
              style={{
                color: theme.textTertiary,
                fontSize: 11,
                lineHeight: 16,
              }}
            >
              Missing or invalid addresses will be listed after saving. No
              attendee accounts are created from this list.
            </ThemedText>
            <ThemedText
              style={[styles.fieldLabel, { color: theme.textSecondary }]}
            >
              Type
            </ThemedText>
            <View style={styles.typeRow}>
              {CS_TYPES.map((t) => (
                <Pressable
                  key={t}
                  onPress={() => set("type")(t)}
                  style={[
                    styles.typeChip,
                    {
                      backgroundColor:
                        form.type === t
                          ? `${AppColors.primary}20`
                          : theme.backgroundSecondary,
                      borderColor:
                        form.type === t ? AppColors.primary : theme.border,
                    },
                  ]}
                >
                  <ThemedText
                    style={{
                      fontSize: 13,
                      fontWeight: "600",
                      color:
                        form.type === t
                          ? AppColors.primary
                          : theme.textSecondary,
                    }}
                  >
                    {t}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          </ScrollView>
          <View style={styles.footer}>
            <Pressable
              onPress={onClose}
              style={[
                styles.btn,
                { backgroundColor: theme.backgroundSecondary },
              ]}
            >
              <ThemedText style={{ fontWeight: "600" }}>Cancel</ThemedText>
            </Pressable>
            <Pressable
              onPress={() => onSave(form)}
              disabled={isSaving}
              style={[styles.btn, { backgroundColor: AppColors.primary }]}
              testID="button-save-cs"
            >
              {isSaving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <ThemedText style={{ color: "#fff", fontWeight: "700" }}>
                  Save
                </ThemedText>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function AttendeesModal({
  visible,
  onClose,
  cs,
  theme,
  adminEventId,
}: {
  visible: boolean;
  onClose: () => void;
  cs: CaseStudy | null;
  theme: any;
  adminEventId: string | null;
}) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedToAssign, setSelectedToAssign] = useState<string[]>([]);
  const [selectedToRemove, setSelectedToRemove] = useState<string[]>([]);
  const [isBulkSaving, setIsBulkSaving] = useState(false);

  const attendeesKey = cs
    ? `/api/admin/case-studies/${cs.id}/attendees${adminEventId ? `?eventId=${adminEventId}` : ""}`
    : null;
  const {
    data: attendees = [],
    isLoading,
    refetch,
  } = useQuery<Attendee[]>({
    queryKey: attendeesKey ? [attendeesKey] : ["__disabled__"],
    enabled: !!cs && visible,
    refetchOnMount: "always",
  });

  const attendeesListKey = adminEventId
    ? `/api/admin/attendees?eventId=${adminEventId}`
    : null;
  const { data: availableAttendees = [], isLoading: isLoadingAvailable } =
    useQuery<AttendeeOption[]>({
      queryKey: attendeesListKey
        ? [attendeesListKey]
        : ["__disabled_available_attendees__"],
      enabled: !!cs && visible && !!adminEventId,
      refetchOnMount: "always",
    });

  const searchKey =
    searchQuery.length >= 2
      ? `/api/admin/attendees/search?q=${encodeURIComponent(searchQuery)}${adminEventId ? `&eventId=${adminEventId}` : ""}`
      : null;
  const { data: searchResults = [] } = useQuery<AttendeeOption[]>({
    queryKey: searchKey ? [searchKey] : ["__disabled_search__"],
    enabled: searchQuery.length >= 2,
  });

  useEffect(() => {
    if (visible) {
      setSearchQuery("");
      setSelectedToAssign([]);
      setSelectedToRemove([]);
    }
  }, [visible, cs?.id]);

  useEffect(() => {
    if (!visible || Platform.OS !== "web") return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [visible, onClose]);

  const toggleAssignSelection = (userId: string) => {
    setSelectedToAssign((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );
  };

  const toggleRemoveSelection = (userId: string) => {
    setSelectedToRemove((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );
  };

  const handleBulkAssign = async () => {
    if (!cs || selectedToAssign.length === 0) return;
    setIsBulkSaving(true);
    try {
      const response = await apiRequest(
        `/api/admin/case-studies/${cs.id}/bulk-assign${adminEventId ? `?eventId=${adminEventId}` : ""}`,
        {
          method: "POST",
          body: JSON.stringify({ userIds: selectedToAssign }),
        },
      );
      const result = await response.json();
      await refetch();
      if (attendeesKey)
        await qc.invalidateQueries({ queryKey: [attendeesKey] });
      Alert.alert(
        "Assignments updated",
        `${result.created} assigned${result.skipped ? `, ${result.skipped} already assigned` : ""}${result.failed ? `, ${result.failed} failed` : ""}.`,
      );
      setSelectedToAssign([]);
      setSearchQuery("");
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to assign");
    } finally {
      setIsBulkSaving(false);
    }
  };

  const handleBulkRemove = async () => {
    if (!cs || selectedToRemove.length === 0) return;
    setIsBulkSaving(true);
    try {
      const response = await apiRequest(
        `/api/admin/case-studies/${cs.id}/bulk-unassign${adminEventId ? `?eventId=${adminEventId}` : ""}`,
        {
          method: "POST",
          body: JSON.stringify({ userIds: selectedToRemove }),
        },
      );
      const result = await response.json();
      await refetch();
      Alert.alert(
        "Assignments updated",
        `${result.removed} removed${result.skipped ? `, ${result.skipped} skipped` : ""}${result.failed ? `, ${result.failed} failed` : ""}.`,
      );
      setSelectedToRemove([]);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to remove assignments");
    } finally {
      setIsBulkSaving(false);
    }
  };

  const handleUnassign = async (userId: string, userName: string) => {
    if (!cs) return;
    Alert.alert("Remove Attendee", `Remove ${userName} from this case study?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            await apiRequest(
              `/api/admin/case-studies/${cs.id}/assign/${userId}${adminEventId ? `?eventId=${adminEventId}` : ""}`,
              { method: "DELETE" },
            );
            await refetch();
          } catch (e: any) {
            Alert.alert("Error", e.message);
          }
        },
      },
    ]);
  };

  const assignedIds = new Set(attendees.map((a) => a.id));
  const assignCandidates = (
    searchQuery.length >= 2 ? searchResults : availableAttendees
  ).filter((attendee) => !assignedIds.has(attendee.id));

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View
          style={[
            styles.sheet,
            { backgroundColor: theme.cardBackground, maxHeight: "88%" },
          ]}
        >
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1 }}>
              <ThemedText type="h4" numberOfLines={1}>
                {cs?.title || "Attendees"}
              </ThemedText>
              <ThemedText style={{ color: theme.textSecondary, fontSize: 13 }}>
                {attendees.length} assigned
              </ThemedText>
            </View>
            <Pressable onPress={onClose} hitSlop={8}>
              <Feather name="x" size={22} color={theme.text} />
            </Pressable>
          </View>

          <View style={styles.sheetBody}>
            <View
              style={[
                styles.searchBar,
                {
                  backgroundColor: theme.backgroundSecondary,
                  borderColor: theme.border,
                },
              ]}
            >
              <Feather name="user-plus" size={15} color={theme.textSecondary} />
              <TextInput
                style={[{ flex: 1, fontSize: 14, color: theme.text }]}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search attendees to assign…"
                placeholderTextColor={theme.textSecondary}
                testID="input-search-assign"
              />
              {searchQuery.length > 0 ? (
                <Pressable onPress={() => setSearchQuery("")}>
                  <Feather name="x" size={14} color={theme.textSecondary} />
                </Pressable>
              ) : null}
            </View>

            {assignCandidates.length > 0 ? (
              <ScrollView
                style={[
                  styles.searchDropdown,
                  {
                    backgroundColor: theme.cardBackground,
                    borderColor: theme.border,
                  },
                ]}
              >
                {assignCandidates.map((r) => (
                  <Pressable
                    key={r.id}
                    onPress={() => toggleAssignSelection(r.id)}
                    style={[
                      styles.searchResult,
                      { borderBottomColor: theme.border },
                    ]}
                    testID={`button-assign-${r.id}`}
                  >
                    <View style={{ flex: 1 }}>
                      <ThemedText
                        style={{
                          fontSize: 14,
                          fontWeight: "600",
                          color: theme.text,
                        }}
                      >
                        {r.name}
                      </ThemedText>
                      <ThemedText
                        style={{ fontSize: 12, color: theme.textSecondary }}
                      >
                        {r.email}
                      </ThemedText>
                    </View>
                    <Feather
                      name={
                        selectedToAssign.includes(r.id)
                          ? "check-square"
                          : "square"
                      }
                      size={19}
                      color={AppColors.primary}
                    />
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}

            {selectedToAssign.length > 0 ? (
              <Pressable
                onPress={handleBulkAssign}
                disabled={isBulkSaving}
                style={[
                  styles.bulkAction,
                  { backgroundColor: AppColors.primary },
                ]}
                testID="button-bulk-assign"
              >
                {isBulkSaving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Feather name="user-plus" size={16} color="#fff" />
                )}
                <ThemedText style={styles.bulkActionText}>
                  Assign selected ({selectedToAssign.length})
                </ThemedText>
              </Pressable>
            ) : null}
          </View>

          {isLoading || isLoadingAvailable ? (
            <ActivityIndicator
              style={{ marginVertical: 20 }}
              color={AppColors.primary}
            />
          ) : (
            <>
              {selectedToRemove.length > 0 ? (
                <Pressable
                  onPress={handleBulkRemove}
                  disabled={isBulkSaving}
                  style={[
                    styles.bulkRemoveAction,
                    { borderColor: AppColors.error },
                  ]}
                  testID="button-bulk-unassign"
                >
                  {isBulkSaving ? (
                    <ActivityIndicator size="small" color={AppColors.error} />
                  ) : (
                    <Feather
                      name="user-minus"
                      size={16}
                      color={AppColors.error}
                    />
                  )}
                  <ThemedText
                    style={{
                      color: AppColors.error,
                      fontWeight: "700",
                      fontSize: 13,
                    }}
                  >
                    Remove selected ({selectedToRemove.length})
                  </ThemedText>
                </Pressable>
              ) : null}
              <FlatList
                data={attendees}
                keyExtractor={(a) => a.id}
                style={{ flex: 1 }}
                contentContainerStyle={{
                  paddingHorizontal: Spacing.xl,
                  paddingBottom: insets.bottom + Spacing.xl,
                }}
                ListEmptyComponent={
                  <View style={styles.empty}>
                    <View
                      style={[
                        styles.emptyIcon,
                        { backgroundColor: `${AppColors.primary}10` },
                      ]}
                    >
                      <Feather
                        name="users"
                        size={24}
                        color={AppColors.primary}
                      />
                    </View>
                    <ThemedText
                      style={[{ color: theme.textSecondary, fontSize: 14 }]}
                    >
                      No attendees assigned yet
                    </ThemedText>
                  </View>
                }
                renderItem={({ item }) => (
                  <View
                    style={[
                      styles.attendeeRow,
                      { borderBottomColor: theme.border },
                    ]}
                  >
                    <Pressable
                      onPress={() => toggleRemoveSelection(item.id)}
                      hitSlop={8}
                    >
                      <Feather
                        name={
                          selectedToRemove.includes(item.id)
                            ? "check-square"
                            : "square"
                        }
                        size={18}
                        color={
                          selectedToRemove.includes(item.id)
                            ? AppColors.error
                            : theme.textTertiary
                        }
                      />
                    </Pressable>
                    <View
                      style={[
                        styles.attendeeAvatar,
                        {
                          backgroundColor: item.checkedIn
                            ? `${AppColors.success}20`
                            : `${AppColors.primary}12`,
                        },
                      ]}
                    >
                      <ThemedText
                        style={{
                          fontSize: 14,
                          fontWeight: "800",
                          color: item.checkedIn
                            ? AppColors.success
                            : AppColors.primary,
                        }}
                      >
                        {getAttendeeInitials(item.name)}
                      </ThemedText>
                    </View>
                    <View style={{ flex: 1 }}>
                      <ThemedText
                        style={{
                          fontSize: 14,
                          fontWeight: "600",
                          color: theme.text,
                        }}
                      >
                        {item.name}
                      </ThemedText>
                      <ThemedText
                        style={{ fontSize: 12, color: theme.textSecondary }}
                      >
                        {item.email}
                      </ThemedText>
                    </View>
                    {item.checkedIn ? (
                      <View
                        style={[
                          styles.checkedBadge,
                          { backgroundColor: `${AppColors.success}20` },
                        ]}
                      >
                        <Feather
                          name="check"
                          size={12}
                          color={AppColors.success}
                        />
                        <ThemedText
                          style={{
                            fontSize: 11,
                            color: AppColors.success,
                            fontWeight: "600",
                          }}
                        >
                          In
                        </ThemedText>
                      </View>
                    ) : null}
                    <Pressable
                      onPress={() => handleUnassign(item.id, item.name)}
                      style={[
                        styles.removeBtn,
                        { backgroundColor: `${AppColors.error}12` },
                      ]}
                      testID={`button-unassign-${item.id}`}
                    >
                      <Feather
                        name="user-minus"
                        size={15}
                        color={AppColors.error}
                      />
                    </Pressable>
                  </View>
                )}
              />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ─── Draggable Row ─────────────────────────────────────────────────────────────
function DraggableCaseStudyRow({
  item,
  index,
  total,
  activeIndexSV,
  gestureYSV,
  theme,
  setScrollEnabled,
  onEdit,
  onDelete,
  onAttendees,
  onDrop,
}: {
  item: CaseStudy;
  index: number;
  total: number;
  activeIndexSV: SharedValue<number>;
  gestureYSV: SharedValue<number>;
  theme: any;
  setScrollEnabled: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onAttendees: () => void;
  onDrop: (from: number, to: number) => void;
}) {
  const typeColor = item.type === "Long Case" ? "#7C3AED" : AppColors.accent;

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(500)
        .onBegin(() => {
          activeIndexSV.value = index;
          gestureYSV.value = 0;
          runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Medium);
          runOnJS(setScrollEnabled)(false);
        })
        .onUpdate((e) => {
          gestureYSV.value = e.translationY;
        })
        .onEnd(() => {
          const newIdx = Math.max(
            0,
            Math.min(
              total - 1,
              Math.round(index + gestureYSV.value / ITEM_HEIGHT),
            ),
          );
          runOnJS(onDrop)(index, newIdx);
        })
        .onFinalize(() => {
          activeIndexSV.value = -1;
          gestureYSV.value = 0;
          runOnJS(setScrollEnabled)(true);
        }),
    [activeIndexSV, gestureYSV, index, total, onDrop, setScrollEnabled],
  );

  const animStyle = useAnimatedStyle(() => {
    const isActive = activeIndexSV.value === index;
    if (isActive) {
      return {
        transform: [
          { translateY: gestureYSV.value },
          { scale: withSpring(1.03) },
        ],
        zIndex: 999,
        shadowOpacity: 0.18,
      };
    }
    const active = activeIndexSV.value;
    if (active < 0)
      return { transform: [{ translateY: withSpring(0) }], zIndex: 1 };
    const dest = Math.max(
      0,
      Math.min(total - 1, Math.round(active + gestureYSV.value / ITEM_HEIGHT)),
    );
    let shift = 0;
    if (active < dest && index > active && index <= dest) shift = -ITEM_HEIGHT;
    else if (active > dest && index < active && index >= dest)
      shift = ITEM_HEIGHT;
    return { transform: [{ translateY: withSpring(shift) }], zIndex: 1 };
  });

  return (
    <Animated.View style={animStyle}>
      <GestureDetector gesture={pan}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.cardBackground,
              borderColor: theme.border,
            },
          ]}
        >
          <Pressable
            style={styles.cardMain}
            onPress={onAttendees}
            testID={`button-cs-attendees-${item.id}`}
          >
            <View
              style={styles.dragHandle}
              testID={`drag-cs-${item.id}`}
              pointerEvents="none"
            >
              <Feather name="menu" size={18} color={theme.textTertiary} />
            </View>
            <View
              style={[
                styles.csBadge,
                { backgroundColor: `${AppColors.primary}12` },
              ]}
            >
              <ThemedText
                style={[styles.csId, { color: AppColors.primary }]}
                numberOfLines={2}
                ellipsizeMode="tail"
                adjustsFontSizeToFit
                minimumFontScale={0.65}
                accessibilityLabel={`Case ID ${item.caseId}`}
              >
                {item.caseId.toUpperCase()}
              </ThemedText>
            </View>
            <View style={styles.cardInfo}>
              <ThemedText
                style={[styles.cardTitle, { color: theme.text }]}
                numberOfLines={2}
                ellipsizeMode="tail"
              >
                {item.title}
              </ThemedText>
              <ThemedText
                style={[styles.cardSub, { color: theme.textSecondary }]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {item.company}
              </ThemedText>
              <View style={styles.metaRow}>
                <View
                  style={[
                    styles.typeBadge,
                    { backgroundColor: `${typeColor}12` },
                  ]}
                >
                  <ThemedText style={[styles.typeText, { color: typeColor }]}>
                    {item.type}
                  </ThemedText>
                </View>
                {item.room ? (
                  <View style={styles.roomRow}>
                    <Feather
                      name="map-pin"
                      size={11}
                      color={theme.textSecondary}
                    />
                    <ThemedText
                      style={[styles.roomText, { color: theme.textSecondary }]}
                    >
                      {item.room}
                    </ThemedText>
                  </View>
                ) : null}
              </View>
            </View>
            <View
              style={[
                styles.attendeesBtn,
                { backgroundColor: `${AppColors.primary}10` },
              ]}
            >
              <Feather name="users" size={16} color={AppColors.primary} />
            </View>
          </Pressable>
          <View style={[styles.cardActions, { borderTopColor: theme.border }]}>
            <Pressable
              onPress={onEdit}
              style={[
                styles.actionBtn,
                { backgroundColor: `${AppColors.primary}10` },
              ]}
              testID={`button-edit-cs-${item.id}`}
            >
              <Feather name="edit-2" size={14} color={AppColors.primary} />
              <ThemedText
                style={{
                  fontSize: 12,
                  fontWeight: "600",
                  color: AppColors.primary,
                }}
              >
                Edit
              </ThemedText>
            </Pressable>
            <View
              style={[styles.actionDivider, { backgroundColor: theme.border }]}
            />
            <Pressable
              onPress={onDelete}
              style={[
                styles.actionBtn,
                { backgroundColor: `${AppColors.error}10` },
              ]}
              testID={`button-delete-cs-${item.id}`}
            >
              <Feather name="trash-2" size={14} color={AppColors.error} />
              <ThemedText
                style={{
                  fontSize: 12,
                  fontWeight: "600",
                  color: AppColors.error,
                }}
              >
                Delete
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </GestureDetector>
    </Animated.View>
  );
}

export default function AdminCaseStudiesScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const qc = useQueryClient();
  const { adminEventId } = useAdminEvent();

  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<CaseStudy | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedCS, setSelectedCS] = useState<CaseStudy | null>(null);
  const [showAttendees, setShowAttendees] = useState(false);
  const [showClearAll, setShowClearAll] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [localItems, setLocalItems] = useState<CaseStudy[]>([]);
  const [scrollEnabled, setScrollEnabled] = useState(true);

  const activeIndexSV = useSharedValue(-1);
  const gestureYSV = useSharedValue(0);

  const { data: caseStudiesData, isLoading } = useQuery<CaseStudy[]>({
    queryKey: ["/api/admin/case-studies", adminEventId],
    queryFn: async () => {
      const res = await apiRequest(
        `/api/admin/case-studies${adminEventId ? `?eventId=${adminEventId}` : ""}`,
      );
      return res.json();
    },
    enabled: !!adminEventId,
  });
  const caseStudies = caseStudiesData ?? EMPTY_CASE_STUDIES;

  useEffect(() => {
    setLocalItems(caseStudies);
  }, [caseStudies]);

  const filtered = useMemo(() => {
    if (!search.trim()) return localItems;
    const q = search.toLowerCase();
    return localItems.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.company.toLowerCase().includes(q) ||
        c.caseId.toLowerCase().includes(q),
    );
  }, [localItems, search]);

  const isSearching = search.trim().length > 0;

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => {
            if (!requireAdminEvent(adminEventId, "clear case studies")) return;
            setShowClearAll(true);
          }}
          style={{ paddingHorizontal: 16, paddingVertical: 8 }}
          testID="button-clear-all-cs"
        >
          <Feather name="trash-2" size={20} color={AppColors.error} />
        </Pressable>
      ),
    });
  }, [adminEventId, navigation]);

  const invalidate = useCallback(
    () =>
      Promise.all([
        qc.invalidateQueries({
          queryKey: ["/api/admin/case-studies", adminEventId],
        }),
        qc.invalidateQueries({ queryKey: ["/api/admin/stats", adminEventId] }),
      ]),
    [adminEventId, qc],
  );

  const handleClearAll = async () => {
    if (!requireAdminEvent(adminEventId, "clear case studies")) return;
    setIsClearing(true);
    try {
      await apiRequest(
        `/api/admin/case-studies/all${adminEventId ? `?eventId=${adminEventId}` : ""}`,
        { method: "DELETE" },
      );
      await invalidate();
      setShowClearAll(false);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to clear");
    } finally {
      setIsClearing(false);
    }
  };

  const handleDrop = useCallback(
    (fromIdx: number, toIdx: number) => {
      if (fromIdx === toIdx) return;
      if (!requireAdminEvent(adminEventId, "reorder case studies")) return;
      setLocalItems((prev) => {
        const next = [...prev];
        const [moved] = next.splice(fromIdx, 1);
        next.splice(toIdx, 0, moved);
        const ids = next.map((it) => it.id);
        apiRequest(
          `/api/admin/case-studies/reorder${adminEventId ? `?eventId=${adminEventId}` : ""}`,
          {
            method: "PUT",
            body: JSON.stringify({
              items: ids.map((id: string, sortOrder: number) => ({
                id,
                sortOrder,
              })),
            }),
          },
        ).catch((error) => {
          Alert.alert("Order not saved", error?.message || "Please try again.");
          invalidate();
        });
        return next;
      });
    },
    [adminEventId, invalidate],
  );

  const handleSave = async (form: CSForm) => {
    if (
      !requireAdminEvent(
        adminEventId,
        editItem ? "edit this case study" : "add a case study",
      )
    )
      return;
    if (
      !form.caseId ||
      !form.company ||
      !form.title ||
      !form.type ||
      !form.duration
    ) {
      Alert.alert("Error", "Please fill all required fields");
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        ...form,
        eventId: adminEventId,
      };
      let savedCaseStudy: CaseStudy;
      if (editItem) {
        const response = await apiRequest(
          `/api/admin/case-studies/${editItem.id}${adminEventId ? `?eventId=${adminEventId}` : ""}`,
          { method: "PUT", body: JSON.stringify(payload) },
        );
        savedCaseStudy = await response.json();
      } else {
        const response = await apiRequest("/api/admin/case-studies", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        savedCaseStudy = await response.json();
      }
      const emails = form.attendeeEmails
        .split(/[\s,;]+/)
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean);
      if (emails.length > 0) {
        const response = await apiRequest(
          `/api/admin/case-studies/${savedCaseStudy.id}/bulk-assign-emails${adminEventId ? `?eventId=${adminEventId}` : ""}`,
          {
            method: "POST",
            body: JSON.stringify({ emails }),
          },
        );
        const result = await response.json();
        const missing = result.missingEmails?.length
          ? `\n\nNot registered in this event:\n${result.missingEmails.join("\n")}`
          : "";
        const invalid = result.invalidEmails?.length
          ? `\n\nInvalid email addresses:\n${result.invalidEmails.join("\n")}`
          : "";
        Alert.alert(
          result.missing || result.invalid
            ? "Case study saved with warnings"
            : "Case study saved",
          `${result.created} assigned${result.skipped ? `, ${result.skipped} already assigned` : ""}${result.failed ? `, ${result.failed} failed` : ""}.${missing}${invalid}`,
        );
      }
      await invalidate();
      setShowForm(false);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to save");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (cs: CaseStudy) => {
    if (!requireAdminEvent(adminEventId, "delete this case study")) return;
    if (
      !(await confirmDestructive(
        "Delete Case Study",
        `Remove "${cs.title}"? All attendee assignments will be removed.`,
      ))
    )
      return;
    try {
      await apiRequest(
        `/api/admin/case-studies/${cs.id}${adminEventId ? `?eventId=${adminEventId}` : ""}`,
        { method: "DELETE" },
      );
      await invalidate();
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to delete case study");
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <View
        style={{
          paddingHorizontal: Spacing.lg,
          paddingTop: Spacing.md,
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
            placeholder="Search case studies…"
            placeholderTextColor={theme.textSecondary}
            testID="input-search-cs"
          />
          {search.length > 0 ? (
            <Pressable onPress={() => setSearch("")}>
              <Feather name="x" size={16} color={theme.textSecondary} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {isLoading ? (
        <ActivityIndicator
          style={{ marginTop: 40 }}
          color={AppColors.primary}
        />
      ) : isSearching ? (
        <FlatList
          data={filtered}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{
            paddingHorizontal: Spacing.lg,
            paddingBottom: insets.bottom + 100,
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <View
                style={[
                  styles.emptyIcon,
                  { backgroundColor: `${AppColors.primary}10` },
                ]}
              >
                <Feather name="book-open" size={28} color={AppColors.primary} />
              </View>
              <ThemedText
                style={[styles.emptyText, { color: theme.textSecondary }]}
              >
                No case studies found
              </ThemedText>
            </View>
          }
          renderItem={({ item }) => {
            const typeColor =
              item.type === "Long Case" ? "#7C3AED" : AppColors.accent;
            return (
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: theme.cardBackground,
                    borderColor: theme.border,
                    marginBottom: Spacing.sm,
                  },
                ]}
              >
                <Pressable
                  style={styles.cardMain}
                  onPress={() => {
                    setSelectedCS(item);
                    setShowAttendees(true);
                  }}
                  testID={`button-cs-attendees-${item.id}`}
                >
                  <View
                    style={[
                      styles.csBadge,
                      { backgroundColor: `${AppColors.primary}12` },
                    ]}
                  >
                    <ThemedText
                      style={[styles.csId, { color: AppColors.primary }]}
                      numberOfLines={2}
                      ellipsizeMode="tail"
                      adjustsFontSizeToFit
                      minimumFontScale={0.65}
                      accessibilityLabel={`Case ID ${item.caseId}`}
                    >
                      {item.caseId.toUpperCase()}
                    </ThemedText>
                  </View>
                  <View style={styles.cardInfo}>
                    <ThemedText
                      style={[styles.cardTitle, { color: theme.text }]}
                      numberOfLines={2}
                      ellipsizeMode="tail"
                    >
                      {item.title}
                    </ThemedText>
                    <ThemedText
                      style={[styles.cardSub, { color: theme.textSecondary }]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {item.company}
                    </ThemedText>
                    <View style={styles.metaRow}>
                      <View
                        style={[
                          styles.typeBadge,
                          { backgroundColor: `${typeColor}12` },
                        ]}
                      >
                        <ThemedText
                          style={[styles.typeText, { color: typeColor }]}
                        >
                          {item.type}
                        </ThemedText>
                      </View>
                      {item.room ? (
                        <View style={styles.roomRow}>
                          <Feather
                            name="map-pin"
                            size={11}
                            color={theme.textSecondary}
                          />
                          <ThemedText
                            style={[
                              styles.roomText,
                              { color: theme.textSecondary },
                            ]}
                          >
                            {item.room}
                          </ThemedText>
                        </View>
                      ) : null}
                    </View>
                  </View>
                  <View
                    style={[
                      styles.attendeesBtn,
                      { backgroundColor: `${AppColors.primary}10` },
                    ]}
                  >
                    <Feather name="users" size={16} color={AppColors.primary} />
                  </View>
                </Pressable>
                <View
                  style={[styles.cardActions, { borderTopColor: theme.border }]}
                >
                  <Pressable
                    onPress={() => {
                      setEditItem(item);
                      setShowForm(true);
                    }}
                    style={[
                      styles.actionBtn,
                      { backgroundColor: `${AppColors.primary}10` },
                    ]}
                    testID={`button-edit-cs-${item.id}`}
                  >
                    <Feather
                      name="edit-2"
                      size={14}
                      color={AppColors.primary}
                    />
                    <ThemedText
                      style={{
                        fontSize: 12,
                        fontWeight: "600",
                        color: AppColors.primary,
                      }}
                    >
                      Edit
                    </ThemedText>
                  </Pressable>
                  <View
                    style={[
                      styles.actionDivider,
                      { backgroundColor: theme.border },
                    ]}
                  />
                  <Pressable
                    onPress={() => handleDelete(item)}
                    style={[
                      styles.actionBtn,
                      { backgroundColor: `${AppColors.error}10` },
                    ]}
                    testID={`button-delete-cs-${item.id}`}
                  >
                    <Feather name="trash-2" size={14} color={AppColors.error} />
                    <ThemedText
                      style={{
                        fontSize: 12,
                        fontWeight: "600",
                        color: AppColors.error,
                      }}
                    >
                      Delete
                    </ThemedText>
                  </Pressable>
                </View>
              </View>
            );
          }}
        />
      ) : (
        <ScrollView
          scrollEnabled={scrollEnabled}
          contentContainerStyle={{
            paddingHorizontal: Spacing.lg,
            paddingBottom: insets.bottom + 100,
          }}
        >
          {localItems.length === 0 ? (
            <View style={styles.empty}>
              <View
                style={[
                  styles.emptyIcon,
                  { backgroundColor: `${AppColors.primary}10` },
                ]}
              >
                <Feather name="book-open" size={28} color={AppColors.primary} />
              </View>
              <ThemedText
                style={[styles.emptyText, { color: theme.textSecondary }]}
              >
                No case studies yet
              </ThemedText>
            </View>
          ) : (
            localItems.map((item, index) => (
              <DraggableCaseStudyRow
                key={item.id}
                item={item}
                index={index}
                total={localItems.length}
                activeIndexSV={activeIndexSV}
                gestureYSV={gestureYSV}
                theme={theme}
                setScrollEnabled={setScrollEnabled}
                onEdit={() => {
                  setEditItem(item);
                  setShowForm(true);
                }}
                onDelete={() => handleDelete(item)}
                onAttendees={() => {
                  setSelectedCS(item);
                  setShowAttendees(true);
                }}
                onDrop={handleDrop}
              />
            ))
          )}
        </ScrollView>
      )}

      <Pressable
        onPress={() => {
          if (!requireAdminEvent(adminEventId, "add a case study")) return;
          setEditItem(null);
          setShowForm(true);
        }}
        style={[styles.fab, { bottom: insets.bottom + Spacing.xl }]}
        testID="button-add-cs"
      >
        <Feather name="plus" size={24} color="#fff" />
      </Pressable>
      <CSFormModal
        visible={showForm}
        onClose={() => setShowForm(false)}
        onSave={handleSave}
        item={editItem}
        isSaving={isSaving}
        theme={theme}
      />
      <AttendeesModal
        visible={showAttendees}
        onClose={() => setShowAttendees(false)}
        cs={selectedCS}
        theme={theme}
        adminEventId={adminEventId}
      />
      <ConfirmModal
        visible={showClearAll}
        title="Clear All Case Studies"
        message={`This will permanently delete all ${caseStudies.length} case stud${caseStudies.length !== 1 ? "ies" : "y"} and all attendee assignments. This cannot be undone.`}
        confirmLabel="Clear All"
        onConfirm={handleClearAll}
        onCancel={() => setShowClearAll(false)}
        isLoading={isClearing}
      />
    </View>
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
  hint: { fontSize: 12, marginTop: Spacing.sm },
  emailLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: Spacing.sm,
  },
  uploadEmailsButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: BorderRadius.md,
  },
  emailInput: { minHeight: 88, textAlignVertical: "top" },
  card: {
    borderRadius: BorderRadius.xl,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    overflow: "hidden",
  },
  cardMain: { flexDirection: "row", alignItems: "center", padding: Spacing.md },
  dragHandle: {
    width: 32,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.xs,
  },
  csBadge: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.md,
    flexShrink: 0,
  },
  csId: { fontSize: 11, fontWeight: "800", textAlign: "center" },
  cardInfo: { flex: 1, minWidth: 0, flexShrink: 1 },
  cardTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 2,
    minWidth: 0,
    flexShrink: 1,
  },
  cardSub: { fontSize: 12, marginBottom: 5, minWidth: 0, flexShrink: 1 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  typeBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  typeText: { fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  roomRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  roomText: { fontSize: 11 },
  attendeesBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: Spacing.sm,
  },
  cardActions: { flexDirection: "row", borderTopWidth: 1 },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 10,
  },
  actionDivider: { width: 1 },
  empty: { alignItems: "center", paddingTop: 60, gap: Spacing.md },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: { fontSize: 16 },
  fab: {
    position: "absolute",
    right: Spacing.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: AppColors.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    height: "88%",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: "92%",
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#ccc",
    alignSelf: "center",
    marginTop: 12,
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  sheetBody: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.sm },
  footer: {
    flexDirection: "row",
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  btn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  row: { flexDirection: "row" },
  typeRow: { flexDirection: "row", gap: Spacing.sm, marginBottom: Spacing.md },
  typeChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: Spacing.xs,
    marginTop: Spacing.md,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    fontSize: 15,
  },
  searchDropdown: {
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    marginTop: Spacing.xs,
    maxHeight: 200,
  },
  searchResult: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderBottomWidth: 1,
    gap: Spacing.sm,
  },
  attendeeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    gap: Spacing.md,
  },
  attendeeAvatar: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  checkedBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: BorderRadius.xs,
    gap: 3,
  },
  removeBtn: {
    width: 34,
    height: 34,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  bulkAction: {
    marginTop: Spacing.sm,
    paddingVertical: 11,
    borderRadius: BorderRadius.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
  },
  bulkActionText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  bulkRemoveAction: {
    marginHorizontal: Spacing.xl,
    marginBottom: Spacing.sm,
    paddingVertical: 10,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
  },
});
