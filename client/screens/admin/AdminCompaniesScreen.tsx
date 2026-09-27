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
  Modal,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
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
import { ImagePickerField } from "@/components/ImagePickerField";
import type { Company } from "@shared/schema";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

const ITEM_HEIGHT = 78;
const CATEGORIES = [
  "Main Sponsor",
  "Master Partner",
  "Junior Partner",
  "Port of Twente Partner",
  "Other Partner",
];
const CAT_COLORS: Record<string, string> = {
  "Main Sponsor": "#B45309",
  "Master Partner": "#1D4ED8",
  "Junior Partner": "#047857",
  "Port of Twente Partner": "#7C3AED",
  "Other Partner": "#6B7280",
};

interface CompanyForm {
  name: string;
  category: string;
  description: string;
  logoUrl: string;
  websiteUrl: string;
}
const DEFAULT: CompanyForm = {
  name: "",
  category: "Junior Partner",
  description: "",
  logoUrl: "",
  websiteUrl: "",
};
const EMPTY_COMPANIES: Company[] = [];

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
        autoCapitalize="none"
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
  onSave: (f: CompanyForm) => void;
  item: Company | null;
  isSaving: boolean;
  theme: any;
}) {
  const [form, setForm] = useState<CompanyForm>(DEFAULT);
  React.useEffect(() => {
    if (visible)
      setForm(
        item
          ? {
              name: item.name,
              category: item.category,
              description: item.description || "",
              logoUrl: item.logoUrl || "",
              websiteUrl: item.websiteUrl || "",
            }
          : DEFAULT,
      );
  }, [visible, item]);
  const set = (k: keyof CompanyForm) => (v: string) =>
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
              {item ? "Edit Company" : "Add Company"}
            </ThemedText>
            <Pressable onPress={onClose} hitSlop={8}>
              <Feather name="x" size={22} color={theme.text} />
            </Pressable>
          </View>
          <ScrollView
            style={styles.sheetBody}
            showsVerticalScrollIndicator={false}
          >
            <Field
              label="Company Name *"
              value={form.name}
              onChange={set("name")}
              placeholder="ACME Corp"
              theme={theme}
            />
            <ThemedText
              style={[styles.fieldLabel, { color: theme.textSecondary }]}
            >
              Category *
            </ThemedText>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginBottom: Spacing.sm }}
            >
              <View style={{ flexDirection: "row", gap: Spacing.sm }}>
                {CATEGORIES.map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => set("category")(c)}
                    style={[
                      styles.catChip,
                      {
                        backgroundColor:
                          form.category === c
                            ? `${CAT_COLORS[c] || AppColors.primary}20`
                            : theme.backgroundSecondary,
                        borderColor:
                          form.category === c
                            ? CAT_COLORS[c] || AppColors.primary
                            : theme.border,
                      },
                    ]}
                  >
                    <ThemedText
                      style={{
                        fontSize: 12,
                        fontWeight: "600",
                        color:
                          form.category === c
                            ? CAT_COLORS[c] || AppColors.primary
                            : theme.textSecondary,
                      }}
                    >
                      {c}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
            <Field
              label="Description"
              value={form.description}
              onChange={set("description")}
              placeholder="Brief description…"
              multiline
              theme={theme}
            />
            <ImagePickerField
              label="Logo"
              value={form.logoUrl}
              onChange={set("logoUrl")}
              theme={theme}
            />
            <Field
              label="Website URL"
              value={form.websiteUrl}
              onChange={set("websiteUrl")}
              placeholder="https://example.com"
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
              testID="button-save-company"
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

