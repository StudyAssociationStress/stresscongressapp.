import React, {
  useState,
  useEffect,
  useCallback,
  useLayoutEffect,
  useMemo,
} from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Modal,
  ActivityIndicator,
  Alert,
  TextInput,
} from "react-native";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation } from "@react-navigation/native";
import { getScreenContentTopPadding } from "@/hooks/useScreenOptions";
import { useAdminEvent } from "@/contexts/AdminEventContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { apiRequest } from "@/lib/query-client";
import { requireAdminEvent } from "@/lib/admin-event-guard";
import { confirmDestructive } from "@/lib/confirm-destructive";
import { AppColors, BorderRadius, Spacing } from "@/constants/theme";
import { ConfirmModal } from "@/components/ConfirmModal";
import { STARTER_TIMETABLE_PREFIX, type TimetableItem } from "@shared/schema";

const ITEM_HEIGHT = 88;
const CATEGORIES = [
  "session",
  "break",
  "social",
  "registration",
  "lunch",
  "dinner",
];
const EMPTY_TIMETABLE: TimetableItem[] = [];
const CAT_COLORS: Record<string, string> = {
  session: "#1D4ED8",
  break: "#047857",
  social: "#7C3AED",
  registration: "#B45309",
  lunch: "#0369A1",
  dinner: "#BE185D",
};
const CAT_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  session: "book",
  break: "coffee",
  social: "users",
  registration: "clipboard",
  lunch: "sun",
  dinner: "moon",
};

interface TimetableForm {
  time: string;
  activity1: string;
  activity2: string;
  duration: string;
  location: string;
  category: string;
}
const DEFAULT: TimetableForm = {
  time: "",
  activity1: "",
  activity2: "",
  duration: "30 min",
  location: "",
  category: "session",
};
const isStarterItem = (item: TimetableItem) =>
  item.activity1.startsWith(STARTER_TIMETABLE_PREFIX);

