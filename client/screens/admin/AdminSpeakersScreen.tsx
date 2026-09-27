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
  TextInput,
  Pressable,
  Image,
  Modal,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
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
import { ImagePickerField } from "@/components/ImagePickerField";
import type { Speaker } from "@shared/schema";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

interface SpeakerForm {
  name: string;
  title: string;
  company: string;
  bio: string;
  photoUrl: string;
  email: string;
  linkedin: string;
}
const DEFAULT: SpeakerForm = {
  name: "",
  title: "",
  company: "",
  bio: "",
  photoUrl: "",
  email: "",
  linkedin: "",
};
const EMPTY_SPEAKERS: Speaker[] = [];

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

function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  keyboardType,
  theme,
}: any) {
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
        keyboardType={keyboardType || "default"}
        autoCapitalize="none"
      />
    </>
  );
}

const SPEAKER_ROW_HEIGHT = 82;

function DraggableSpeakerRow({
  item,
  index,
  total,
  activeIndexSV,
  gestureYSV,
  setScrollEnabled,
  onDrop,
  onEdit,
  onDelete,
  theme,
}: {
  item: Speaker;
  index: number;
  total: number;
  activeIndexSV: SharedValue<number>;
  gestureYSV: SharedValue<number>;
  setScrollEnabled: (enabled: boolean) => void;
  onDrop: (from: number, to: number) => void;
  onEdit: (item: Speaker) => void;
  onDelete: (item: Speaker) => void;
  theme: any;
}) {
  const triggerHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);
  const dragGesture = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(500)
        .onBegin(() => {
          activeIndexSV.value = index;
          gestureYSV.value = 0;
          runOnJS(triggerHaptic)();
          runOnJS(setScrollEnabled)(false);
        })
        .onUpdate((event) => {
          gestureYSV.value = event.translationY;
        })
        .onEnd(() => {
          const newIndex = Math.max(
            0,
            Math.min(
              total - 1,
              Math.round(gestureYSV.value / SPEAKER_ROW_HEIGHT) +
                activeIndexSV.value,
            ),
          );
          if (newIndex !== activeIndexSV.value)
            runOnJS(onDrop)(activeIndexSV.value, newIndex);
        })
        .onFinalize(() => {
          activeIndexSV.value = -1;
          gestureYSV.value = 0;
          runOnJS(setScrollEnabled)(true);
        }),
    [
      activeIndexSV,
      gestureYSV,
      index,
      onDrop,
      setScrollEnabled,
      total,
      triggerHaptic,
    ],
  );

  const animatedStyle = useAnimatedStyle(() => {
    const activeIndex = activeIndexSV.value;
    const translationY = gestureYSV.value;
    if (activeIndex === -1)
      return { zIndex: 0, transform: [{ translateY: 0 }] };
    if (activeIndex === index) {
      return {
        zIndex: 100,
        transform: [{ translateY: translationY }, { scale: 1.03 }],
        opacity: 0.92,
      };
    }
    const newIndex = Math.max(
      0,
      Math.min(
        total - 1,
        Math.round(translationY / SPEAKER_ROW_HEIGHT) + activeIndex,
      ),
    );
    const shift =
      activeIndex < index && index <= newIndex
        ? -SPEAKER_ROW_HEIGHT
        : newIndex <= index && index < activeIndex
          ? SPEAKER_ROW_HEIGHT
          : 0;
    return { zIndex: 0, transform: [{ translateY: shift }] };
  });

  return (
    <Animated.View style={animatedStyle}>
      <GestureDetector gesture={dragGesture}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.cardBackground,
              borderColor: theme.border,
            },
          ]}
        >
          <View
            style={[styles.dragHandle, { borderRightColor: theme.border }]}
            pointerEvents="none"
          >
            <Feather name="menu" size={18} color={theme.textTertiary} />
          </View>
          <SpeakerRowContent item={item} theme={theme} />
          <View style={styles.actions}>
            <Pressable
              onPress={() => onEdit(item)}
              style={[
                styles.actionBtn,
                { backgroundColor: `${AppColors.primary}12` },
              ]}
              testID={`button-edit-speaker-${item.id}`}
            >
              <Feather name="edit-2" size={15} color={AppColors.primary} />
            </Pressable>
            <Pressable
              onPress={() => onDelete(item)}
              style={[
                styles.actionBtn,
                { backgroundColor: `${AppColors.error}12` },
              ]}
              testID={`button-delete-speaker-${item.id}`}
            >
              <Feather name="trash-2" size={15} color={AppColors.error} />
            </Pressable>
          </View>
        </View>
      </GestureDetector>
    </Animated.View>
  );
}