function DraggableCompanyRow({
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
  item: Company;
  index: number;
  total: number;
  activeIndexSV: SharedValue<number>;
  gestureYSV: SharedValue<number>;
  setScrollEnabled: (value: boolean) => void;
  onDrop: (from: number, to: number) => void;
  onEdit: () => void;
  onDelete: () => void;
  theme: any;
}) {
  const color = CAT_COLORS[item.category] || "#6B7280";
  const dragGesture = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(500)
        .onBegin(() => {
          activeIndexSV.value = index;
          gestureYSV.value = 0;
          runOnJS(setScrollEnabled)(false);
          runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Medium);
        })
        .onUpdate((event) => {
          gestureYSV.value = event.translationY;
        })
        .onEnd(() => {
          const destination = Math.max(
            0,
            Math.min(
              total - 1,
              Math.round(index + gestureYSV.value / ITEM_HEIGHT),
            ),
          );
          if (destination !== index) runOnJS(onDrop)(index, destination);
        })
        .onFinalize(() => {
          activeIndexSV.value = -1;
          gestureYSV.value = 0;
          runOnJS(setScrollEnabled)(true);
        }),
    [activeIndexSV, gestureYSV, index, total, onDrop, setScrollEnabled],
  );

  const animatedStyle = useAnimatedStyle(() => {
    const active = activeIndexSV.value;
    if (active === index) {
      return {
        transform: [{ translateY: gestureYSV.value }, { scale: 1.03 }],
        zIndex: 100,
        opacity: 0.94,
      };
    }
    if (active < 0)
      return {
        transform: [{ translateY: withSpring(0) }],
        zIndex: 0,
        opacity: 1,
      };
    const destination = Math.max(
      0,
      Math.min(total - 1, Math.round(active + gestureYSV.value / ITEM_HEIGHT)),
    );
    let shift = 0;
    if (active < destination && index > active && index <= destination)
      shift = -ITEM_HEIGHT;
    if (active > destination && index < active && index >= destination)
      shift = ITEM_HEIGHT;
    return {
      transform: [{ translateY: withSpring(shift) }],
      zIndex: 0,
      opacity: 1,
    };
  });

  return (
    <Animated.View style={[styles.companyWrapper, animatedStyle]}>
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
            style={styles.dragHandle}
            testID={`drag-company-${item.id}`}
            pointerEvents="none"
          >
            <Feather name="menu" size={17} color={theme.textTertiary} />
          </View>
          {item.logoUrl ? (
            <Image
              source={{ uri: item.logoUrl }}
              style={styles.logoThumb}
              resizeMode="contain"
            />
          ) : (
            <View style={[styles.catIcon, { backgroundColor: `${color}14` }]}>
              <Feather name="briefcase" size={20} color={color} />
            </View>
          )}
          <View style={styles.cardInfo}>
            <ThemedText
              style={[styles.cardName, { color: theme.text }]}
              numberOfLines={1}
            >
              {item.name}
            </ThemedText>
            <View style={[styles.catBadge, { backgroundColor: `${color}12` }]}>
              <ThemedText style={[styles.catText, { color }]}>
                {item.category}
              </ThemedText>
            </View>
          </View>
          <View style={styles.actions}>
            <Pressable
              onPress={onEdit}
              style={[
                styles.actionBtn,
                { backgroundColor: `${AppColors.primary}12` },
              ]}
            >
              <Feather name="edit-2" size={15} color={AppColors.primary} />
            </Pressable>
            <Pressable
              onPress={onDelete}
              style={[
                styles.actionBtn,
                { backgroundColor: `${AppColors.error}12` },
              ]}
              testID={`button-delete-company-${item.id}`}
            >
              <Feather name="trash-2" size={15} color={AppColors.error} />
            </Pressable>
          </View>
        </View>
      </GestureDetector>
    </Animated.View>
  );
}