function Field({ label, value, onChange, placeholder, theme }: any) {
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
          },
        ]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
      />
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
  onSave: (f: TimetableForm) => void;
  item: TimetableItem | null;
  isSaving: boolean;
  theme: any;
}) {
  const [form, setForm] = useState<TimetableForm>(DEFAULT);
  React.useEffect(() => {
    if (visible)
      setForm(
        item
          ? {
              time: item.time,
              activity1: item.activity1,
              activity2: item.activity2 || "",
              duration: item.duration,
              location: item.location || "",
              category: item.category,
            }
          : DEFAULT,
      );
  }, [visible, item]);
  const set = (k: keyof TimetableForm) => (v: string) =>
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
            <ThemedText type="h4">{item ? "Edit Slot" : "Add Slot"}</ThemedText>
            <Pressable onPress={onClose} hitSlop={8}>
              <Feather name="x" size={22} color={theme.text} />
            </Pressable>
          </View>
          <ScrollView
            style={styles.sheetBody}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.formRow}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Time *"
                  value={form.time}
                  onChange={set("time")}
                  placeholder="9:00"
                  theme={theme}
                />
              </View>
              <View style={{ flex: 1, marginLeft: Spacing.md }}>
                <Field
                  label="Duration *"
                  value={form.duration}
                  onChange={set("duration")}
                  placeholder="30 min"
                  theme={theme}
                />
              </View>
            </View>
            <Field
              label="Primary Activity *"
              value={form.activity1}
              onChange={set("activity1")}
              placeholder="Opening ceremony"
              theme={theme}
            />
            <Field
              label="Secondary Activity (optional)"
              value={form.activity2}
              onChange={set("activity2")}
              placeholder="Parallel track…"
              theme={theme}
            />
            <Field
              label="Location"
              value={form.location}
              onChange={set("location")}
              placeholder="Auditorium A"
              theme={theme}
            />
            <ThemedText
              style={[styles.fieldLabel, { color: theme.textSecondary }]}
            >
              Category
            </ThemedText>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginBottom: Spacing.sm }}
            >
              <View style={{ flexDirection: "row", gap: Spacing.sm }}>
                {CATEGORIES.map((c) => {
                  const color = CAT_COLORS[c] || AppColors.primary;
                  return (
                    <Pressable
                      key={c}
                      onPress={() => set("category")(c)}
                      style={[
                        styles.catChip,
                        {
                          backgroundColor:
                            form.category === c
                              ? `${color}20`
                              : theme.backgroundSecondary,
                          borderColor:
                            form.category === c ? color : theme.border,
                        },
                      ]}
                    >
                      <ThemedText
                        style={{
                          fontSize: 12,
                          fontWeight: "600",
                          color:
                            form.category === c ? color : theme.textSecondary,
                        }}
                      >
                        {c.charAt(0).toUpperCase() + c.slice(1)}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
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
              testID="button-save-slot"
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

interface RowProps {
  item: TimetableItem;
  index: number;
  total: number;
  activeIndexSV: SharedValue<number>;
  gestureYSV: SharedValue<number>;
  setScrollEnabled: (v: boolean) => void;
  onDrop: (from: number, to: number) => void;
  onEdit: (item: TimetableItem) => void;
  onDelete: (item: TimetableItem) => void;
  theme: any;
}

function DraggableRow({
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
}: RowProps) {
  const color = CAT_COLORS[item.category] || AppColors.primary;
  const icon = CAT_ICONS[item.category] || "clock";

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
        .onUpdate((e) => {
          gestureYSV.value = e.translationY;
        })
        .onEnd(() => {
          const newIdx = Math.max(
            0,
            Math.min(
              total - 1,
              Math.round(gestureYSV.value / ITEM_HEIGHT) + activeIndexSV.value,
            ),
          );
          if (newIdx !== activeIndexSV.value) {
            runOnJS(onDrop)(activeIndexSV.value, newIdx);
          }
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
      total,
      onDrop,
      triggerHaptic,
      setScrollEnabled,
    ],
  );

  const animStyle = useAnimatedStyle(() => {
    const ai = activeIndexSV.value;
    const gy = gestureYSV.value;
    if (ai === -1) {
      return {
        zIndex: 0,
        transform: [{ translateY: 0 }, { scale: withSpring(1) }],
        opacity: 1,
      };
    }
    if (ai === index) {
      return {
        zIndex: 100,
        transform: [{ translateY: gy }, { scale: 1.03 }],
        opacity: 0.92,
        shadowOpacity: 0.25,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
        elevation: 10,
      };
    }
    const newIdx = Math.max(
      0,
      Math.min(total - 1, Math.round(gy / ITEM_HEIGHT) + ai),
    );
    let shift = 0;
    if (ai < index && index <= newIdx) shift = -ITEM_HEIGHT;
    else if (newIdx <= index && index < ai) shift = ITEM_HEIGHT;
    return {
      zIndex: 0,
      transform: [
        { translateY: withSpring(shift, { damping: 20, stiffness: 200 }) },
        { scale: withSpring(1) },
      ],
      opacity: 1,
    };
  });

  return (
    <Animated.View style={[styles.cardWrapper, animStyle]}>
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
            <Feather name="menu" size={15} color={theme.textTertiary} />
          </View>
          <View
            style={[
              styles.timeBlock,
              { backgroundColor: `${color}10`, borderRightColor: `${color}25` },
            ]}
          >
            <View
              style={[styles.catIconWrap, { backgroundColor: `${color}18` }]}
            >
              <Feather name={icon} size={13} color={color} />
            </View>
            <ThemedText style={[styles.timeText, { color }]}>
              {item.time}
            </ThemedText>
            <ThemedText
              style={[styles.durationText, { color: theme.textSecondary }]}
            >
              {item.duration}
            </ThemedText>
          </View>
          <View style={styles.activityBlock}>
            <ThemedText
              style={[styles.activityTitle, { color: theme.text }]}
              numberOfLines={2}
            >
              {item.activity1}
            </ThemedText>
            {item.activity2 ? (
              <ThemedText
                style={[styles.activitySub, { color: theme.textSecondary }]}
                numberOfLines={1}
              >
                {item.activity2}
              </ThemedText>
            ) : null}
            {item.location ? (
              <View style={styles.locationRow}>
                <Feather name="map-pin" size={11} color={theme.textSecondary} />
                <ThemedText
                  style={[styles.locationText, { color: theme.textSecondary }]}
                >
                  {item.location}
                </ThemedText>
              </View>
            ) : null}
          </View>
          <View style={styles.rowActions}>
            <Pressable
              onPress={() => onEdit(item)}
              style={[
                styles.actionBtn,
                { backgroundColor: `${AppColors.primary}12` },
              ]}
              testID={`button-edit-slot-${item.id}`}
            >
              <Feather name="edit-2" size={14} color={AppColors.primary} />
            </Pressable>
            <Pressable
              onPress={() => onDelete(item)}
              style={[
                styles.actionBtn,
                { backgroundColor: `${AppColors.error}12` },
              ]}
              testID={`button-delete-slot-${item.id}`}
            >
              <Feather name="trash-2" size={14} color={AppColors.error} />
            </Pressable>
          </View>
        </View>
      </GestureDetector>
    </Animated.View>
  );
}

export default function AdminTimetableScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const navigation = useNavigation();
  const qc = useQueryClient();
  const { adminEventId } = useAdminEvent();

  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<TimetableItem | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [localItems, setLocalItems] = useState<TimetableItem[]>([]);
  const [showClearAll, setShowClearAll] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const activeIndexSV = useSharedValue(-1);
  const gestureYSV = useSharedValue(0);

  const { data: items, isLoading } = useQuery<TimetableItem[]>({
    queryKey: ["/api/admin/timetable", adminEventId],
    queryFn: async () => {
      const res = await apiRequest(
        `/api/admin/timetable${adminEventId ? `?eventId=${adminEventId}` : ""}`,
      );
      return res.json();
    },
    enabled: !!adminEventId,
  });

  useEffect(() => {
    setLocalItems(items ?? EMPTY_TIMETABLE);
  }, [items]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => {
            if (!requireAdminEvent(adminEventId, "clear the timetable")) return;
            setShowClearAll(true);
          }}
          style={{ paddingHorizontal: 16, paddingVertical: 8 }}
          testID="button-clear-all-timetable"
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
          queryKey: ["/api/admin/timetable", adminEventId],
        }),
        qc.invalidateQueries({ queryKey: ["/api/admin/stats", adminEventId] }),
      ]),
    [qc, adminEventId],
  );

  const handleSave = async (form: TimetableForm) => {
    if (
      !requireAdminEvent(
        adminEventId,
        editItem ? "edit this timetable slot" : "add a timetable slot",
      )
    )
      return;
    if (!form.time.trim() || !form.activity1.trim() || !form.duration.trim()) {
      Alert.alert("Error", "Time, activity, and duration are required");
      return;
    }
    setIsSaving(true);
    try {
      const sortOrder = editItem ? editItem.sortOrder : localItems.length;
      const payload = { ...form, sortOrder, eventId: adminEventId };
      if (editItem) {
        await apiRequest(
          `/api/admin/timetable/${editItem.id}${adminEventId ? `?eventId=${adminEventId}` : ""}`,
          { method: "PUT", body: JSON.stringify(payload) },
        );
      } else {
        await apiRequest("/api/admin/timetable", {
          method: "POST",
          body: JSON.stringify(payload),
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

  const handleDelete = async (item: TimetableItem) => {
    if (!requireAdminEvent(adminEventId, "delete this timetable slot")) return;
    if (
      !(await confirmDestructive(
        "Delete Slot",
        `Remove "${item.activity1}" at ${item.time}?`,
      ))
    )
      return;
    try {
      await apiRequest(
        `/api/admin/timetable/${item.id}${adminEventId ? `?eventId=${adminEventId}` : ""}`,
        { method: "DELETE" },
      );
      await invalidate();
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to delete timetable slot");
    }
  };

  const handleClearAll = async () => {
    if (!requireAdminEvent(adminEventId, "clear the timetable")) return;
    setIsClearing(true);
    try {
      await apiRequest(
        `/api/admin/timetable/all${adminEventId ? `?eventId=${adminEventId}` : ""}`,
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
      if (!requireAdminEvent(adminEventId, "reorder the timetable")) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setLocalItems((prev) => {
        const next = [...prev];
        const [moved] = next.splice(fromIdx, 1);
        next.splice(toIdx, 0, moved);
        const payload = next.map((it, i) => ({ id: it.id, sortOrder: i }));
        apiRequest(
          `/api/admin/timetable/reorder${adminEventId ? `?eventId=${adminEventId}` : ""}`,
          {
            method: "PUT",
            body: JSON.stringify({ items: payload }),
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

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      {isLoading ? (
        <ActivityIndicator
          style={{ marginTop: getScreenContentTopPadding(headerHeight, 40) }}
          color={AppColors.primary}
        />
      ) : (
        <ScrollView
          scrollEnabled={scrollEnabled}
          contentContainerStyle={{
            paddingHorizontal: Spacing.lg,
            paddingTop: Spacing.md,
            paddingBottom: insets.bottom + 100,
          }}
          showsVerticalScrollIndicator={false}
        >
          {localItems.length > 0 ? (
            <>
              {localItems.some(isStarterItem) ? (
                <View
                  style={[
                    styles.templateNotice,
                    {
                      backgroundColor: `${AppColors.accent}10`,
                      borderColor: `${AppColors.accent}35`,
                    },
                  ]}
                >
                  <Feather name="info" size={15} color={AppColors.accent} />
                  <ThemedText
                    style={[styles.templateNoticeText, { color: theme.text }]}
                  >
                    This is a starter timetable. Edit or delete the template
                    slots before publishing your programme.
                  </ThemedText>
                </View>
              ) : null}
              {localItems.map((item, index) => (
                <DraggableRow
                  key={item.id}
                  item={item}
                  index={index}
                  total={localItems.length}
                  activeIndexSV={activeIndexSV}
                  gestureYSV={gestureYSV}
                  setScrollEnabled={setScrollEnabled}
                  onDrop={handleDrop}
                  onEdit={(it) => {
                    setEditItem(it);
                    setShowForm(true);
                  }}
                  onDelete={handleDelete}
                  theme={theme}
                />
              ))}
            </>
          ) : (
            <View style={styles.empty}>
              <View
                style={[
                  styles.emptyIcon,
                  { backgroundColor: `${AppColors.primary}10` },
                ]}
              >
                <Feather name="clock" size={28} color={AppColors.primary} />
              </View>
              <ThemedText
                style={[styles.emptyText, { color: theme.textSecondary }]}
              >
                No timetable slots yet
              </ThemedText>
            </View>
          )}
        </ScrollView>
      )}

      <Pressable
        onPress={() => {
          if (!requireAdminEvent(adminEventId, "add a timetable slot")) return;
          setEditItem(null);
          setShowForm(true);
        }}
        style={[styles.fab, { bottom: insets.bottom + Spacing.xl }]}
        testID="button-add-slot"
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
        title="Clear All Slots"
        message={`This will permanently delete all ${localItems.length} timetable slot${localItems.length !== 1 ? "s" : ""}. This cannot be undone.`}
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
  templateNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  templateNoticeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
  },
  cardWrapper: {
    height: ITEM_HEIGHT,
    marginBottom: Spacing.sm,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  card: {
    flex: 1,
    flexDirection: "row",
    alignItems: "stretch",
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    overflow: "hidden",
  },
  dragHandle: {
    width: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRightWidth: 1,
  },
  timeBlock: {
    width: 68,
    paddingVertical: Spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    borderRightWidth: 1,
  },
  catIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 1,
  },
  timeText: { fontSize: 14, fontWeight: "800" },
  durationText: { fontSize: 10 },
  activityBlock: {
    flex: 1,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    justifyContent: "center",
  },
  activityTitle: { fontSize: 13, fontWeight: "600", marginBottom: 1 },
  activitySub: { fontSize: 11, marginBottom: 2 },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 1,
  },
  locationText: { fontSize: 10 },
  rowActions: {
    flexDirection: "column",
    gap: Spacing.xs,
    padding: Spacing.xs,
    justifyContent: "center",
  },
  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.sm,
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
  formRow: { flexDirection: "row" },
  catChip: {
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
});