function SpeakerRowContent({ item, theme }: { item: Speaker; theme: any }) {
  return (
    <>
      {item.photoUrl ? (
        <Image
          source={{ uri: item.photoUrl }}
          style={styles.speakerPhoto}
          resizeMode="cover"
        />
      ) : (
        <LinearGradient
          colors={[AppColors.primary, "#1a0080"]}
          style={styles.speakerPhoto}
        >
          <ThemedText style={styles.initialText}>
            {getSpeakerInitials(item.name)}
          </ThemedText>
        </LinearGradient>
      )}
      <View style={styles.cardInfo}>
        <ThemedText
          style={[styles.cardName, { color: theme.text }]}
          numberOfLines={1}
        >
          {item.name}
        </ThemedText>
        {item.title ? (
          <ThemedText
            style={[styles.cardSub, { color: theme.textSecondary }]}
            numberOfLines={1}
          >
            {item.title}
          </ThemedText>
        ) : null}
        {item.company ? (
          <View style={styles.companyRow}>
            <Feather name="briefcase" size={11} color={AppColors.accent} />
            <ThemedText
              style={[styles.companyText, { color: AppColors.accent }]}
              numberOfLines={1}
            >
              {item.company}
            </ThemedText>
          </View>
        ) : null}
      </View>
    </>
  );
}

function FormModal({
  visible,
  onClose,
  onSave,
  item,
  isSaving,
  theme,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (f: SpeakerForm) => void;
  item: Speaker | null;
  isSaving: boolean;
  theme: any;
}) {
  const [form, setForm] = useState<SpeakerForm>(DEFAULT);
  React.useEffect(() => {
    if (visible)
      setForm(
        item
          ? {
              name: item.name,
              title: item.title || "",
              company: item.company || "",
              bio: item.bio || "",
              photoUrl: item.photoUrl || "",
              email: item.email || "",
              linkedin: item.linkedin || "",
            }
          : DEFAULT,
      );
  }, [visible, item]);
  const set = (k: keyof SpeakerForm) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }));
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
              {item ? "Edit Speaker" : "Add Speaker"}
            </ThemedText>
            <Pressable onPress={onClose} hitSlop={8}>
              <Feather name="x" size={22} color={theme.text} />
            </Pressable>
          </View>
          <ScrollView
            style={styles.sheetBody}
            showsVerticalScrollIndicator={false}
          >
            {/* ── Basic Info ── */}
            <View
              style={[
                styles.sectionDivider,
                { borderBottomColor: theme.border },
              ]}
            >
              <Feather name="user" size={12} color={theme.textTertiary} />
              <ThemedText
                style={[
                  styles.sectionDividerLabel,
                  { color: theme.textTertiary },
                ]}
              >
                Basic Info
              </ThemedText>
            </View>
            <Field
              label="Full Name *"
              value={form.name}
              onChange={set("name")}
              placeholder="Dr. Jane Smith"
              theme={theme}
            />
            <Field
              label="Title"
              value={form.title}
              onChange={set("title")}
              placeholder="e.g. Professor of Cardiology"
              theme={theme}
            />
            <Field
              label="Company / Institution"
              value={form.company}
              onChange={set("company")}
              placeholder="University of Twente"
              theme={theme}
            />
            <Field
              label="Bio"
              value={form.bio}
              onChange={set("bio")}
              placeholder="Short biography…"
              multiline
              theme={theme}
            />
            {/* ── Photo & Contact ── */}
            <View
              style={[
                styles.sectionDivider,
                { borderBottomColor: theme.border, marginTop: Spacing.md },
              ]}
            >
              <Feather name="camera" size={12} color={theme.textTertiary} />
              <ThemedText
                style={[
                  styles.sectionDividerLabel,
                  { color: theme.textTertiary },
                ]}
              >
                Photo & Contact
              </ThemedText>
            </View>
            <ImagePickerField
              label="Photo"
              value={form.photoUrl}
              onChange={set("photoUrl")}
              theme={theme}
              shape="circle"
            />
            <Field
              label="Email"
              value={form.email}
              onChange={set("email")}
              placeholder="speaker@example.com"
              keyboardType="email-address"
              theme={theme}
            />
            <Field
              label="LinkedIn URL"
              value={form.linkedin}
              onChange={set("linkedin")}
              placeholder="https://linkedin.com/in/…"
              theme={theme}
            />
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
              testID="button-save-speaker"
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

