import React, {
  useState,
  useMemo,
  useLayoutEffect,
  useEffect,
  useCallback,
} from "react";
import {
  View,
  Image,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  Modal,
  ScrollView,
  ActivityIndicator,
  Platform,
  Alert,
  KeyboardAvoidingView,
} from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import { useAdminEvent } from "@/contexts/AdminEventContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { apiRequest } from "@/lib/query-client";
import { requireAdminEvent } from "@/lib/admin-event-guard";
import { AppColors, BorderRadius, Spacing, Shadows } from "@/constants/theme";
import { ConfirmModal } from "@/components/ConfirmModal";
import {
  parseImportArrayBuffer,
  parseImportBase64,
  SUPPORTED_IMPORT_EXTENSIONS,
  type ImportRow,
} from "@/lib/user-import";
import type { User } from "@/contexts/AuthContext";
import type { CaseStudy } from "@shared/schema";
const ROLES = ["attendee", "staff", "admin"] as const;
const ROLE_COLORS: Record<string, string> = {
  attendee: "#0369A1",
  staff: "#047857",
  admin: "#7C3AED",
};
const PROTECTED_ADMIN_EMAIL = "stresscongressapp@gmail.com";

interface UserForm {
  name: string;
  email: string;
  role: "attendee" | "staff" | "admin";
}

const DEFAULT_FORM: UserForm = { name: "", email: "", role: "attendee" };

// ─── Helpers ─────────────────────────────────────────────────────────────────
type ImportRowResult = {
  row: number;
  email: string;
  status: "created" | "skipped" | "error";
  message: string;
  eventId?: string | null;
  eventYear?: number | null;
};
type ImportSummary = {
  created: number;
  skipped: number;
  failed: number;
  errors: string[];
  results: ImportRowResult[];
  eventInvitation?: {
    attempted: number;
    sent: number;
    failed: number;
    deferred: number;
    queued?: number;
    queuedCount?: number;
    status?: string;
  };
};