export default function AdminCompaniesScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const qc = useQueryClient();
  const { adminEventId } = useAdminEvent();

  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<Company | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showClearAll, setShowClearAll] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [localItems, setLocalItems] = useState<Company[]>([]);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const activeIndexSV = useSharedValue(-1);
  const gestureYSV = useSharedValue(0);

  const { data: companiesData, isLoading } = useQuery<Company[]>({
    queryKey: ["/api/admin/companies", adminEventId],
    queryFn: async () => {
      const res = await apiRequest(
        `/api/admin/companies${adminEventId ? `?eventId=${adminEventId}` : ""}`,
      );
      return res.json();
    },
    enabled: !!adminEventId,
  });
  const companies = companiesData ?? EMPTY_COMPANIES;

  useEffect(() => {
    setLocalItems(companies);
  }, [companies]);

  const filtered = useMemo(() => {
    if (!search.trim()) return localItems;
    const q = search.toLowerCase();
    return localItems.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q),
    );
  }, [localItems, search]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => {
            if (!requireAdminEvent(adminEventId, "clear companies")) return;
            setShowClearAll(true);
          }}
          style={{ paddingHorizontal: 16, paddingVertical: 8 }}
          testID="button-clear-all-companies"
        >
          <Feather name="trash-2" size={20} color={AppColors.error} />
        </Pressable>
      ),
    });
  }, [adminEventId, navigation]);

  const invalidate = () =>
    Promise.all([
      qc.invalidateQueries({
        queryKey: ["/api/admin/companies", adminEventId],
      }),
      qc.invalidateQueries({ queryKey: ["/api/admin/stats", adminEventId] }),
    ]);

  const handleSave = async (form: CompanyForm) => {
    if (
      !requireAdminEvent(
        adminEventId,
        editItem ? "edit this company" : "add a company",
      )
    )
      return;
    if (!form.name.trim() || !form.category.trim()) {
      Alert.alert("Error", "Name and category are required");
      return;
    }
    setIsSaving(true);
    try {
      if (editItem) {
        await apiRequest(
          `/api/admin/companies/${editItem.id}${adminEventId ? `?eventId=${adminEventId}` : ""}`,
          { method: "PUT", body: JSON.stringify(form) },
        );
      } else {
        await apiRequest("/api/admin/companies", {
          method: "POST",
          body: JSON.stringify({
            ...form,
            sortOrder: localItems.length,
            eventId: adminEventId,
          }),
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

  const handleDrop = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (!requireAdminEvent(adminEventId, "reorder companies")) return;
      setLocalItems((previous) => {
        const next = [...previous];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        apiRequest(
          `/api/admin/companies/reorder${adminEventId ? `?eventId=${adminEventId}` : ""}`,
          {
            method: "PUT",
            body: JSON.stringify({
              items: next.map((company, sortOrder) => ({
                id: company.id,
                sortOrder,
              })),
            }),
          },
        ).catch((error) => {
          Alert.alert("Order not saved", error?.message || "Please try again.");
          qc.invalidateQueries({
            queryKey: ["/api/admin/companies", adminEventId],
          });
        });
        return next;
      });
    },
    [adminEventId, qc],
  );

  const handleClearAll = async () => {
    if (!requireAdminEvent(adminEventId, "clear companies")) return;
    setIsClearing(true);
    try {
      await apiRequest(
        `/api/admin/companies/all${adminEventId ? `?eventId=${adminEventId}` : ""}`,
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

  const handleDelete = async (co: Company) => {
    if (!requireAdminEvent(adminEventId, "delete this company")) return;
    if (
      !(await confirmDestructive(
        "Delete Company",
        `Remove ${co.name}? All member associations will be removed.`,
      ))
    )
      return;
    try {
      await apiRequest(
        `/api/admin/companies/${co.id}${adminEventId ? `?eventId=${adminEventId}` : ""}`,
        { method: "DELETE" },
      );
      await invalidate();
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to delete company");
    }
  };

  const renderItem = ({ item }: { item: Company }) => {
    const color = CAT_COLORS[item.category] || "#6B7280";
    return (
      <View
        style={[
          styles.card,
          { backgroundColor: theme.cardBackground, borderColor: theme.border },
        ]}
      >
        {item.logoUrl ? (
          <Image
            source={{ uri: item.logoUrl }}
            style={styles.logoThumb}
            resizeMode="contain"
          />
        ) : (
          <View style={[styles.catIcon, { backgroundColor: `${color}14` }]}>
            <Feather name="briefcase" size={20} color={color} />
          </View>
        )}
        <View style={styles.cardInfo}>
          <ThemedText
            style={[styles.cardName, { color: theme.text }]}
            numberOfLines={1}
          >
            {item.name}
          </ThemedText>
          <View style={[styles.catBadge, { backgroundColor: `${color}12` }]}>
            <ThemedText style={[styles.catText, { color }]}>
              {item.category}
            </ThemedText>
          </View>
        </View>
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
            testID={`button-edit-company-${item.id}`}
          >
            <Feather name="edit-2" size={15} color={AppColors.primary} />
          </Pressable>
          <Pressable
            onPress={() => handleDelete(item)}
            style={[
              styles.actionBtn,
              { backgroundColor: `${AppColors.error}12` },
            ]}
            testID={`button-delete-company-${item.id}`}
          >
            <Feather name="trash-2" size={15} color={AppColors.error} />
          </Pressable>
        </View>
      </View>
    );
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
            placeholder="Search companies…"
            placeholderTextColor={theme.textSecondary}
            testID="input-search-companies"
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
      ) : search.trim() ? (
        <FlatList
          data={filtered}
          keyExtractor={(c) => c.id}
          renderItem={renderItem}
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
                <Feather name="briefcase" size={28} color={AppColors.primary} />
              </View>
              <ThemedText
                style={[styles.emptyText, { color: theme.textSecondary }]}
              >
                No companies found
              </ThemedText>
            </View>
          }
        />
      ) : (
        <ScrollView
          scrollEnabled={scrollEnabled}
          contentContainerStyle={{
            paddingHorizontal: Spacing.lg,
            paddingBottom: insets.bottom + 100,
          }}
        >
          {localItems.length ? (
            <>
              {localItems.map((item, index) => (
                <DraggableCompanyRow
                  key={item.id}
                  item={item}
                  index={index}
                  total={localItems.length}
                  activeIndexSV={activeIndexSV}
                  gestureYSV={gestureYSV}
                  setScrollEnabled={setScrollEnabled}
                  onDrop={handleDrop}
                  onEdit={() => {
                    setEditItem(item);
                    setShowForm(true);
                  }}
                  onDelete={() => handleDelete(item)}
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
                <Feather name="briefcase" size={28} color={AppColors.primary} />
              </View>
              <ThemedText
                style={[styles.emptyText, { color: theme.textSecondary }]}
              >
                No companies found
              </ThemedText>
            </View>
          )}
        </ScrollView>
      )}
      <Pressable
        onPress={() => {
          if (!requireAdminEvent(adminEventId, "add a company")) return;
          setEditItem(null);
          setShowForm(true);
        }}
        style={[styles.fab, { bottom: insets.bottom + Spacing.xl }]}
        testID="button-add-company"
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
        title="Clear All Companies"
        message={`This will permanently delete all ${companies.length} compan${companies.length !== 1 ? "ies" : "y"} and their member associations. This cannot be undone.`}
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
  companyWrapper: { height: ITEM_HEIGHT, marginBottom: Spacing.sm },
  dragHandle: {
    width: 32,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.sm,
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
  catIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.md,
    flexShrink: 0,
  },
  logoThumb: {
    width: 46,
    height: 46,
    borderRadius: 14,
    marginRight: Spacing.md,
    flexShrink: 0,
  },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 15, fontWeight: "600", marginBottom: 5 },
  catBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: BorderRadius.xs,
  },
  catText: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
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