export default function AdminSpeakersScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const qc = useQueryClient();
  const { adminEventId } = useAdminEvent();

  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<Speaker | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showClearAll, setShowClearAll] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [localSpeakers, setLocalSpeakers] = useState<Speaker[]>([]);

  const { data: speakersData, isLoading } = useQuery<Speaker[]>({
    queryKey: ["/api/admin/speakers", adminEventId],
    queryFn: async () => {
      const res = await apiRequest(
        `/api/admin/speakers${adminEventId ? `?eventId=${adminEventId}` : ""}`,
      );
      return res.json();
    },
    enabled: !!adminEventId,
  });
  const speakers = speakersData ?? EMPTY_SPEAKERS;

  useEffect(() => {
    setLocalSpeakers(speakers);
  }, [speakers]);

  const filtered = useMemo(() => {
    if (!search.trim()) return localSpeakers;
    const q = search.toLowerCase();
    return localSpeakers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.company || "").toLowerCase().includes(q),
    );
  }, [localSpeakers, search]);

  const orderedSpeakers = search.trim() ? filtered : localSpeakers;
  const activeIndexSV = useSharedValue(-1);
  const gestureYSV = useSharedValue(0);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => {
            if (!requireAdminEvent(adminEventId, "clear speakers")) return;
            setShowClearAll(true);
          }}
          style={{ paddingHorizontal: 16, paddingVertical: 8 }}
          testID="button-clear-all-speakers"
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
          queryKey: ["/api/admin/speakers", adminEventId],
        }),
        qc.invalidateQueries({ queryKey: ["/api/admin/stats", adminEventId] }),
      ]),
    [adminEventId, qc],
  );

  const handleDrop = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return;
      if (!requireAdminEvent(adminEventId, "reorder speakers")) return;
      const previous = localSpeakers;
      const next = [...localSpeakers];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      setLocalSpeakers(next);
      apiRequest(`/api/admin/speakers/reorder?eventId=${adminEventId}`, {
        method: "PUT",
        body: JSON.stringify({
          items: next.map((speaker, sortOrder) => ({
            id: speaker.id,
            sortOrder,
          })),
        }),
      })
        .then(() => invalidate())
        .catch((error: any) => {
          setLocalSpeakers(previous);
          Alert.alert("Order not saved", error?.message || "Please try again.");
        });
    },
    [adminEventId, invalidate, localSpeakers],
  );

  const handleSave = async (form: SpeakerForm) => {
    if (
      !requireAdminEvent(
        adminEventId,
        editItem ? "edit this speaker" : "add a speaker",
      )
    )
      return;
    if (!form.name.trim()) {
      Alert.alert("Error", "Name is required");
      return;
    }
    setIsSaving(true);
    try {
      if (editItem) {
        await apiRequest(
          `/api/admin/speakers/${editItem.id}${adminEventId ? `?eventId=${adminEventId}` : ""}`,
          { method: "PUT", body: JSON.stringify(form) },
        );
      } else {
        await apiRequest("/api/admin/speakers", {
          method: "POST",
          body: JSON.stringify({ ...form, eventId: adminEventId }),
        });
      }
      await invalidate();
      setShowForm(false);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to save");
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearAll = async () => {
    if (!requireAdminEvent(adminEventId, "clear speakers")) return;
    setIsClearing(true);
    try {
      await apiRequest(
        `/api/admin/speakers/all${adminEventId ? `?eventId=${adminEventId}` : ""}`,
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

  const handleDelete = async (sp: Speaker) => {
    if (!requireAdminEvent(adminEventId, "delete this speaker")) return;
    if (!(await confirmDestructive("Delete Speaker", `Remove ${sp.name}?`)))
      return;
    try {
      await apiRequest(
        `/api/admin/speakers/${sp.id}${adminEventId ? `?eventId=${adminEventId}` : ""}`,
        { method: "DELETE" },
      );
      await invalidate();
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to delete speaker");
    }
  };

  const renderItem = ({ item, index }: { item: Speaker; index: number }) =>
    search.trim() ? (
      <View
        style={[
          styles.card,
          { backgroundColor: theme.cardBackground, borderColor: theme.border },
        ]}
      >
        <SpeakerRowContent item={item} theme={theme} />
        <View style={styles.actions}>
          <Pressable
            onPress={() => {
              setEditItem(item);
              setShowForm(true);
            }}
            style={[
              styles.actionBtn,
              { backgroundColor: `${AppColors.primary}12` },
            ]}
            testID={`button-edit-speaker-${item.id}`}
          >
            <Feather name="edit-2" size={15} color={AppColors.primary} />
          </Pressable>
          <Pressable
            onPress={() => handleDelete(item)}
            style={[
              styles.actionBtn,
              { backgroundColor: `${AppColors.error}12` },
            ]}
            testID={`button-delete-speaker-${item.id}`}
          >
            <Feather name="trash-2" size={15} color={AppColors.error} />
          </Pressable>
        </View>
      </View>
    ) : (
      <DraggableSpeakerRow
        item={item}
        index={index}
        total={orderedSpeakers.length}
        activeIndexSV={activeIndexSV}
        gestureYSV={gestureYSV}
        setScrollEnabled={setScrollEnabled}
        onDrop={handleDrop}
        onEdit={(speaker) => {
          setEditItem(speaker);
          setShowForm(true);
        }}
        onDelete={handleDelete}
        theme={theme}
      />
    );

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
            placeholder="Search speakers…"
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
      {isLoading ? (
        <ActivityIndicator
          style={{ marginTop: 40 }}
          color={AppColors.primary}
        />
      ) : (
        <FlatList
          data={orderedSpeakers}
          keyExtractor={(s) => s.id}
          renderItem={renderItem}
          scrollEnabled={scrollEnabled}
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
                <Feather name="mic" size={28} color={AppColors.primary} />
              </View>
              <ThemedText
                style={[styles.emptyText, { color: theme.textSecondary }]}
              >
                No speakers found
              </ThemedText>
            </View>
          }
        />
      )}
      <Pressable
        onPress={() => {
          if (!requireAdminEvent(adminEventId, "add a speaker")) return;
          setEditItem(null);
          setShowForm(true);
        }}
        style={[styles.fab, { bottom: insets.bottom + Spacing.xl }]}
        testID="button-add-speaker"
      >
        <Feather name="plus" size={24} color="#fff" />
      </Pressable>
      <FormModal
        visible={showForm}
        onClose={() => setShowForm(false)}
        onSave={handleSave}
        item={editItem}
        isSaving={isSaving}
        theme={theme}
      />
      <ConfirmModal
        visible={showClearAll}
        title="Clear All Speakers"
        message={`This will permanently delete all ${speakers.length} speaker${speakers.length !== 1 ? "s" : ""}. This cannot be undone.`}
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
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.xl,
    marginBottom: Spacing.sm,
    borderWidth: 1,
  },
  dragHandle: {
    width: 28,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.sm,
    borderRightWidth: 1,
  },
  dragHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  dragHintText: { fontSize: 12, fontWeight: "600" },
  speakerPhoto: {
    width: 52,
    height: 52,
    borderRadius: 26,
    marginRight: Spacing.md,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  initialText: { color: "#fff", fontSize: 18, fontWeight: "800" },
  companyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  companyText: { fontSize: 12, fontWeight: "600" },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 15, fontWeight: "600", marginBottom: 2 },
  cardSub: { fontSize: 13 },
  actions: { flexDirection: "row", gap: Spacing.sm },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
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
  sheetBody: { paddingHorizontal: Spacing.xl },
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
  sectionDivider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingBottom: Spacing.xs,
    borderBottomWidth: 1,
    marginBottom: Spacing.xs,
  },
  sectionDividerLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
});