async function parseFile(asset: {
  uri: string;
  name: string;
  file?: { arrayBuffer: () => Promise<ArrayBuffer> };
}): Promise<ImportRow[]> {
  if (!SUPPORTED_IMPORT_EXTENSIONS.test(asset.name)) {
    throw new Error(
      "Unsupported file type. Choose CSV, TSV, XLS, XLSX, XLSM, XLSB, or ODS.",
    );
  }

  if (Platform.OS === "web" && asset.file) {
    const arrayBuffer = await asset.file.arrayBuffer();
    return parseImportArrayBuffer(arrayBuffer);
  }

  const base64 = await FileSystem.readAsStringAsync(asset.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return parseImportBase64(base64);
}

function normalizeRows(rows: ImportRow[]): ImportRow[] {
  return rows.map((row) => ({
    ...row,
    name: row.name.trim(),
    email: row.email.trim().toLowerCase(),
    role: row.role.trim().toLowerCase(),
  }));
}

// ─── Form Modal ───────────────────────────────────────────────────────────────
function FormModal({
  visible,
  onClose,
  onSave,
  editUser,
  isSaving,
  theme,
  adminEventName,
  adminEventYear,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (form: UserForm) => void;
  editUser: User | null;
  isSaving: boolean;
  theme: any;
  adminEventName: string;
  adminEventYear: number | null;
}) {
  const [form, setForm] = useState<UserForm>(DEFAULT_FORM);

  React.useEffect(() => {
    if (visible) {
      setForm(
        editUser
          ? {
              name: editUser.name,
              email: editUser.email,
              role: editUser.role as any,
            }
          : DEFAULT_FORM,
      );
    }
  }, [visible, editUser]);

  const set = (key: keyof UserForm, val: string) =>
    setForm((f) => ({ ...f, [key]: val }));

  const eventLabel = adminEventName
    ? `${adminEventName}${adminEventYear ? ` (${adminEventYear})` : ""}`
    : "No event selected";

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.deleteModalOverlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.formModalKeyboard}
        >
          <View
            style={[
              styles.modalCard,
              styles.formModalCard,
              { backgroundColor: theme.cardBackground },
            ]}
          >
            <View style={styles.modalHeader}>
              <ThemedText type="h4">
                {editUser ? "Edit User" : "Add User"}
              </ThemedText>
              <Pressable onPress={onClose} hitSlop={8}>
                <Feather name="x" size={22} color={theme.text} />
              </Pressable>
            </View>
            <ScrollView
              style={styles.modalBody}
              contentContainerStyle={styles.modalBodyContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Smart year label — only shown when creating a new user */}
              {!editUser && (
                <View
                  style={[
                    styles.eventContextRow,
                    {
                      backgroundColor: `${AppColors.primary}10`,
                      borderColor: `${AppColors.primary}25`,
                    },
                  ]}
                >
                  <Feather
                    name="calendar"
                    size={14}
                    color={AppColors.primary}
                  />
                  <ThemedText
                    style={{
                      fontSize: 13,
                      color: AppColors.primary,
                      fontWeight: "600",
                      flex: 1,
                    }}
                  >
                    Adding to: {eventLabel}
                  </ThemedText>
                  <Feather
                    name="lock"
                    size={12}
                    color={AppColors.primary}
                    style={{ opacity: 0.6 }}
                  />
                </View>
              )}
              <ThemedText
                style={[styles.fieldLabel, { color: theme.textSecondary }]}
              >
                Full Name *
              </ThemedText>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    color: theme.text,
                    borderColor: theme.border,
                  },
                ]}
                value={form.name}
                onChangeText={(v) => set("name", v)}
                placeholder="e.g. Jane Smith"
                placeholderTextColor={theme.textSecondary}
                testID="input-user-name"
              />
              <ThemedText
                style={[styles.fieldLabel, { color: theme.textSecondary }]}
              >
                Email Address *
              </ThemedText>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    color: theme.text,
                    borderColor: theme.border,
                  },
                ]}
                value={form.email}
                onChangeText={(v) => set("email", v)}
                placeholder="email@example.com"
                placeholderTextColor={theme.textSecondary}
                keyboardType="email-address"
                autoCapitalize="none"
                testID="input-user-email"
              />
              <ThemedText
                style={[styles.fieldLabel, { color: theme.textSecondary }]}
              >
                Role
              </ThemedText>
              <View style={styles.roleRow}>
                {ROLES.map((r) => (
                  <Pressable
                    key={r}
                    onPress={() => set("role", r)}
                    style={[
                      styles.roleChip,
                      {
                        backgroundColor:
                          form.role === r
                            ? `${ROLE_COLORS[r]}20`
                            : theme.backgroundSecondary,
                        borderColor:
                          form.role === r ? ROLE_COLORS[r] : theme.border,
                      },
                    ]}
                  >
                    <ThemedText
                      style={{
                        color:
                          form.role === r
                            ? ROLE_COLORS[r]
                            : theme.textSecondary,
                        fontWeight: "600",
                        fontSize: 13,
                      }}
                    >
                      {r.charAt(0).toUpperCase() + r.slice(1)}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
              {/* No password field — users set their own password on first login */}
              {!editUser && (
                <View
                  style={[
                    styles.setupHintRow,
                    { backgroundColor: `${AppColors.success || "#059669"}10` },
                  ]}
                >
                  <Feather name="info" size={14} color="#059669" />
                  <ThemedText
                    style={{
                      fontSize: 12,
                      color: "#059669",
                      flex: 1,
                      lineHeight: 18,
                    }}
                  >
                    The user will be prompted to create their own password on
                    first sign-in.
                  </ThemedText>
                </View>
              )}
            </ScrollView>
            <View style={[styles.modalFooter, styles.formModalFooter]}>
              <Pressable
                onPress={onClose}
                style={[
                  styles.btn,
                  { backgroundColor: theme.backgroundSecondary },
                ]}
              >
                <ThemedText numberOfLines={1} style={styles.buttonLabel}>
                  Cancel
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={() => onSave(form)}
                disabled={isSaving}
                style={[
                  styles.btn,
                  styles.btnPrimary,
                  { backgroundColor: AppColors.primary },
                ]}
                testID="button-save-user"
              >
                {isSaving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <ThemedText
                    numberOfLines={1}
                    style={[
                      styles.buttonLabel,
                      { color: "#fff", fontWeight: "700" },
                    ]}
                  >
                    Save
                  </ThemedText>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── Delete Modal ─────────────────────────────────────────────────────────────
function DeleteModal({
  visible,
  onClose,
  onConfirm,
  userName,
  theme,
}: {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  userName: string;
  theme: any;
}) {
  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View
          style={[
            styles.confirmCard,
            { backgroundColor: theme.cardBackground },
          ]}
        >
          <View
            style={[
              styles.deleteIconWrap,
              { backgroundColor: `${AppColors.error}15` },
            ]}
          >
            <Feather name="trash-2" size={28} color={AppColors.error} />
          </View>
          <ThemedText
            type="h4"
            style={{ textAlign: "center", marginBottom: Spacing.sm }}
          >
            Delete User?
          </ThemedText>
          <ThemedText
            style={[styles.confirmText, { color: theme.textSecondary }]}
          >
            This will permanently delete {userName} and all their data. This
            cannot be undone.
          </ThemedText>
          <View style={styles.modalFooter}>
            <Pressable
              onPress={onClose}
              style={[
                styles.btn,
                { backgroundColor: theme.backgroundSecondary },
              ]}
              testID="button-cancel-delete"
            >
              <ThemedText style={{ fontWeight: "600" }} numberOfLines={1}>
                Cancel
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              style={[styles.btn, styles.btnDanger]}
              testID="button-confirm-delete"
            >
              <ThemedText
                style={{ color: "#fff", fontWeight: "700" }}
                numberOfLines={1}
              >
                Delete
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Import Modal ─────────────────────────────────────────────────────────────
function ImportModal({
  visible,
  onClose,
  theme,
}: {
  visible: boolean;
  onClose: () => void;
  theme: any;
}) {
  const queryClient = useQueryClient();
  const { adminEventId, adminEventName, adminEventYear, allEvents } =
    useAdminEvent();
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [stage, setStage] = useState<"pick" | "preview" | "result">("pick");
  const [result, setResult] = useState<ImportSummary | null>(null);
  const queuedInvitationCount =
    result?.eventInvitation?.queuedCount ??
    result?.eventInvitation?.queued ??
    0;
  const skippedEmailCount = Math.max(
    0,
    (result?.eventInvitation?.attempted ?? 0) - queuedInvitationCount,
  );
  const [loading, setLoading] = useState(false);
  const [parseError, setParseError] = useState("");

  const previewRows = useMemo(
    () =>
      rows.map((row, index) => {
        let issue = "";
        if (!row.name.trim()) issue = "Name is required";
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email.trim()))
          issue = "Valid email is required";
        else if (
          row.role !== "attendee" &&
          row.role !== "staff" &&
          row.role !== "admin"
        )
          issue = "Role must be attendee, staff, or admin";

        const yearText = row.event_year?.trim();
        const matchedEvent = yearText
          ? allEvents.find((event) => event.year === Number(yearText))
          : allEvents.find((event) => event.id === adminEventId);
        if (!issue && yearText && !matchedEvent)
          issue = `No event exists for year ${yearText}`;

        return {
          ...row,
          sourceRow: index + 2,
          issue,
          eventLabel: matchedEvent
            ? `${matchedEvent.name} (${matchedEvent.year})`
            : `${adminEventName || "Selected event"}${adminEventYear ? ` (${adminEventYear})` : ""}`,
        };
      }),
    [rows, allEvents, adminEventId, adminEventName, adminEventYear],
  );
  const invalidPreviewCount = previewRows.filter((row) => row.issue).length;

  React.useEffect(() => {
    if (visible) {
      setRows([]);
      setStage("pick");
      setResult(null);
      setParseError("");
    }
  }, [visible]);

  const handlePickFile = async () => {
    try {
      setParseError("");
      const res = await DocumentPicker.getDocumentAsync({
        type: [
          "text/csv",
          "text/tab-separated-values",
          "text/plain",
          "application/vnd.ms-excel",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.oasis.opendocument.spreadsheet",
          "*/*",
        ],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      const parsed = await parseFile({
        uri: asset.uri,
        name: asset.name ?? "",
        file: (asset as any).file,
      });
      if (parsed.length === 0) {
        setParseError(
          "No valid rows found. Make sure your file has columns: name, email, role",
        );
        return;
      }
      setRows(parsed);
      setStage("preview");
    } catch (e: any) {
      setParseError("Could not read file: " + e.message);
    }
  };

  const handleImport = async () => {
    if (!requireAdminEvent(adminEventId, "import users")) return;
    setLoading(true);
    try {
      const res = await apiRequest("/api/admin/users/import", {
        method: "POST",
        body: JSON.stringify({
          rows: normalizeRows(rows),
          eventId: adminEventId,
        }),
      });
      const data = await res.json();
      setResult(data);
      setStage("result");
      await queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", adminEventId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["/api/admin/stats", adminEventId],
      });
    } catch (e: any) {
      setParseError(e.message || "Import failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View
          style={[styles.modalCard, { backgroundColor: theme.cardBackground }]}
        >
          <View style={styles.modalHeader}>
            <ThemedText type="h4">Import Users</ThemedText>
            <Pressable onPress={onClose} hitSlop={8}>
              <Feather name="x" size={22} color={theme.text} />
            </Pressable>
          </View>

          {stage === "pick" ? (
            <View style={styles.importPickBody}>
              <View
                style={[
                  styles.importIcon,
                  { backgroundColor: `${AppColors.primary}12` },
                ]}
              >
                <Feather name="file-text" size={32} color={AppColors.primary} />
              </View>
              <ThemedText type="h4" style={{ marginBottom: Spacing.sm }}>
                Upload File
              </ThemedText>
              <ThemedText
                style={[styles.importHint, { color: theme.textSecondary }]}
              >
                Supported: CSV, TSV, XLS, XLSX, XLSM, XLSB, ODS{"\n"}
                Required columns:{"\n"}
                <ThemedText style={{ fontWeight: "700", color: theme.text }}>
                  name, email, role
                </ThemedText>
                {"\n\n"}Optional column:{"\n"}
                <ThemedText style={{ fontWeight: "700", color: theme.text }}>
                  event_year
                </ThemedText>{" "}
                (e.g. 2026 — imports into that event){"\n\n"}
                Role options: attendee, staff, admin{"\n"}
                Users will set their own password on first sign-in.
              </ThemedText>
              {parseError ? (
                <View style={styles.errorBox}>
                  <Feather
                    name="alert-circle"
                    size={15}
                    color={AppColors.error}
                  />
                  <ThemedText
                    style={{ color: AppColors.error, fontSize: 13, flex: 1 }}
                  >
                    {parseError}
                  </ThemedText>
                </View>
              ) : null}
              <Pressable
                onPress={handlePickFile}
                style={[styles.pickBtn, { backgroundColor: AppColors.primary }]}
                testID="button-pick-csv"
              >
                <Feather name="upload" size={18} color="#fff" />
                <ThemedText
                  style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}
                >
                  Choose File
                </ThemedText>
              </Pressable>
            </View>
          ) : stage === "preview" ? (
            <>
              <View
                style={[
                  styles.previewHeader,
                  { backgroundColor: `${AppColors.primary}10` },
                ]}
              >
                <Feather
                  name="check-circle"
                  size={16}
                  color={AppColors.primary}
                />
                <ThemedText
                  style={{
                    color: invalidPreviewCount
                      ? AppColors.error
                      : AppColors.primary,
                    fontWeight: "600",
                  }}
                >
                  {rows.length} rows previewed
                  {invalidPreviewCount
                    ? ` · ${invalidPreviewCount} need attention`
                    : ""}
                </ThemedText>
              </View>
              <FlatList
                data={previewRows}
                keyExtractor={(row, index) => `${row.email}-${index}`}
                style={styles.previewList}
                contentContainerStyle={styles.previewListContent}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                renderItem={({ item: row }) => (
                  <View
                    style={[
                      styles.previewRow,
                      { borderBottomColor: theme.border },
                    ]}
                  >
                    <View
                      style={[
                        styles.previewAvatar,
                        {
                          backgroundColor: `${ROLE_COLORS[row.role] || AppColors.primary}20`,
                        },
                      ]}
                    >
                      <ThemedText
                        style={{
                          fontSize: 13,
                          fontWeight: "700",
                          color: ROLE_COLORS[row.role] || AppColors.primary,
                        }}
                      >
                        {row.name?.charAt(0)?.toUpperCase() || "?"}
                      </ThemedText>
                    </View>
                    <View style={{ flex: 1 }}>
                      <ThemedText
                        style={{ fontSize: 14, fontWeight: "600" }}
                        numberOfLines={1}
                      >
                        {row.name || "(no name)"}
                      </ThemedText>
                      <ThemedText
                        style={{ fontSize: 12, color: theme.textSecondary }}
                        numberOfLines={1}
                      >
                        {row.email}
                      </ThemedText>
                      <ThemedText
                        style={{
                          fontSize: 11,
                          color: row.issue
                            ? AppColors.error
                            : theme.textTertiary,
                        }}
                        numberOfLines={1}
                      >
                        {row.issue || row.eventLabel}
                      </ThemedText>
                    </View>
                    <View
                      style={[
                        styles.rolePill,
                        {
                          backgroundColor: `${ROLE_COLORS[row.role] || AppColors.primary}15`,
                        },
                      ]}
                    >
                      <ThemedText
                        style={{
                          fontSize: 11,
                          fontWeight: "700",
                          color: ROLE_COLORS[row.role] || AppColors.primary,
                        }}
                      >
                        {row.role || "attendee"}
                      </ThemedText>
                    </View>
                  </View>
                )}
              />
              <View style={styles.modalFooter}>
                <Pressable
                  onPress={() => setStage("pick")}
                  style={[
                    styles.btn,
                    { backgroundColor: theme.backgroundSecondary },
                  ]}
                >
                  <ThemedText style={{ fontWeight: "600" }}>Back</ThemedText>
                </Pressable>
                <Pressable
                  onPress={handleImport}
                  disabled={loading}
                  style={[styles.btn, { backgroundColor: AppColors.primary }]}
                  testID="button-confirm-import"
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <ThemedText style={{ color: "#fff", fontWeight: "700" }}>
                      Import {rows.length} Rows
                    </ThemedText>
                  )}
                </Pressable>
              </View>
            </>
          ) : (
            <View style={styles.importPickBody}>
              <View style={[styles.importIcon, { backgroundColor: "#D1FAE5" }]}>
                <Feather name="check-circle" size={32} color="#059669" />
              </View>
              <ThemedText
                type="h4"
                style={{ marginBottom: Spacing.sm, textAlign: "center" }}
              >
                Import Complete
              </ThemedText>
              <View style={styles.resultGrid}>
                <View
                  style={[styles.resultBox, { backgroundColor: "#D1FAE5" }]}
                >
                  <ThemedText style={[styles.resultNum, { color: "#059669" }]}>
                    {result?.created}
                  </ThemedText>
                  <ThemedText
                    style={{
                      color: "#059669",
                      fontSize: 12,
                      fontWeight: "600",
                    }}
                  >
                    Created
                  </ThemedText>
                </View>
                <View
                  style={[styles.resultBox, { backgroundColor: "#FEF3C7" }]}
                >
                  <ThemedText style={[styles.resultNum, { color: "#D97706" }]}>
                    {result?.skipped}
                  </ThemedText>
                  <ThemedText
                    style={{
                      color: "#D97706",
                      fontSize: 12,
                      fontWeight: "600",
                    }}
                  >
                    Skipped
                  </ThemedText>
                </View>
                <View
                  style={[styles.resultBox, { backgroundColor: "#FEE2E2" }]}
                >
                  <ThemedText
                    style={[styles.resultNum, { color: AppColors.error }]}
                  >
                    {result?.failed}
                  </ThemedText>
                  <ThemedText
                    style={{
                      color: AppColors.error,
                      fontSize: 12,
                      fontWeight: "600",
                    }}
                  >
                    Failed
                  </ThemedText>
                </View>
              </View>
              {queuedInvitationCount > 0 ? (
                <ThemedText
                  style={{
                    color: "#B45309",
                    fontSize: 13,
                    textAlign: "center",
                    marginBottom: Spacing.sm,
                  }}
                >
                  {queuedInvitationCount} event invitation
                  {queuedInvitationCount === 1 ? "" : "s"} queued for delivery.
                  Queued does not mean sent.
                  {skippedEmailCount > 0
                    ? ` ${skippedEmailCount} test-only address(es) skipped.`
                    : ""}
                </ThemedText>
              ) : result?.eventInvitation?.sent ? (
                <ThemedText
                  style={{
                    color: "#059669",
                    fontSize: 13,
                    textAlign: "center",
                    marginBottom: Spacing.sm,
                  }}
                >
                  {result.eventInvitation.sent} event invitation
                  {result.eventInvitation.sent === 1 ? "" : "s"} sent.
                </ThemedText>
              ) : result?.eventInvitation?.status === "skipped" ? (
                <ThemedText
                  style={{
                    color: theme.textSecondary,
                    fontSize: 13,
                    textAlign: "center",
                    marginBottom: Spacing.sm,
                  }}
                >
                  Test-only addresses were skipped. No invitation was sent.
                </ThemedText>
              ) : result?.eventInvitation?.deferred ? (
                <ThemedText
                  style={{
                    color: "#B45309",
                    fontSize: 13,
                    textAlign: "center",
                    marginBottom: Spacing.sm,
                  }}
                >
                  Attendees added before this event goes live will receive only
                  the event-live announcement, not a separate added email.
                </ThemedText>
              ) : result?.eventInvitation?.failed ? (
                <ThemedText
                  style={{
                    color: AppColors.error,
                    fontSize: 13,
                    textAlign: "center",
                    marginBottom: Spacing.sm,
                  }}
                >
                  Some event invitations could not be sent. Review email
                  delivery settings before asking attendees to sign in.
                </ThemedText>
              ) : null}
              {result?.results?.length ? (
                <FlatList
                  data={result.results}
                  keyExtractor={(row) => `${row.row}-${row.email}`}
                  style={styles.resultList}
                  contentContainerStyle={styles.resultListContent}
                  nestedScrollEnabled
                  renderItem={({ item: row }) => {
                    const color =
                      row.status === "created"
                        ? "#059669"
                        : row.status === "skipped"
                          ? "#D97706"
                          : AppColors.error;
                    return (
                      <View
                        key={`${row.row}-${row.email}`}
                        style={[
                          styles.resultRow,
                          { borderBottomColor: theme.border },
                        ]}
                      >
                        <Feather
                          name={
                            row.status === "created"
                              ? "check-circle"
                              : row.status === "skipped"
                                ? "minus-circle"
                                : "alert-circle"
                          }
                          size={15}
                          color={color}
                        />
                        <View style={{ flex: 1 }}>
                          <ThemedText
                            style={{ fontSize: 12, fontWeight: "600" }}
                            numberOfLines={1}
                          >
                            Row {row.row}: {row.email || "(no email)"}
                          </ThemedText>
                          <ThemedText
                            style={{ fontSize: 11, color }}
                            numberOfLines={2}
                          >
                            {row.message}
                            {row.eventYear ? ` · Event ${row.eventYear}` : ""}
                          </ThemedText>
                        </View>
                      </View>
                    );
                  }}
                />
              ) : null}
              <Pressable
                onPress={onClose}
                style={[
                  styles.pickBtn,
                  { backgroundColor: AppColors.primary, marginTop: Spacing.lg },
                ]}
              >
                <ThemedText style={{ color: "#fff", fontWeight: "700" }}>
                  Done
                </ThemedText>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

// (SetPasswordModal removed — admins no longer set passwords directly.
//  Use the "Send Reset Email" button on each user card instead.)

function UserCaseStudiesModal({
  visible,
  onClose,
  user,
  eventId,
  eventName,
  eventYear,
  theme,
  onUpdated,
}: {
  visible: boolean;
  onClose: () => void;
  user: User | null;
  eventId: string | null;
  eventName: string;
  eventYear: number | null;
  theme: any;
  onUpdated: () => void | Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [options, setOptions] = useState<(CaseStudy & { assigned: boolean })[]>(
    [],
  );
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [optionsError, setOptionsError] = useState("");
  const userId = user?.id;

  const loadOptions = useCallback(async () => {
    if (!userId || !eventId) {
      setOptions([]);
      setOptionsError("Select an event before assigning case studies.");
      return;
    }
    setOptionsError("");
    setLoadingOptions(true);
    try {
      const response = await apiRequest(
        `/api/admin/users/${userId}/case-studies?eventId=${eventId}`,
      );
      const caseStudies = await response.json();
      if (!Array.isArray(caseStudies)) {
        throw new Error("The case study list could not be read.");
      }
      setOptions(caseStudies);
    } catch (error: any) {
      setOptions([]);
      setOptionsError(
        error?.message || "Could not load case studies. Please try again.",
      );
    } finally {
      setLoadingOptions(false);
    }
  }, [eventId, userId]);

  useEffect(() => {
    if (!visible) return;
    loadOptions().catch(() => {
      // loadOptions renders the user-facing error state.
    });
  }, [visible, userId, eventId, loadOptions]);

  useEffect(() => {
    if (!visible) setSelected([]);
  }, [visible]);

  const availableCount = options.filter(
    (caseStudy) => !caseStudy.assigned,
  ).length;
  const assignedCount = options.length - availableCount;

  const toggle = (id: string) => {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  };

  const assign = async () => {
    if (!user || selected.length === 0) return;
    setSaving(true);
    try {
      const response = await apiRequest(
        `/api/admin/users/${user.id}/case-studies/bulk-assign?eventId=${eventId}`,
        { method: "POST", body: JSON.stringify({ caseStudyIds: selected }) },
      );
      const result = await response.json();
      const failed = result.failed ? `, ${result.failed} failed` : "";
      Alert.alert(
        "Case studies updated",
        `${result.created} assigned${result.skipped ? `, ${result.skipped} already assigned` : ""}${failed}.`,
      );
      await onUpdated();
      onClose();
    } catch (error: any) {
      Alert.alert(
        "Could not assign case studies",
        error.message || "Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.assignmentKeyboard}
        >
          <View
            style={[
              styles.modalCard,
              styles.assignmentModalCard,
              { backgroundColor: theme.cardBackground },
            ]}
          >
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <ThemedText type="h4">Assign Case Studies</ThemedText>
                <ThemedText
                  style={{ color: theme.textSecondary, fontSize: 13 }}
                >
                  {user?.name || "Attendee"}
                </ThemedText>
                <ThemedText
                  style={{
                    color: theme.textTertiary,
                    fontSize: 12,
                    marginTop: 2,
                  }}
                  numberOfLines={1}
                >
                  {eventName
                    ? `${eventName}${eventYear ? ` · ${eventYear}` : ""}`
                    : "No event selected"}
                </ThemedText>
              </View>
              <Pressable onPress={onClose} hitSlop={8}>
                <Feather name="x" size={22} color={theme.text} />
              </Pressable>
            </View>
            {!loadingOptions && !optionsError ? (
              <View
                style={[
                  styles.assignmentSummary,
                  {
                    backgroundColor: `${AppColors.primary}0A`,
                    borderColor: `${AppColors.primary}20`,
                  },
                ]}
              >
                <View style={styles.assignmentSummaryItem}>
                  <ThemedText
                    style={[
                      styles.assignmentSummaryNumber,
                      { color: AppColors.primary },
                    ]}
                  >
                    {availableCount}
                  </ThemedText>
                  <ThemedText
                    style={[
                      styles.assignmentSummaryLabel,
                      { color: theme.textSecondary },
                    ]}
                  >
                    Available
                  </ThemedText>
                </View>
                <View
                  style={[
                    styles.assignmentSummaryDivider,
                    { backgroundColor: theme.border },
                  ]}
                />
                <View style={styles.assignmentSummaryItem}>
                  <ThemedText
                    style={[
                      styles.assignmentSummaryNumber,
                      { color: AppColors.success },
                    ]}
                  >
                    {assignedCount}
                  </ThemedText>
                  <ThemedText
                    style={[
                      styles.assignmentSummaryLabel,
                      { color: theme.textSecondary },
                    ]}
                  >
                    Already assigned
                  </ThemedText>
                </View>
              </View>
            ) : null}
            <View style={styles.modalBody}>
              {loadingOptions ? (
                <ActivityIndicator
                  style={{ marginVertical: Spacing.xl }}
                  color={AppColors.primary}
                />
              ) : null}
              {!loadingOptions && optionsError ? (
                <View style={styles.assignmentError}>
                  <ThemedText
                    style={{
                      color: AppColors.error,
                      textAlign: "center",
                    }}
                  >
                    {optionsError}
                  </ThemedText>
                  <Pressable
                    onPress={loadOptions}
                    style={[
                      styles.retryButton,
                      { borderColor: AppColors.primary },
                    ]}
                  >
                    <ThemedText
                      style={{ color: AppColors.primary, fontWeight: "700" }}
                    >
                      Try again
                    </ThemedText>
                  </Pressable>
                </View>
              ) : null}
              {!loadingOptions && !optionsError ? (
                <FlatList
                  data={options}
                  keyExtractor={(caseStudy) => caseStudy.id}
                  style={styles.assignmentList}
                  contentContainerStyle={styles.assignmentListContent}
                  keyboardShouldPersistTaps="handled"
                  nestedScrollEnabled
                  ListHeaderComponent={
                    <View style={styles.assignmentListHeader}>
                      <ThemedText
                        style={{
                          color: theme.text,
                          fontSize: 14,
                          fontWeight: "700",
                        }}
                      >
                        Case studies for this event
                      </ThemedText>
                      <ThemedText
                        style={{
                          color: theme.textSecondary,
                          fontSize: 13,
                          lineHeight: 19,
                          marginTop: 3,
                        }}
                      >
                        Tap an available case study to select it. Existing
                        assignments are marked and cannot be duplicated.
                      </ThemedText>
                    </View>
                  }
                  ListEmptyComponent={
                    <View style={styles.assignmentEmpty}>
                      <Feather
                        name="book-open"
                        size={30}
                        color={theme.textTertiary}
                      />
                      <ThemedText
                        style={{
                          color: theme.text,
                          textAlign: "center",
                          fontWeight: "700",
                        }}
                      >
                        No case studies yet
                      </ThemedText>
                      <ThemedText
                        style={{
                          color: theme.textSecondary,
                          textAlign: "center",
                          fontSize: 13,
                          lineHeight: 19,
                        }}
                      >
                        Create case studies for this event in Manage Case
                        Studies, then return here to assign them.
                      </ThemedText>
                    </View>
                  }
                  renderItem={({ item: caseStudy }) => (
                    <Pressable
                      disabled={caseStudy.assigned}
                      onPress={() => toggle(caseStudy.id)}
                      style={[
                        styles.caseStudyOption,
                        {
                          borderColor: theme.border,
                          backgroundColor: theme.backgroundSecondary,
                        },
                        caseStudy.assigned ? { opacity: 0.6 } : null,
                      ]}
                      testID={`button-user-case-study-${caseStudy.id}`}
                    >
                      <View style={{ flex: 1 }}>
                        <ThemedText style={{ fontWeight: "700" }}>
                          {caseStudy.title}
                        </ThemedText>
                        <ThemedText
                          style={{
                            color: theme.textSecondary,
                            fontSize: 12,
                          }}
                        >
                          {caseStudy.caseId} · {caseStudy.company}
                        </ThemedText>
                      </View>
                      {caseStudy.assigned ? (
                        <ThemedText
                          style={{
                            color: AppColors.success,
                            fontSize: 12,
                            fontWeight: "700",
                          }}
                        >
                          Assigned
                        </ThemedText>
                      ) : (
                        <Feather
                          name={
                            selected.includes(caseStudy.id)
                              ? "check-square"
                              : "square"
                          }
                          size={20}
                          color={AppColors.primary}
                        />
                      )}
                    </Pressable>
                  )}
                />
              ) : null}
            </View>
            <View
              style={[
                styles.modalFooter,
                {
                  paddingBottom: Math.max(
                    Spacing.xl,
                    insets.bottom + Spacing.md,
                  ),
                },
              ]}
            >
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
                onPress={assign}
                disabled={saving || selected.length === 0}
                style={[
                  styles.btn,
                  {
                    backgroundColor: selected.length
                      ? AppColors.primary
                      : theme.border,
                  },
                ]}
                testID="button-assign-user-case-studies"
              >
                {saving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <ThemedText style={{ color: "#fff", fontWeight: "700" }}>
                    Assign {selected.length || ""}
                  </ThemedText>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
type AdminUser = User & {
  eventInvitationSentAt?: string | null;
  eventInvitationStatus?: string | null;
};

export default function AdminUsersScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { adminEventId, adminEventName, adminEventYear } = useAdminEvent();

  const navigation = useNavigation();

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<
    "all" | "attendee" | "staff" | "admin"
  >("all");
  const [showForm, setShowForm] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [deleteUser, setDeleteUser] = useState<User | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showClearAll, setShowClearAll] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [exportingUserId, setExportingUserId] = useState<string | null>(null);
  const [emailingExportUserId, setEmailingExportUserId] = useState<
    string | null
  >(null);
  const [queueingInvitationId, setQueueingInvitationId] = useState<
    string | null
  >(null);
  const [uncertainRetryUser, setUncertainRetryUser] =
    useState<AdminUser | null>(null);
  const [assignmentUser, setAssignmentUser] = useState<User | null>(null);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);

  const { data: users = [], isLoading } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users", adminEventId],
    queryFn: async () => {
      const res = await apiRequest(
        `/api/admin/users${adminEventId ? `?eventId=${adminEventId}` : ""}`,
      );
      return res.json();
    },
    enabled: !!adminEventId,
  });

  const refreshAssignmentViews = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", adminEventId],
      }),
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return (
            typeof key === "string" &&
            (key.startsWith("/api/admin/case-studies") ||
              key.startsWith("/api/admin/attendees/search"))
          );
        },
      }),
    ]);
  };

  const filtered = useMemo(() => {
    let list = users;
    if (roleFilter !== "all") list = list.filter((u) => u.role === roleFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (u) =>
          u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
      );
    }
    return list;
  }, [users, search, roleFilter]);

  const handleSave = async (form: UserForm) => {
    if (!form.name.trim() || !form.email.trim()) {
      Alert.alert("Missing information", "Name and email are required.");
      return;
    }
    if (
      !requireAdminEvent(
        adminEventId,
        editUser ? "edit this user" : "add a user",
      )
    )
      return;
    setIsSaving(true);
    try {
      if (editUser) {
        await apiRequest(
          `/api/admin/users/${editUser.id}${adminEventId ? `?eventId=${adminEventId}` : ""}`,
          { method: "PUT", body: JSON.stringify(form) },
        );
      } else {
        const response = await apiRequest("/api/admin/users", {
          method: "POST",
          body: JSON.stringify({ ...form, eventId: adminEventId }),
        });
        const result = (await response.json()) as {
          eventInvitationSent?: boolean;
          eventInvitationDeferred?: boolean;
          eventInvitationStatus?:
            | "sent"
            | "queued"
            | "deferred"
            | "failed"
            | "skipped"
            | "not_applicable";
        };
        if (result.eventInvitationStatus === "queued") {
          Alert.alert(
            "Account created",
            "The event invitation is queued. It has not been sent yet.",
          );
        } else if (result.eventInvitationStatus === "sent") {
          Alert.alert(
            "Account created",
            "An event invitation was sent to the attendee.",
          );
        } else if (result.eventInvitationStatus === "deferred") {
          Alert.alert(
            "Account created",
            "No “you’ve been added” email is sent before launch. The attendee will receive the event-live announcement when this event is published.",
          );
        } else if (result.eventInvitationStatus === "failed") {
          Alert.alert(
            "Account created",
            "The attendee was created, but the event invitation could not be sent.",
          );
        } else if (result.eventInvitationStatus === "skipped") {
          Alert.alert(
            "Account created",
            "This is a test-only address. No invitation was queued or sent.",
          );
        } else if (result.eventInvitationDeferred) {
          Alert.alert(
            "Account created",
            "No “you’ve been added” email is sent before launch. The attendee will receive the event-live announcement when this event is published.",
          );
        }
      }
      await queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", adminEventId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["/api/admin/stats", adminEventId],
      });
      setShowForm(false);
    } catch (e: any) {
      Alert.alert(
        e?.status === 409 ? "User already exists" : "Error",
        e.message || "Could not save user",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleQueueInvitation = async (user: AdminUser) => {
    if (!requireAdminEvent(adminEventId, "send an event invitation")) return;
    setQueueingInvitationId(user.id);
    try {
      await apiRequest(
        `/api/admin/events/${encodeURIComponent(adminEventId!)}/attendees/${encodeURIComponent(user.id)}/retry-invitation?eventId=${encodeURIComponent(adminEventId!)}`,
        { method: "POST" },
      );
      Alert.alert(
        "Invitation queued",
        "The invitation will be sent when email delivery is available. Queued does not mean sent.",
      );
      await queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", adminEventId],
      });
    } catch (error: any) {
      Alert.alert(
        "Invitation not queued",
        error?.message || "Could not queue the invitation.",
      );
    } finally {
      setQueueingInvitationId(null);
    }
  };

  const handleDelete = async () => {
    if (!requireAdminEvent(adminEventId, "delete this user")) return;
    if (!deleteUser) return;
    try {
      await apiRequest(
        `/api/admin/users/${deleteUser.id}${adminEventId ? `?eventId=${adminEventId}` : ""}`,
        { method: "DELETE" },
      );
      await queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", adminEventId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["/api/admin/stats", adminEventId],
      });
      setDeleteUser(null);
    } catch (e: any) {
      Alert.alert(
        "Could not delete user",
        e?.message || "The user could not be deleted. Please try again.",
      );
    }
  };

  const handleExport = async (user: User) => {
    if (!requireAdminEvent(adminEventId, "export this user’s data")) return;
    setExportingUserId(user.id);
    try {
      const res = await apiRequest(
        `/api/admin/users/${user.id}/export${adminEventId ? `?eventId=${adminEventId}` : ""}`,
      );
      const json = await res.json();
      const filename = `user-export-${user.email.replace(/[^a-z0-9]/gi, "_")}.json`;
      const jsonStr = JSON.stringify(json, null, 2);

      if (Platform.OS === "web") {
        // Web: create a temporary anchor and trigger a file download
        const blob = new Blob([jsonStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        // iOS / Android: write to cache then share
        const path = `${FileSystem.cacheDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(path, jsonStr, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(path, {
            mimeType: "application/json",
            dialogTitle: `Export: ${user.name}`,
          });
        } else {
          Alert.alert("Export saved", `Data written to:\n${path}`);
        }
      }
    } catch (e: any) {
      Alert.alert("Export failed", e.message || "Could not export user data");
    } finally {
      setExportingUserId(null);
    }
  };

  const doEmailExport = async (user: User) => {
    if (!requireAdminEvent(adminEventId, "email this user’s data export"))
      return;
    setEmailingExportUserId(user.id);
    try {
      await apiRequest(
        `/api/admin/users/${user.id}/email-export${adminEventId ? `?eventId=${adminEventId}` : ""}`,
        { method: "POST" },
      );
      Alert.alert(
        "Export emailed",
        `The data export was sent to ${user.email}.`,
      );
    } catch (e: any) {
      Alert.alert(
        "Export email failed",
        e.message || "Could not email user data export",
      );
    } finally {
      setEmailingExportUserId(null);
    }
  };

  const handleEmailExport = (user: User) => {
    if (!requireAdminEvent(adminEventId, "email this user’s data export"))
      return;
    if (Platform.OS === "web") {
      const ok = window.confirm(
        `Send ${user.name}'s data export to ${user.email}?`,
      );
      if (ok) doEmailExport(user);
    } else {
      Alert.alert(
        "Send Data Export?",
        `Email ${user.name}'s data export to ${user.email}?`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Send to user", onPress: () => doEmailExport(user) },
        ],
      );
    }
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => {
            if (!requireAdminEvent(adminEventId, "clear users")) return;
            setShowClearAll(true);
          }}
          style={{ paddingHorizontal: 16, paddingVertical: 8 }}
          testID="button-clear-all-users"
        >
          <Feather name="trash-2" size={20} color={AppColors.error} />
        </Pressable>
      ),
    });
  }, [adminEventId, navigation]);

  const handleClearAll = async () => {
    if (!requireAdminEvent(adminEventId, "clear users")) return;
    setIsClearing(true);
    try {
      await apiRequest(
        `/api/admin/users/all${adminEventId ? `?eventId=${adminEventId}` : ""}`,
        { method: "DELETE" },
      );
      await queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", adminEventId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["/api/admin/stats", adminEventId],
      });
      setShowClearAll(false);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to clear users");
    } finally {
      setIsClearing(false);
    }
  };

  const getUserInitials = (name: string) =>
    name
      .split(" ")
      .slice(0, 2)
      .map((n) => n[0])
      .join("")
      .toUpperCase();

  const renderUser = ({ item }: { item: User }) => (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.cardBackground, borderColor: theme.border },
        Shadows.small,
      ]}
    >
      <Pressable
        onPress={() => setSelectedUser(item)}
        testID={`button-open-user-${item.id}`}
        style={styles.cardMain}
      >
        <View
          style={[
            styles.avatar,
            {
              backgroundColor: `${ROLE_COLORS[item.role] || AppColors.primary}18`,
              borderColor: `${ROLE_COLORS[item.role] || AppColors.primary}25`,
              borderWidth: 1.5,
            },
          ]}
        >
          {item.photoUrl ? (
            <Image source={{ uri: item.photoUrl }} style={styles.avatarImage} />
          ) : (
            <ThemedText
              style={[
                styles.avatarText,
                { color: ROLE_COLORS[item.role] || AppColors.primary },
              ]}
            >
              {getUserInitials(item.name)}
            </ThemedText>
          )}
        </View>
        <View style={styles.cardInfo}>
          <ThemedText style={styles.cardName} numberOfLines={1}>
            {item.name}
          </ThemedText>
          <ThemedText
            style={[styles.cardEmail, { color: theme.textSecondary }]}
            numberOfLines={1}
          >
            {item.email}
          </ThemedText>
        </View>
        <Feather name="chevron-right" size={20} color={theme.textTertiary} />
      </Pressable>
      {String(item.role).toLowerCase() === "attendee" ? (
        <Pressable
          onPress={() => setAssignmentUser(item)}
          style={[
            styles.cardAction,
            { backgroundColor: `${AppColors.primary}12` },
          ]}
          testID={`button-assign-case-studies-user-${item.id}`}
          accessibilityRole="button"
          accessibilityLabel={`Assign case studies to ${item.name}`}
        >
          <Feather name="book-open" size={16} color={AppColors.primary} />
          <ThemedText style={{ color: AppColors.primary, fontWeight: "700" }}>
            Case studies
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <View style={[styles.header, { paddingTop: Spacing.md }]}>
        <View style={styles.headerTop}>
          <View
            style={[
              styles.searchBar,
              {
                backgroundColor: theme.backgroundSecondary,
                borderColor: theme.border,
                flex: 1,
              },
            ]}
          >
            <Feather name="search" size={16} color={theme.textSecondary} />
            <TextInput
              style={[styles.searchInput, { color: theme.text }]}
              value={search}
              onChangeText={setSearch}
              placeholder="Search by name or email…"
              placeholderTextColor={theme.textSecondary}
              testID="input-search-users"
            />
            {search.length > 0 ? (
              <Pressable onPress={() => setSearch("")}>
                <Feather name="x" size={16} color={theme.textSecondary} />
              </Pressable>
            ) : null}
          </View>
          <Pressable
            onPress={() => setShowImport(true)}
            style={[
              styles.importBtn,
              { backgroundColor: `${AppColors.primary}12` },
            ]}
            testID="button-import-csv"
          >
            <Feather name="upload" size={18} color={AppColors.primary} />
          </Pressable>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterRow}
          contentContainerStyle={{ gap: Spacing.sm }}
        >
          {(["all", "attendee", "staff", "admin"] as const).map((r) => (
            <Pressable
              key={r}
              onPress={() => setRoleFilter(r)}
              style={[
                styles.filterChip,
                {
                  backgroundColor:
                    roleFilter === r
                      ? AppColors.primary
                      : theme.backgroundSecondary,
                  borderColor:
                    roleFilter === r ? AppColors.primary : theme.border,
                },
              ]}
            >
              <ThemedText
                style={{
                  fontSize: 13,
                  fontWeight: "600",
                  color: roleFilter === r ? "#fff" : theme.textSecondary,
                }}
              >
                {r === "all"
                  ? `All (${users.length})`
                  : `${r.charAt(0).toUpperCase() + r.slice(1)} (${users.filter((u) => u.role === r).length})`}
              </ThemedText>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {isLoading ? (
        <ActivityIndicator
          style={{ marginTop: 40 }}
          color={AppColors.primary}
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(u) => u.id}
          renderItem={renderUser}
          contentContainerStyle={{
            paddingHorizontal: Spacing.lg,
            paddingTop: Spacing.md,
            paddingBottom: insets.bottom + 100,
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="users" size={36} color={theme.textSecondary} />
              <ThemedText
                style={[styles.emptyText, { color: theme.textSecondary }]}
              >
                No users found
              </ThemedText>
            </View>
          }
        />
      )}

      <Pressable
        onPress={() => {
          if (!requireAdminEvent(adminEventId, "add a user")) return;
          setEditUser(null);
          setShowForm(true);
        }}
        style={[styles.fab, { bottom: insets.bottom + Spacing.xl }]}
        testID="button-add-user"
      >
        <Feather name="plus" size={24} color="#fff" />
      </Pressable>

      <FormModal
        visible={showForm}
        onClose={() => {
          setShowForm(false);
          setEditUser(null);
        }}
        onSave={handleSave}
        editUser={editUser}
        isSaving={isSaving}
        theme={theme}
        adminEventName={adminEventName}
        adminEventYear={adminEventYear}
      />
      <Modal
        visible={!!selectedUser}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedUser(null)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalCard,
              styles.userActionsCard,
              { backgroundColor: theme.cardBackground },
            ]}
          >
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <ThemedText type="h4">User options</ThemedText>
                <ThemedText
                  style={{ color: theme.textSecondary, marginTop: 3 }}
                  numberOfLines={1}
                >
                  {selectedUser?.name}
                </ThemedText>
                <ThemedText
                  style={{
                    color: theme.textTertiary,
                    fontSize: 12,
                    marginTop: 2,
                  }}
                  numberOfLines={1}
                >
                  {selectedUser?.email}
                </ThemedText>
              </View>
              <Pressable
                onPress={() => setSelectedUser(null)}
                hitSlop={8}
                testID="button-close-user-options"
              >
                <Feather name="x" size={22} color={theme.text} />
              </Pressable>
            </View>
            <View style={styles.userActionGrid}>
              {String(selectedUser?.role).toLowerCase() === "attendee" ? (
                <Pressable
                  onPress={() => {
                    setAssignmentUser(selectedUser);
                    setSelectedUser(null);
                  }}
                  style={[
                    styles.userAction,
                    { backgroundColor: `${AppColors.primary}12` },
                  ]}
                  testID={`button-assign-case-studies-user-${selectedUser?.id}`}
                >
                  <Feather
                    name="book-open"
                    size={19}
                    color={AppColors.primary}
                  />
                  <ThemedText
                    style={{ color: AppColors.primary, fontWeight: "700" }}
                  >
                    Case studies
                  </ThemedText>
                </Pressable>
              ) : null}
              {selectedUser?.role === "attendee" &&
              !selectedUser.eventInvitationSentAt &&
              !selectedUser.email.trim().toLowerCase().endsWith(".test") &&
              [
                "pending",
                "processing",
                "failed",
                "needs_review",
                "skipped",
              ].includes(selectedUser.eventInvitationStatus ?? "") ? (
                selectedUser.eventInvitationStatus === "pending" ||
                selectedUser.eventInvitationStatus === "processing" ? (
                  <View
                    style={[
                      styles.userAction,
                      { backgroundColor: `${AppColors.primary}12` },
                    ]}
                  >
                    <Feather name="clock" size={19} color={AppColors.primary} />
                    <ThemedText
                      style={{ color: AppColors.primary, fontWeight: "700" }}
                    >
                      Invitation queued
                    </ThemedText>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => {
                      if (
                        selectedUser.eventInvitationStatus === "needs_review"
                      ) {
                        setUncertainRetryUser(selectedUser);
                      } else {
                        void handleQueueInvitation(selectedUser);
                      }
                    }}
                    disabled={queueingInvitationId === selectedUser.id}
                    style={[
                      styles.userAction,
                      { backgroundColor: `${AppColors.primary}12` },
                    ]}
                    testID={`button-retry-event-invitation-${selectedUser.id}`}
                  >
                    {queueingInvitationId === selectedUser.id ? (
                      <ActivityIndicator
                        size="small"
                        color={AppColors.primary}
                      />
                    ) : (
                      <Feather
                        name="mail"
                        size={19}
                        color={AppColors.primary}
                      />
                    )}
                    <ThemedText
                      style={{ color: AppColors.primary, fontWeight: "700" }}
                    >
                      {selectedUser.eventInvitationStatus === "needs_review"
                        ? "Review and retry invitation"
                        : selectedUser.eventInvitationStatus === "failed"
                          ? "Retry event invitation"
                          : "Queue event invitation"}
                    </ThemedText>
                  </Pressable>
                )
              ) : null}
              <Pressable
                onPress={() => selectedUser && handleExport(selectedUser)}
                disabled={!selectedUser || exportingUserId === selectedUser.id}
                style={[styles.userAction, { backgroundColor: "#10B98112" }]}
                testID={
                  selectedUser
                    ? `button-export-user-${selectedUser.id}`
                    : undefined
                }
              >
                {selectedUser && exportingUserId === selectedUser.id ? (
                  <ActivityIndicator size="small" color="#059669" />
                ) : (
                  <Feather name="download" size={19} color="#059669" />
                )}
                <ThemedText style={{ color: "#059669", fontWeight: "700" }}>
                  Export data
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={() => selectedUser && handleEmailExport(selectedUser)}
                disabled={
                  !selectedUser || emailingExportUserId === selectedUser.id
                }
                style={[styles.userAction, { backgroundColor: "#0EA5E912" }]}
                testID={
                  selectedUser
                    ? `button-email-export-user-${selectedUser.id}`
                    : undefined
                }
              >
                {selectedUser && emailingExportUserId === selectedUser.id ? (
                  <ActivityIndicator size="small" color="#0284C7" />
                ) : (
                  <Feather name="send" size={19} color="#0284C7" />
                )}
                <ThemedText style={{ color: "#0284C7", fontWeight: "700" }}>
                  Email export
                </ThemedText>
              </Pressable>
              {selectedUser?.email.trim().toLowerCase() !==
              PROTECTED_ADMIN_EMAIL ? (
                <Pressable
                  onPress={() => {
                    if (!selectedUser) return;
                    setEditUser(selectedUser);
                    setSelectedUser(null);
                    setShowForm(true);
                  }}
                  style={[
                    styles.userAction,
                    { backgroundColor: `${AppColors.primary}12` },
                  ]}
                  testID={
                    selectedUser
                      ? `button-edit-user-${selectedUser.id}`
                      : undefined
                  }
                >
                  <Feather name="edit-2" size={19} color={AppColors.primary} />
                  <ThemedText
                    style={{ color: AppColors.primary, fontWeight: "700" }}
                  >
                    Edit user
                  </ThemedText>
                </Pressable>
              ) : (
                <View
                  style={[
                    styles.userAction,
                    { backgroundColor: `${AppColors.primary}08` },
                  ]}
                >
                  <Feather name="shield" size={19} color={AppColors.primary} />
                  <ThemedText
                    style={{ color: AppColors.primary, fontWeight: "700" }}
                  >
                    Protected admin
                  </ThemedText>
                </View>
              )}
              {selectedUser?.role !== "admin" ? (
                <Pressable
                  onPress={() => {
                    if (!selectedUser) return;
                    setDeleteUser(selectedUser);
                    setSelectedUser(null);
                  }}
                  style={[
                    styles.userAction,
                    { backgroundColor: `${AppColors.error}12` },
                  ]}
                  testID={
                    selectedUser
                      ? `button-delete-user-${selectedUser.id}`
                      : undefined
                  }
                >
                  <Feather name="trash-2" size={19} color={AppColors.error} />
                  <ThemedText
                    style={{ color: AppColors.error, fontWeight: "700" }}
                  >
                    Delete user
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>
      <DeleteModal
        visible={!!deleteUser}
        onClose={() => setDeleteUser(null)}
        onConfirm={handleDelete}
        userName={deleteUser?.name || ""}
        theme={theme}
      />
      <ImportModal
        visible={showImport}
        onClose={() => setShowImport(false)}
        theme={theme}
      />
      <UserCaseStudiesModal
        visible={!!assignmentUser}
        user={assignmentUser}
        eventId={adminEventId}
        eventName={adminEventName}
        eventYear={adminEventYear}
        theme={theme}
        onClose={() => setAssignmentUser(null)}
        onUpdated={refreshAssignmentViews}
      />
      {/* Password reset is now done via email — no SetPasswordModal */}
      <ConfirmModal
        visible={!!uncertainRetryUser}
        title="Delivery needs review"
        message="The previous attempt may already have reached this attendee. Check with them before retrying; another invitation could be a duplicate."
        confirmLabel="Retry anyway"
        onConfirm={() => {
          const user = uncertainRetryUser;
          setUncertainRetryUser(null);
          if (user) void handleQueueInvitation(user);
        }}
        onCancel={() => setUncertainRetryUser(null)}
      />
      <ConfirmModal
        visible={showClearAll}
        title="Clear All Users"
        message={`This will permanently delete all ${users.filter((u) => u.role !== "admin").length} non-admin user${users.filter((u) => u.role !== "admin").length !== 1 ? "s" : ""}. Admin accounts are preserved. This cannot be undone.`}
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
  header: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
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
  importBtn: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  filterRow: { marginTop: Spacing.sm },
  filterChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.xl,
    marginBottom: Spacing.sm,
    borderWidth: 1,
  },
  cardMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  cardAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 18, fontWeight: "700" },
  avatarImage: { width: 44, height: 44, borderRadius: 22 },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 15, fontWeight: "600", marginBottom: 2 },
  cardEmail: { fontSize: 13, marginBottom: 4 },
  roleBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  roleText: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  cardActions: { flexDirection: "row", gap: Spacing.sm },
  caseStudyOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    marginBottom: Spacing.sm,
  },
  assignmentList: { flex: 1 },
  assignmentListContent: { paddingBottom: Spacing.md },
  assignmentModalCard: {
    height: "88%",
    maxHeight: "88%",
  },
  assignmentListHeader: {
    paddingBottom: Spacing.md,
  },
  assignmentSummary: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    marginHorizontal: Spacing.xl,
    marginBottom: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  assignmentSummaryItem: {
    flex: 1,
    alignItems: "center",
  },
  assignmentSummaryNumber: {
    fontSize: 22,
    fontWeight: "800",
  },
  assignmentSummaryLabel: {
    fontSize: 11,
    marginTop: 2,
  },
  assignmentSummaryDivider: {
    width: 1,
    height: 30,
  },
  assignmentEmpty: {
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xl * 2,
  },
  assignmentError: {
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: Spacing.lg,
  },
  retryButton: {
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: { alignItems: "center", paddingTop: 60, gap: Spacing.md },
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
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  deleteModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xl,
  },
  modalCard: {
    borderTopLeftRadius: BorderRadius.xl * 2,
    borderTopRightRadius: BorderRadius.xl * 2,
    maxHeight: "92%",
  },
  assignmentKeyboard: {
    width: "100%",
    maxHeight: "92%",
  },
  formModalKeyboard: {
    width: "100%",
    maxHeight: "92%",
  },
  formModalCard: {
    height: "100%",
    maxHeight: "100%",
  },
  userActionsCard: { paddingBottom: Spacing.xl },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.md,
  },
  modalBody: { flex: 1, paddingHorizontal: Spacing.xl },
  modalBodyContent: { paddingBottom: Spacing.md },
  userActionGrid: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
  },
  userAction: {
    minHeight: 52,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  fieldLabel: {
    fontSize: 13,
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
  roleRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    flexWrap: "wrap",
    marginBottom: Spacing.sm,
  },
  roleChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  modalFooter: {
    flexDirection: "row",
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  formModalFooter: {
    flexShrink: 0,
    minHeight: 76,
  },
  buttonLabel: {
    flexShrink: 1,
    textAlign: "center",
    fontSize: 15,
    lineHeight: 20,
  },
  btn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimary: { backgroundColor: AppColors.primary },
  btnDanger: { backgroundColor: AppColors.error },
  confirmCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    alignItems: "center",
  },
  deleteIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.lg,
  },
  confirmText: {
    textAlign: "center",
    lineHeight: 22,
    marginBottom: Spacing.lg,
    fontSize: 14,
  },
  // Form contextual hints
  eventContextRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginTop: Spacing.lg,
    marginBottom: Spacing.xs,
  },
  setupHintRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.md,
  },
  // Import styles
  importPickBody: {
    padding: Spacing.xl,
    alignItems: "center",
    gap: Spacing.md,
  },
  importIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  importHint: { textAlign: "center", fontSize: 13, lineHeight: 20 },
  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.xs,
    padding: Spacing.sm,
    backgroundColor: `${AppColors.error}10`,
    borderRadius: BorderRadius.md,
    width: "100%",
  },
  pickBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    paddingVertical: 14,
    borderRadius: BorderRadius.full,
    width: "100%",
    justifyContent: "center",
  },
  previewHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  previewList: { maxHeight: 300, paddingHorizontal: Spacing.xl },
  previewListContent: { paddingBottom: Spacing.sm },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
  },
  previewAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  rolePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: BorderRadius.xs,
  },
  resultGrid: {
    flexDirection: "row",
    gap: Spacing.md,
    width: "100%",
    marginTop: Spacing.md,
  },
  resultBox: {
    flex: 1,
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
  },
  resultNum: { fontSize: 32, fontWeight: "800" },
  resultList: { width: "100%", maxHeight: 230, marginTop: Spacing.sm },
  resultListContent: { paddingHorizontal: Spacing.xl },
  resultRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
  },
});
