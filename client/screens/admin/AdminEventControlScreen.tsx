import React, { useRef, useState, useLayoutEffect } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  Modal,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Image,
  Switch,
  PanResponder,
} from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { apiRequest } from "@/lib/query-client";
import { useRefreshEventTheme } from "@/contexts/EventThemeContext";
import { useAdminEvent } from "@/contexts/AdminEventContext";
import {
  AppColors,
  BorderRadius,
  getEventGradientReadability,
  getReadableTextColor,
  Spacing,
  Shadows,
} from "@/constants/theme";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { ImagePickerField } from "@/components/ImagePickerField";
import { EventLogoImage } from "@/components/EventLogoImage";
import type { TimetableItem } from "@shared/schema";
import {
  EVENT_START_DATE_ERROR_MESSAGE,
  parseEventDate,
} from "@shared/event-date";

interface AppEvent {
  id: string;
  name: string;
  year: number;
  status: "draft" | "published" | "archived";
  startDate: string | null;
  endDate: string | null;
  scheduleStart: string | null;
  scheduleEnd: string | null;
  location: string | null;
  description: string | null;
  logoUrl: string | null;
  logoShape: "circle" | "square";
  logoZoom: number;
  logoOffsetX: number;
  logoOffsetY: number;
  primaryColor: string | null;
  accentColor: string | null;
  gradientStart: string | null;
  gradientEnd: string | null;
  tagline: string | null;
  displayDate: string | null;
  showYearOnLogin: boolean;
  lastPublishedAt: string | null;
}

const STATUS_CONFIG = {
  published: {
    label: "Live",
    color: "#059669",
    bg: "#D1FAE5",
    icon: "radio" as const,
  },
  draft: {
    label: "Draft",
    color: "#D97706",
    bg: "#FEF3C7",
    icon: "edit-3" as const,
  },
  archived: {
    label: "Past",
    color: "#6B7280",
    bg: "#F3F4F6",
    icon: "archive" as const,
  },
};

const PUBLISH_RETRY_DELAYS_MS = [0, 1000, 2500];

function isTransientRequestError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /network unavailable|request timed out|failed to fetch|network request failed/i.test(
      error.message,
    )
  );
}

async function publishEventWithRecovery(
  eventId: string,
  confirmStarterTimetable: boolean,
): Promise<void> {
  let lastError: unknown;

  for (const delayMs of PUBLISH_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    try {
      await apiRequest(`/api/admin/events/${eventId}/publish`, {
        method: "POST",
        ...(confirmStarterTimetable
          ? { body: JSON.stringify({ confirmStarterTimetable: true }) }
          : {}),
      });
      return;
    } catch (error) {
      lastError = error;
      if (!isTransientRequestError(error)) throw error;
    }
  }

  // The publish may have committed even if the response was lost. Confirm the
  // server's state before showing an error or asking the admin to retry.
  try {
    const response = await apiRequest("/api/admin/events");
    const events = (await response.json()) as AppEvent[];
    if (
      events.some(
        (candidate) =>
          candidate.id === eventId && candidate.status === "published",
      )
    ) {
      return;
    }
  } catch {
    // Preserve the original network error; the verification request was also
    // unable to reach the server.
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Publishing could not be completed. Please try again.");
}

interface EventFormData {
  name: string;
  year: string;
  startDate: string;
  endDate: string;
  scheduleStart: string;
  scheduleEnd: string;
  location: string;
  description: string;
}

interface AppearanceFormData {
  logoUrl: string;
  logoShape: "circle" | "square";
  logoZoom: number;
  logoOffsetX: number;
  logoOffsetY: number;
  displayDate: string;
  tagline: string;
  primaryColor: string;
  accentColor: string;
  gradientStart: string;
  gradientEnd: string;
  showYearOnLogin: boolean;
}

type AppearanceColorField =
  | "primaryColor"
  | "accentColor"
  | "gradientStart"
  | "gradientEnd";

const DEFAULT_FORM: EventFormData = {
  name: "",
  year: String(new Date().getFullYear() + 1),
  startDate: "",
  endDate: "",
  scheduleStart: "",
  scheduleEnd: "",
  location: "",
  description: "",
};

const COLOR_PALETTE = [
  "#0c0057",
  "#1D4ED8",
  "#4F46E5",
  "#7C3AED",
  "#BE185D",
  "#DC2626",
  "#D97706",
  "#f78f1e",
  "#059669",
  "#0D9488",
  "#0EA5E9",
  "#374151",
];
const TAGLINE_MAX_LENGTH = 300;

function isValidHex(color: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(color.trim());
}

function getEventDisplayName(name: string, year: number | null): string {
  if (!year) return name;
  return (
    name
      .trim()
      .replace(new RegExp(`(?:\\s|-)?${year}$`), "")
      .trim() || name
  );
}

function validateScheduleHours(start: string, end: string): string | null {
  const normalizedStart = start.trim();
  const normalizedEnd = end.trim();
  if (!normalizedStart && !normalizedEnd) return null;
  if (!normalizedStart || !normalizedEnd) {
    return "Enter both schedule times, for example 09:00 and 20:00.";
  }
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!timePattern.test(normalizedStart) || !timePattern.test(normalizedEnd)) {
    return "Use 24-hour HH:MM format, for example 09:00 or 20:00.";
  }
  if (normalizedStart >= normalizedEnd) {
    return "Schedule end time must be later than the start time.";
  }
  return null;
}

function validateEventStartDate(
  value: string,
  eventYear: number,
): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  return parseEventDate(normalized, eventYear)
    ? null
    : EVENT_START_DATE_ERROR_MESSAGE;
}

function ColorPicker({
  label,
  value,
  onChange,
  theme,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  theme: any;
}) {
  const [customMode, setCustomMode] = React.useState(
    () => !!value && !COLOR_PALETTE.includes(value),
  );

  React.useEffect(() => {
    if (value && !COLOR_PALETTE.includes(value)) setCustomMode(true);
  }, [value]);

  const handlePreset = (hex: string) => {
    onChange(hex);
    setCustomMode(false);
  };
  const handleCustom = () => {
    setCustomMode(true);
    if (COLOR_PALETTE.includes(value)) onChange("");
  };

  const isValid = isValidHex(value) || value === "";
  const preview = isValidHex(value) ? value : "#e5e7eb";

  return (
    <View style={{ marginBottom: Spacing.lg }}>
      <View style={styles.cpHeader}>
        <View
          style={[
            styles.cpPreview,
            { backgroundColor: preview, borderColor: theme.border },
          ]}
        />
        <ThemedText style={[styles.cpLabel, { color: theme.textSecondary }]}>
          {label}
        </ThemedText>
      </View>
      <View style={styles.swatchGrid}>
        {COLOR_PALETTE.map((hex) => (
          <Pressable
            key={hex}
            onPress={() => handlePreset(hex)}
            style={[
              styles.swatch,
              { backgroundColor: hex },
              value === hex && styles.swatchActive,
            ]}
          >
            {value === hex ? (
              <Feather name="check" size={13} color="#fff" />
            ) : null}
          </Pressable>
        ))}
        <Pressable
          onPress={handleCustom}
          style={[
            styles.swatch,
            styles.swatchCustom,
            {
              borderColor: theme.border,
              backgroundColor:
                customMode && !COLOR_PALETTE.includes(value)
                  ? theme.backgroundTertiary
                  : theme.backgroundSecondary,
            },
            customMode && !COLOR_PALETTE.includes(value) && styles.swatchActive,
          ]}
        >
          <Feather name="sliders" size={12} color={theme.textSecondary} />
        </Pressable>
      </View>
      {customMode ? (
        <TextInput
          style={[
            styles.colorInput,
            {
              backgroundColor: theme.backgroundSecondary,
              color: theme.text,
              borderColor: isValid ? theme.border : AppColors.error,
              marginTop: Spacing.sm,
            },
          ]}
          value={value}
          onChangeText={onChange}
          placeholder="#0c0057"
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
        />
      ) : null}
    </View>
  );
}

function LiveAppPreview({
  event,
  form,
  theme,
}: {
  event: AppEvent;
  form: AppearanceFormData;
  theme: any;
}) {
  const [screen, setScreen] = useState<"login" | "home">("login");
  const primary = isValidHex(form.primaryColor) ? form.primaryColor : "#0c0057";
  const accent = isValidHex(form.accentColor) ? form.accentColor : "#f78f1e";
  const accentTextColor = getReadableTextColor(accent);
  const gradientStart = isValidHex(form.gradientStart)
    ? form.gradientStart
    : "#0c0057";
  const gradientEnd = isValidHex(form.gradientEnd)
    ? form.gradientEnd
    : "#1a0a7a";
  const gradientReadability = getEventGradientReadability(
    gradientStart,
    gradientEnd,
  );
  const eventDate = form.displayDate.trim();
  const eventName = getEventDisplayName(event.name, event.year);
  const schedule =
    event.scheduleStart && event.scheduleEnd
      ? `${event.scheduleStart} – ${event.scheduleEnd}`
      : "Schedule to be announced";

  return (
    <View
      style={[
        styles.livePreviewCard,
        {
          backgroundColor: theme.backgroundSecondary,
          borderColor: theme.border,
        },
      ]}
    >
      <View style={styles.livePreviewHeader}>
        <View style={{ flex: 1 }}>
          <ThemedText style={[styles.livePreviewTitle, { color: theme.text }]}>
            Live app preview
          </ThemedText>
          <ThemedText
            style={[styles.livePreviewHint, { color: theme.textSecondary }]}
          >
            This is how the saved appearance will look to attendees.
          </ThemedText>
        </View>
        <View
          style={[styles.previewLiveBadge, { backgroundColor: `${accent}18` }]}
        >
          <View style={[styles.previewLiveDot, { backgroundColor: accent }]} />
          <ThemedText
            style={{ color: accent, fontSize: 10, fontWeight: "800" }}
          >
            LIVE
          </ThemedText>
        </View>
      </View>

      <View
        style={[
          styles.previewTabs,
          { backgroundColor: theme.cardBackground, borderColor: theme.border },
        ]}
      >
        {(["login", "home"] as const).map((tab) => (
          <Pressable
            key={tab}
            onPress={() => setScreen(tab)}
            style={[
              styles.previewTab,
              screen === tab && { backgroundColor: primary },
            ]}
          >
            <Feather
              name={tab === "login" ? "log-in" : "home"}
              size={13}
              color={screen === tab ? "#fff" : theme.textSecondary}
            />
            <ThemedText
              style={{
                color: screen === tab ? "#fff" : theme.textSecondary,
                fontSize: 12,
                fontWeight: "700",
              }}
            >
              {tab === "login" ? "Login screen" : "Home screen"}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      <View style={styles.previewDevice}>
        {screen === "login" ? (
          <LinearGradient
            colors={[gradientStart, gradientEnd]}
            style={styles.previewLoginScreen}
          >
            <View
              pointerEvents="none"
              style={[
                styles.previewGradientOverlay,
                { backgroundColor: gradientReadability.overlay },
              ]}
            />
            <View style={styles.previewLoginGlow} />
            <View style={styles.previewBrandBlock}>
              {form.logoUrl.trim() ? (
                <EventLogoImage
                  imageTestID="appearance-preview-login-image"
                  uri={form.logoUrl.trim()}
                  shape={form.logoShape}
                  zoom={form.logoZoom}
                  offsetX={form.logoOffsetX}
                  offsetY={form.logoOffsetY}
                  maxWidth={112}
                  maxHeight={62}
                  frameStyle={styles.previewEventLogo}
                />
              ) : null}
              <ThemedText
                style={[
                  styles.previewEventName,
                  { color: gradientReadability.foreground },
                ]}
                numberOfLines={2}
              >
                {eventName}
              </ThemedText>
              {form.showYearOnLogin ? (
                <ThemedText
                  style={[
                    styles.previewEventYear,
                    { color: gradientReadability.mutedForeground },
                  ]}
                >
                  {event.year}
                </ThemedText>
              ) : null}
              {eventDate ? (
                <ThemedText
                  style={[styles.previewDate, { color: `${accent}ff` }]}
                >
                  {eventDate}
                </ThemedText>
              ) : null}
            </View>
            <View style={styles.previewLoginForm}>
              <View style={styles.previewInput}>
                <Feather name="mail" size={13} color="#8b91a7" />
                <ThemedText style={styles.previewPlaceholder}>
                  Email address
                </ThemedText>
              </View>
              <View style={[styles.previewButton, { backgroundColor: accent }]}>
                <ThemedText
                  style={[styles.previewButtonText, { color: accentTextColor }]}
                >
                  Continue
                </ThemedText>
                <Feather name="arrow-right" size={13} color={accentTextColor} />
              </View>
            </View>
          </LinearGradient>
        ) : (
          <View
            style={[
              styles.previewHomeScreen,
              { backgroundColor: theme.cardBackground },
            ]}
          >
            <LinearGradient
              colors={[gradientStart, gradientEnd]}
              style={styles.previewHomeHero}
            >
              <View
                pointerEvents="none"
                style={[
                  styles.previewGradientOverlay,
                  { backgroundColor: gradientReadability.overlay },
                ]}
              />
              <View style={styles.previewHomeTopRow}>
                <View style={styles.previewMiniLogo}>
                  {form.logoUrl.trim() ? (
                    <EventLogoImage
                      imageTestID="appearance-preview-home-image"
                      uri={form.logoUrl.trim()}
                      shape={form.logoShape}
                      zoom={form.logoZoom}
                      offsetX={form.logoOffsetX}
                      offsetY={form.logoOffsetY}
                      maxWidth={28}
                      maxHeight={28}
                    />
                  ) : null}
                </View>
                <Feather name="bell" size={16} color="#ffffffdd" />
              </View>
              <ThemedText
                style={[
                  styles.previewWelcome,
                  { color: gradientReadability.mutedForeground },
                ]}
              >
                Welcome to
              </ThemedText>
              <ThemedText
                style={[
                  styles.previewHomeTitle,
                  { color: gradientReadability.foreground },
                ]}
                numberOfLines={2}
              >
                {event.name}
              </ThemedText>
              <ThemedText style={[styles.previewHomeDate, { color: accent }]}>
                {eventDate}
              </ThemedText>
            </LinearGradient>
            <View style={styles.previewHomeBody}>
              <ThemedText
                style={[styles.previewSectionTitle, { color: theme.text }]}
              >
                Today at a glance
              </ThemedText>
              <View style={styles.previewHomeCards}>
                <View
                  style={[
                    styles.previewHomeCard,
                    { backgroundColor: `${primary}12` },
                  ]}
                >
                  <Feather name="calendar" size={15} color={primary} />
                  <ThemedText
                    style={[styles.previewHomeCardText, { color: primary }]}
                  >
                    Schedule
                  </ThemedText>
                </View>
                <View
                  style={[
                    styles.previewHomeCard,
                    { backgroundColor: `${accent}18` },
                  ]}
                >
                  <Feather name="users" size={15} color={accent} />
                  <ThemedText
                    style={[styles.previewHomeCardText, { color: accent }]}
                  >
                    Attendees
                  </ThemedText>
                </View>
              </View>
              <View
                style={[
                  styles.previewSessionCard,
                  { borderColor: theme.border },
                ]}
              >
                <View
                  style={[
                    styles.previewTimePill,
                    { backgroundColor: `${accent}22` },
                  ]}
                >
                  <ThemedText
                    style={{ color: accent, fontSize: 10, fontWeight: "800" }}
                  >
                    {schedule}
                  </ThemedText>
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText
                    style={[styles.previewSessionTitle, { color: theme.text }]}
                  >
                    Opening keynote
                  </ThemedText>
                  <ThemedText
                    style={{ color: theme.textSecondary, fontSize: 10 }}
                  >
                    Main auditorium
                  </ThemedText>
                </View>
              </View>
            </View>
            <View
              style={[
                styles.previewBottomNav,
                { borderTopColor: theme.border },
              ]}
            >
              {["home", "calendar", "users", "menu"].map((icon, index) => (
                <Feather
                  key={icon}
                  name={icon as any}
                  size={15}
                  color={index === 0 ? primary : theme.textTertiary}
                />
              ))}
            </View>
          </View>
        )}
      </View>
      {gradientReadability.adjusted ? (
        <View
          style={[styles.gradientSafetyNote, { borderColor: theme.border }]}
        >
          <Feather name="eye" size={14} color={theme.textSecondary} />
          <ThemedText
            style={[styles.gradientSafetyText, { color: theme.textSecondary }]}
          >
            Your saved gradient is shown as-is. A readability overlay and
            contrasting text are added for light or mixed colors.
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

function LogoFramingEditor({
  uri,
  shape,
  zoom,
  offsetX,
  offsetY,
  onZoomChange,
  onPositionChange,
  theme,
}: {
  uri: string;
  shape: "circle" | "square";
  zoom: number;
  offsetX: number;
  offsetY: number;
  onZoomChange: (zoom: number) => void;
  onPositionChange: (x: number, y: number) => void;
  theme: any;
}) {
  const dragStart = useRef({ x: offsetX, y: offsetY });
  const latestValues = useRef({ offsetX, offsetY, onPositionChange });
  latestValues.current = { offsetX, offsetY, onPositionChange };
  const panResponder = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          dragStart.current = {
            x: latestValues.current.offsetX,
            y: latestValues.current.offsetY,
          };
        },
        onPanResponderMove: (_, gesture) => {
          latestValues.current.onPositionChange(
            Math.max(
              -80,
              Math.min(80, Math.round(dragStart.current.x + gesture.dx)),
            ),
            Math.max(
              -80,
              Math.min(80, Math.round(dragStart.current.y + gesture.dy)),
            ),
          );
        },
      }),
    [],
  );
  return (
    <View
      style={[
        styles.logoEditorSection,
        {
          backgroundColor: theme.backgroundSecondary,
          borderColor: theme.border,
        },
      ]}
    >
      <View style={styles.logoEditorHeading}>
        <View style={{ flex: 1 }}>
          <ThemedText style={[styles.logoEditorTitle, { color: theme.text }]}>
            Adjust logo framing
          </ThemedText>
          <ThemedText
            style={[styles.logoEditorHint, { color: theme.textSecondary }]}
          >
            Drag the logo to move it. Use the controls to zoom, then save.
          </ThemedText>
        </View>
        <Feather name="move" size={18} color={theme.primary} />
      </View>
      <EventLogoImage
        imageTestID="appearance-editor-image"
        uri={uri}
        shape={shape}
        zoom={zoom}
        offsetX={offsetX}
        offsetY={offsetY}
        maxWidth={220}
        maxHeight={180}
        frameTestID="appearance-editor-frame"
        panHandlers={panResponder.panHandlers}
        frameStyle={[
          styles.logoEditorCanvas,
          {
            backgroundColor: theme.backgroundSecondary,
            borderColor: theme.primary,
            borderRadius: shape === "circle" ? 999 : BorderRadius.lg,
          },
        ]}
      >
        <View
          pointerEvents="none"
          style={[
            styles.logoEditorCanvasBorder,
            {
              borderColor: theme.primary,
              borderRadius: shape === "circle" ? 999 : BorderRadius.lg,
            },
          ]}
        />
        <View
          pointerEvents="none"
          style={[
            styles.logoEditorGuide,
            {
              borderColor: `${theme.primary}99`,
              borderRadius: shape === "circle" ? 999 : BorderRadius.lg,
            },
          ]}
        />
      </EventLogoImage>
      <View style={styles.logoEditorControls}>
        <Pressable
          onPress={() => onZoomChange(Math.max(50, zoom - 10))}
          style={[styles.logoEditorControl, { borderColor: theme.border }]}
          accessibilityLabel="Zoom logo out"
          testID="button-logo-zoom-out"
        >
          <Feather name="minus" size={16} color={theme.text} />
        </Pressable>
        <ThemedText style={[styles.logoEditorZoom, { color: theme.text }]}>
          {zoom}%
        </ThemedText>
        <Pressable
          onPress={() => onZoomChange(Math.min(250, zoom + 10))}
          style={[styles.logoEditorControl, { borderColor: theme.border }]}
          accessibilityLabel="Zoom logo in"
          testID="button-logo-zoom-in"
        >
          <Feather name="plus" size={16} color={theme.text} />
        </Pressable>
        <Pressable
          onPress={() => {
            onZoomChange(100);
            onPositionChange(0, 0);
          }}
          style={[styles.logoEditorReset, { borderColor: theme.border }]}
        >
          <ThemedText style={{ color: theme.textSecondary, fontSize: 12 }}>
            Reset
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

function CreateEventModal({
  visible,
  onClose,
  theme,
}: {
  visible: boolean;
  onClose: () => void;
  theme: any;
}) {
  const queryClient = useQueryClient();
  const { refreshEvents } = useAdminEvent();
  const [form, setForm] = useState<EventFormData>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  React.useEffect(() => {
    if (visible) {
      setForm(DEFAULT_FORM);
      setError("");
    }
  }, [visible]);

  const set = (k: keyof EventFormData, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError("Event name is required");
      return;
    }
    const year = parseInt(form.year);
    if (!year || year < 2020) {
      setError("Enter a valid year (e.g. 2027)");
      return;
    }
    const startDateError = validateEventStartDate(form.startDate, year);
    if (startDateError) {
      setError(startDateError);
      return;
    }
    const scheduleError = validateScheduleHours(
      form.scheduleStart,
      form.scheduleEnd,
    );
    if (scheduleError) {
      setError(scheduleError);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await apiRequest("/api/admin/events", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          year,
          startDate: form.startDate || null,
          endDate: form.endDate || null,
          scheduleStart: form.scheduleStart.trim() || null,
          scheduleEnd: form.scheduleEnd.trim() || null,
          location: form.location || null,
          description: form.description || null,
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/events"] });
      await refreshEvents();
      onClose();
    } catch (e: any) {
      setError(e.message || "Failed to create event");
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
        <View
          style={[styles.modalCard, { backgroundColor: theme.cardBackground }]}
        >
          <View style={styles.modalHeader}>
            <ThemedText type="h4">New Event Year</ThemedText>
            <Pressable onPress={onClose} hitSlop={8}>
              <Feather name="x" size={22} color={theme.text} />
            </Pressable>
          </View>
          {error ? (
            <View style={styles.errorBox}>
              <Feather name="alert-circle" size={15} color={AppColors.error} />
              <ThemedText
                style={{ color: AppColors.error, fontSize: 13, flex: 1 }}
              >
                {error}
              </ThemedText>
            </View>
          ) : null}
          <ScrollView
            style={styles.modalBody}
            showsVerticalScrollIndicator={false}
          >
            <ThemedText
              style={[styles.fieldLabel, { color: theme.textSecondary }]}
            >
              Event Name *
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
              placeholder="e.g. Stress Congress 2027"
              placeholderTextColor={theme.textSecondary}
              testID="input-event-name"
            />
            <ThemedText
              style={[styles.fieldLabel, { color: theme.textSecondary }]}
            >
              Year *
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
              value={form.year}
              onChangeText={(v) => set("year", v)}
              keyboardType="numeric"
              placeholder="2027"
              placeholderTextColor={theme.textSecondary}
              testID="input-event-year"
            />
            <ThemedText
              style={[styles.fieldLabel, { color: theme.textSecondary }]}
            >
              Start Date
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
              value={form.startDate}
              onChangeText={(v) => set("startDate", v)}
              placeholder="e.g. 3/3, March 3, or March 3, 2027"
              placeholderTextColor={theme.textSecondary}
            />
            <ThemedText
              style={[styles.fieldLabel, { color: theme.textSecondary }]}
            >
              End Date
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
              value={form.endDate}
              onChangeText={(v) => set("endDate", v)}
              placeholder="e.g. March 4, 2027"
              placeholderTextColor={theme.textSecondary}
            />
            <View style={styles.scheduleRow}>
              <View style={styles.scheduleField}>
                <ThemedText
                  style={[styles.fieldLabel, { color: theme.textSecondary }]}
                >
                  Schedule starts
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
                  value={form.scheduleStart}
                  onChangeText={(v) => set("scheduleStart", v)}
                  placeholder="09:00"
                  placeholderTextColor={theme.textSecondary}
                  maxLength={5}
                  keyboardType="numbers-and-punctuation"
                />
              </View>
              <View style={styles.scheduleField}>
                <ThemedText
                  style={[styles.fieldLabel, { color: theme.textSecondary }]}
                >
                  Schedule ends
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
                  value={form.scheduleEnd}
                  onChangeText={(v) => set("scheduleEnd", v)}
                  placeholder="20:00"
                  placeholderTextColor={theme.textSecondary}
                  maxLength={5}
                  keyboardType="numbers-and-punctuation"
                />
              </View>
            </View>
            <ThemedText
              style={[styles.fieldLabel, { color: theme.textSecondary }]}
            >
              Location
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
              value={form.location}
              onChangeText={(v) => set("location", v)}
              placeholder="e.g. Amsterdam, Netherlands"
              placeholderTextColor={theme.textSecondary}
            />
            <ThemedText
              style={[styles.fieldLabel, { color: theme.textSecondary }]}
            >
              Description
            </ThemedText>
            <TextInput
              style={[
                styles.input,
                styles.textArea,
                {
                  backgroundColor: theme.backgroundSecondary,
                  color: theme.text,
                  borderColor: theme.border,
                },
              ]}
              value={form.description}
              onChangeText={(v) => set("description", v)}
              placeholder="Brief description of the event…"
              placeholderTextColor={theme.textSecondary}
              multiline
              numberOfLines={3}
            />
          </ScrollView>
          <View style={styles.modalFooter}>
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
              onPress={handleSave}
              disabled={saving}
              style={[styles.btn, { backgroundColor: AppColors.primary }]}
              testID="button-create-event"
            >
              {saving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <ThemedText style={{ color: "#fff", fontWeight: "700" }}>
                  Create Event
                </ThemedText>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function EditDetailsModal({
  event,
  onClose,
  theme,
}: {
  event: AppEvent | null;
  onClose: () => void;
  theme: any;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<EventFormData>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  React.useEffect(() => {
    if (event) {
      setForm({
        name: event.name || "",
        year: String(event.year || ""),
        startDate: event.startDate || "",
        endDate: event.endDate || "",
        scheduleStart: event.scheduleStart || "",
        scheduleEnd: event.scheduleEnd || "",
        location: event.location || "",
        description: event.description || "",
      });
      setError("");
    }
  }, [event]);

  const set = (k: keyof EventFormData, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!event) return;
    if (!form.name.trim()) {
      setError("Event name is required");
      return;
    }
    const year = parseInt(form.year);
    if (!year || year < 2020) {
      setError("Enter a valid year (e.g. 2027)");
      return;
    }
    const startDateError = validateEventStartDate(form.startDate, year);
    if (startDateError) {
      setError(startDateError);
      return;
    }
    const scheduleError = validateScheduleHours(
      form.scheduleStart,
      form.scheduleEnd,
    );
    if (scheduleError) {
      setError(scheduleError);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await apiRequest(`/api/admin/events/${event.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: form.name.trim(),
          year,
          startDate: form.startDate.trim() || null,
          endDate: form.endDate.trim() || null,
          scheduleStart: form.scheduleStart.trim() || null,
          scheduleEnd: form.scheduleEnd.trim() || null,
          // The public login/home badge follows the primary event start date.
          displayDate: form.startDate.trim() || null,
          location: form.location.trim() || null,
          description: form.description.trim() || null,
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/events"] });
      onClose();
    } catch (e: any) {
      setError(e.message || "Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={!!event}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View
          style={[styles.modalCard, { backgroundColor: theme.cardBackground }]}
        >
          <View style={styles.modalHeader}>
            <ThemedText type="h4">Edit Event Details</ThemedText>
            <Pressable onPress={onClose} hitSlop={8}>
              <Feather name="x" size={22} color={theme.text} />
            </Pressable>
          </View>
          {error ? (
            <View style={styles.errorBox}>
              <Feather name="alert-circle" size={15} color={AppColors.error} />
              <ThemedText
                style={{ color: AppColors.error, fontSize: 13, flex: 1 }}
              >
                {error}
              </ThemedText>
            </View>
          ) : null}
          <ScrollView
            style={styles.modalBody}
            showsVerticalScrollIndicator={false}
          >
            <ThemedText
              style={[styles.fieldLabel, { color: theme.textSecondary }]}
            >
              Event Name *
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
              placeholder="e.g. Stress Congress 2027"
              placeholderTextColor={theme.textSecondary}
              testID="input-edit-event-name"
            />
            <ThemedText
              style={[styles.fieldLabel, { color: theme.textSecondary }]}
            >
              Year *
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
              value={form.year}
              onChangeText={(v) => set("year", v)}
              keyboardType="numeric"
              placeholder="2027"
              placeholderTextColor={theme.textSecondary}
              testID="input-edit-event-year"
            />
            <ThemedText
              style={[styles.fieldLabel, { color: theme.textSecondary }]}
            >
              Start Date
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
              value={form.startDate}
              onChangeText={(v) => set("startDate", v)}
              placeholder="e.g. 3/3, March 3, or March 3, 2027"
              placeholderTextColor={theme.textSecondary}
            />
            <ThemedText
              style={[styles.fieldLabel, { color: theme.textSecondary }]}
            >
              End Date
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
              value={form.endDate}
              onChangeText={(v) => set("endDate", v)}
              placeholder="e.g. March 4, 2027"
              placeholderTextColor={theme.textSecondary}
            />
            <View style={styles.scheduleRow}>
              <View style={styles.scheduleField}>
                <ThemedText
                  style={[styles.fieldLabel, { color: theme.textSecondary }]}
                >
                  Schedule starts
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
                  value={form.scheduleStart}
                  onChangeText={(v) => set("scheduleStart", v)}
                  placeholder="09:00"
                  placeholderTextColor={theme.textSecondary}
                  maxLength={5}
                  keyboardType="numbers-and-punctuation"
                />
              </View>
              <View style={styles.scheduleField}>
                <ThemedText
                  style={[styles.fieldLabel, { color: theme.textSecondary }]}
                >
                  Schedule ends
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
                  value={form.scheduleEnd}
                  onChangeText={(v) => set("scheduleEnd", v)}
                  placeholder="20:00"
                  placeholderTextColor={theme.textSecondary}
                  maxLength={5}
                  keyboardType="numbers-and-punctuation"
                />
              </View>
            </View>
            <ThemedText
              style={[styles.fieldLabel, { color: theme.textSecondary }]}
            >
              Location
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
              value={form.location}
              onChangeText={(v) => set("location", v)}
              placeholder="e.g. Amsterdam, Netherlands"
              placeholderTextColor={theme.textSecondary}
            />
            <ThemedText
              style={[styles.fieldLabel, { color: theme.textSecondary }]}
            >
              Description
            </ThemedText>
            <TextInput
              style={[
                styles.input,
                styles.textArea,
                {
                  backgroundColor: theme.backgroundSecondary,
                  color: theme.text,
                  borderColor: theme.border,
                },
              ]}
              value={form.description}
              onChangeText={(v) => set("description", v)}
              placeholder="Brief description of the event…"
              placeholderTextColor={theme.textSecondary}
              multiline
              numberOfLines={3}
            />
          </ScrollView>
          <View style={styles.modalFooter}>
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
              onPress={handleSave}
              disabled={saving}
              style={[styles.btn, { backgroundColor: AppColors.primary }]}
              testID="button-save-event-details"
            >
              {saving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <ThemedText style={{ color: "#fff", fontWeight: "700" }}>
                  Save Changes
                </ThemedText>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function AppearanceModal({
  event,
  onClose,
  theme,
}: {
  event: AppEvent | null;
  onClose: () => void;
  theme: any;
}) {
  const queryClient = useQueryClient();
  const refreshTheme = useRefreshEventTheme();
  const [form, setForm] = useState<AppearanceFormData>({
    logoUrl: "",
    logoShape: "square",
    logoZoom: 100,
    logoOffsetX: 0,
    logoOffsetY: 0,
    displayDate: "",
    tagline: "",
    showYearOnLogin: true,
    primaryColor: "#0c0057",
    accentColor: "#f78f1e",
    gradientStart: "#0c0057",
    gradientEnd: "#1a0a7a",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  React.useEffect(() => {
    if (event) {
      setForm({
        logoUrl: event.logoUrl || "",
        logoShape: event.logoShape === "circle" ? "circle" : "square",
        logoZoom: event.logoZoom ?? 100,
        logoOffsetX: event.logoOffsetX ?? 0,
        logoOffsetY: event.logoOffsetY ?? 0,
        displayDate: event.displayDate || "",
        tagline: event.tagline || "",
        showYearOnLogin: event.showYearOnLogin !== false,
        primaryColor: event.primaryColor || "#0c0057",
        accentColor: event.accentColor || "#f78f1e",
        gradientStart: event.gradientStart || "#0c0057",
        gradientEnd: event.gradientEnd || "#1a0a7a",
      });
      setError("");
      setSaved(false);
    }
  }, [event]);

  const set = (k: keyof AppearanceFormData, v: string | boolean | number) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!event) return;
    // Validate colors
    const colorFields: AppearanceColorField[] = [
      "primaryColor",
      "accentColor",
      "gradientStart",
      "gradientEnd",
    ];
    for (const field of colorFields) {
      const val = form[field].trim();
      if (val && !isValidHex(val)) {
        setError(`Invalid hex color for ${field}. Use format: #RRGGBB`);
        return;
      }
    }
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      await apiRequest(`/api/admin/events/${event.id}`, {
        method: "PUT",
        body: JSON.stringify({
          logoUrl: form.logoUrl.trim() || null,
          logoShape: form.logoShape,
          logoZoom: form.logoZoom,
          logoOffsetX: form.logoOffsetX,
          logoOffsetY: form.logoOffsetY,
          displayDate: form.displayDate.trim() || null,
          tagline: form.tagline.trim() || null,
          showYearOnLogin: form.showYearOnLogin,
          primaryColor: form.primaryColor.trim() || "#0c0057",
          accentColor: form.accentColor.trim() || "#f78f1e",
          gradientStart: form.gradientStart.trim() || "#0c0057",
          gradientEnd: form.gradientEnd.trim() || "#1a0a7a",
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/events"] });
      // If this is the published event, refresh the app theme immediately
      if (event.status === "published") {
        await refreshTheme();
      }
      setSaved(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => {
        setSaved(false);
        onClose();
      }, 1200);
    } catch (e: any) {
      setError(e.message || "Failed to save appearance");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={!!event}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View
          style={[styles.modalCard, { backgroundColor: theme.cardBackground }]}
        >
          <View style={styles.modalHeader}>
            <View>
              <ThemedText type="h4">Appearance</ThemedText>
              <ThemedText
                style={{
                  fontSize: 12,
                  color: theme.textSecondary,
                  marginTop: 2,
                }}
              >
                {event?.name}
              </ThemedText>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              accessibilityLabel="Close appearance editor"
              testID="button-close-appearance"
            >
              <Feather name="x" size={22} color={theme.text} />
            </Pressable>
          </View>
          <ScrollView
            style={styles.modalBody}
            showsVerticalScrollIndicator={false}
          >
            <View
              style={[
                styles.infoBox,
                { backgroundColor: `${AppColors.primary}10` },
              ]}
            >
              <Feather name="info" size={14} color={AppColors.primary} />
              <ThemedText
                style={{
                  fontSize: 12,
                  color: AppColors.primary,
                  flex: 1,
                  lineHeight: 18,
                }}
              >
                These settings control the login screen and home screen
                appearance for this event year.
                {event?.status === "published"
                  ? " Changes apply immediately since this event is Live."
                  : ""}
              </ThemedText>
            </View>

            <ImagePickerField
              label="Event Logo"
              value={form.logoUrl}
              onChange={(v) => set("logoUrl", v)}
              theme={theme}
              shape={form.logoShape}
              allowShapeSelection
              preserveAspectRatio
              onShapeChange={(shape) => set("logoShape", shape)}
            />
            {form.logoUrl.trim() ? (
              <LogoFramingEditor
                uri={form.logoUrl.trim()}
                shape={form.logoShape}
                zoom={form.logoZoom}
                offsetX={form.logoOffsetX}
                offsetY={form.logoOffsetY}
                onZoomChange={(zoom) => set("logoZoom", zoom)}
                onPositionChange={(x, y) => {
                  setForm((current) => ({
                    ...current,
                    logoOffsetX: x,
                    logoOffsetY: y,
                  }));
                }}
                theme={theme}
              />
            ) : null}

            <ThemedText
              style={[styles.fieldLabel, { color: theme.textSecondary }]}
            >
              Display Date
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
              value={form.displayDate}
              onChangeText={(v) => set("displayDate", v)}
              placeholder="e.g. March 3, 2027"
              placeholderTextColor={theme.textSecondary}
            />

            <View
              style={[
                styles.appearanceToggle,
                {
                  borderColor: theme.border,
                  backgroundColor: theme.backgroundSecondary,
                },
              ]}
            >
              <View style={styles.appearanceToggleText}>
                <ThemedText
                  style={[styles.appearanceToggleTitle, { color: theme.text }]}
                >
                  Show year on login
                </ThemedText>
                <ThemedText
                  style={[
                    styles.appearanceToggleHint,
                    { color: theme.textSecondary },
                  ]}
                >
                  Display the event year beneath the name on the login screen.
                </ThemedText>
              </View>
              <Switch
                value={form.showYearOnLogin}
                onValueChange={(value) => set("showYearOnLogin", value)}
                trackColor={{ false: "#9CA3AF", true: AppColors.primary }}
                thumbColor="#FFFFFF"
                testID="switch-show-year-on-login"
              />
            </View>

            <ThemedText
              style={[styles.fieldLabel, { color: theme.textSecondary }]}
            >
              Tagline
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
              value={form.tagline}
              onChangeText={(v) => set("tagline", v)}
              placeholder="e.g. Advancing Stress Research"
              placeholderTextColor={theme.textSecondary}
              maxLength={TAGLINE_MAX_LENGTH}
              testID="input-appearance-tagline"
            />
            <ThemedText
              style={[
                styles.fieldHint,
                {
                  color:
                    form.tagline.length > TAGLINE_MAX_LENGTH
                      ? AppColors.error
                      : theme.textSecondary,
                },
              ]}
            >
              Short text shown on the About screen ({form.tagline.length}/
              {TAGLINE_MAX_LENGTH})
            </ThemedText>

            <View
              style={[
                styles.colorSectionHeader,
                { borderTopColor: theme.border },
              ]}
            >
              <Feather name="droplet" size={14} color={theme.textSecondary} />
              <ThemedText
                style={[
                  styles.colorSectionTitle,
                  { color: theme.textSecondary },
                ]}
              >
                Color Theme — tap a swatch or use custom hex
              </ThemedText>
            </View>

            <ColorPicker
              label="Primary Color"
              value={form.primaryColor}
              onChange={(v) => set("primaryColor", v)}
              theme={theme}
            />
            <ColorPicker
              label="Accent Color"
              value={form.accentColor}
              onChange={(v) => set("accentColor", v)}
              theme={theme}
            />
            <ColorPicker
              label="Gradient Start"
              value={form.gradientStart}
              onChange={(v) => set("gradientStart", v)}
              theme={theme}
            />
            <ColorPicker
              label="Gradient End"
              value={form.gradientEnd}
              onChange={(v) => set("gradientEnd", v)}
              theme={theme}
            />

            {event ? (
              <LiveAppPreview event={event} form={form} theme={theme} />
            ) : null}

            {error ? (
              <View style={styles.errorBox}>
                <Feather
                  name="alert-circle"
                  size={15}
                  color={AppColors.error}
                />
                <ThemedText
                  style={{ color: AppColors.error, fontSize: 13, flex: 1 }}
                >
                  {error}
                </ThemedText>
              </View>
            ) : null}

            {saved ? (
              <View style={[styles.errorBox, { backgroundColor: "#D1FAE5" }]}>
                <Feather name="check-circle" size={15} color="#059669" />
                <ThemedText style={{ color: "#059669", fontSize: 13, flex: 1 }}>
                  Appearance saved!
                </ThemedText>
              </View>
            ) : null}
          </ScrollView>
          <View style={styles.modalFooter}>
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
              onPress={handleSave}
              disabled={saving}
              style={[styles.btn, { backgroundColor: AppColors.primary }]}
              testID="button-save-appearance"
            >
              {saving ? (
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

function PublishConfirmModal({
  event,
  onClose,
  onEditTimetable,
  theme,
}: {
  event: AppEvent | null;
  onClose: () => void;
  onEditTimetable: () => void;
  theme: any;
}) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const refreshTheme = useRefreshEventTheme();
  const [loading, setLoading] = useState(false);
  const [starterSlots, setStarterSlots] = useState<TimetableItem[] | null>(
    null,
  );
  const [error, setError] = useState("");

  React.useEffect(() => {
    if (!event) {
      setStarterSlots(null);
      setError("");
    }
  }, [event]);

  const handlePublish = async () => {
    if (!event) return;
    const startDateError = validateEventStartDate(
      event.startDate || "",
      event.year,
    );
    if (startDateError) {
      setError(startDateError);
      return;
    }
    setLoading(true);
    try {
      await publishEventWithRecovery(event.id, !!starterSlots);
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/events"] });
      await refreshTheme();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch (e: any) {
      if (e?.code === "STARTER_TIMETABLE") {
        setStarterSlots(Array.isArray(e.details) ? e.details : []);
      } else {
        setError(
          e?.message || "Publishing was rejected. No changes were made.",
        );
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      visible={!!event}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View
          style={[
            styles.confirmCard,
            {
              backgroundColor: theme.cardBackground,
              paddingBottom: Spacing.xl + insets.bottom,
            },
          ]}
        >
          <View
            style={[
              styles.publishIconWrap,
              { backgroundColor: starterSlots ? "#FEF3C7" : "#D1FAE5" },
            ]}
          >
            <Feather
              name={starterSlots ? "alert-triangle" : "radio"}
              size={28}
              color={starterSlots ? "#D97706" : "#059669"}
            />
          </View>
          <ThemedText
            type="h4"
            style={{ textAlign: "center", marginBottom: Spacing.sm }}
          >
            {starterSlots ? "Starter timetable detected" : "Go Live?"}
          </ThemedText>
          <ThemedText
            style={[
              styles.confirmText,
              { color: theme.textSecondary, width: "100%" },
            ]}
          >
            {starterSlots
              ? `This event still contains ${starterSlots.length} starter timetable slot${starterSlots.length === 1 ? "" : "s"} (${starterSlots
                  .slice(0, 2)
                  .map((slot) => slot.activity1)
                  .join(
                    ", ",
                  )}). Attendees could see placeholder programme content. Edit or delete these slots, or confirm that the template is intentional.`
              : `"${event?.name}" will become the active event visible to all attendees and staff. Any previously published event will be archived.`}
          </ThemedText>
          {error ? (
            <View style={[styles.errorBox, { marginTop: Spacing.lg }]}>
              <Feather name="alert-circle" size={15} color={AppColors.error} />
              <ThemedText
                style={{ color: AppColors.error, fontSize: 13, flex: 1 }}
              >
                {error}
              </ThemedText>
            </View>
          ) : null}
          <View style={styles.modalFooter}>
            <Pressable
              onPress={starterSlots ? onEditTimetable : onClose}
              style={[
                styles.btn,
                { backgroundColor: theme.backgroundSecondary },
              ]}
            >
              <ThemedText
                style={[styles.modalButtonText, { fontWeight: "600" }]}
              >
                {starterSlots ? "Edit Timetable" : "Cancel"}
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={handlePublish}
              disabled={loading}
              style={[
                styles.btn,
                { backgroundColor: starterSlots ? "#D97706" : "#059669" },
              ]}
              testID="button-confirm-publish"
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <ThemedText
                  style={[
                    styles.modalButtonText,
                    { color: "#fff", fontWeight: "700" },
                  ]}
                >
                  {starterSlots ? "Publish Intentionally" : "Go Live"}
                </ThemedText>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function PublishUpdatesModal({
  event,
  onClose,
  theme,
}: {
  event: AppEvent | null;
  onClose: () => void;
  theme: any;
}) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const refreshTheme = useRefreshEventTheme();
  const [loading, setLoading] = useState(false);
  const [notifyAudience, setNotifyAudience] = useState(false);
  const [result, setResult] = useState<{
    notificationsSent: boolean;
    notificationOutcome: "sent" | "skipped";
    pushCount: number;
    pushAttempted: number;
    pushFailed: number;
  } | null>(null);
  const [error, setError] = useState("");

  React.useEffect(() => {
    setLoading(false);
    setNotifyAudience(false);
    setResult(null);
    setError("");
  }, [event?.id]);

  const handlePublishUpdates = async () => {
    if (!event) return;
    setLoading(true);
    setError("");
    try {
      const response = await apiRequest(
        `/api/admin/events/${event.id}/publish-updates`,
        {
          method: "POST",
          body: JSON.stringify({ notifyAudience }),
        },
      );
      const publishResult = (await response.json()) as {
        notificationsSent: boolean;
        notificationOutcome: "sent" | "skipped";
        pushCount: number;
        pushAttempted: number;
        pushFailed: number;
      };
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/events"] });
      await refreshTheme();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setResult(publishResult);
    } catch (e: any) {
      setError(
        e?.message || "Publishing failed. The event changes may not be live.",
      );
    } finally {
      setLoading(false);
    }
  };

  const closeResult = () => {
    if (loading) return;
    onClose();
  };

  return (
    <Modal
      visible={!!event}
      animationType="slide"
      transparent
      onRequestClose={closeResult}
    >
      <View style={styles.modalOverlay}>
        <View
          style={[
            styles.confirmCard,
            {
              backgroundColor: theme.cardBackground,
              paddingBottom: Spacing.xl + insets.bottom,
            },
          ]}
        >
          <View
            style={[
              styles.publishIconWrap,
              {
                backgroundColor: result
                  ? `${AppColors.success}15`
                  : `${AppColors.primary}15`,
              },
            ]}
          >
            <Feather
              name={result ? "check-circle" : "upload-cloud"}
              size={28}
              color={result ? AppColors.success : AppColors.primary}
            />
          </View>
          <ThemedText
            type="h4"
            style={{ textAlign: "center", marginBottom: Spacing.sm }}
          >
            {result ? "Updates Published" : "Publish Live Updates?"}
          </ThemedText>
          <ThemedText
            style={[styles.confirmText, { color: theme.textSecondary }]}
          >
            {result
              ? result.notificationsSent
                ? `The latest changes for "${event?.name}" are live. A notification was sent to staff and attendees.`
                : `The latest changes for "${event?.name}" are live. Staff and attendee notifications were skipped.`
              : `Publish the latest changes for "${event?.name}". Attendees keep their current login session and will receive the updates when they reopen or resume the app.`}
          </ThemedText>

          {!result ? (
            <>
              <View
                style={[
                  styles.appearanceToggle,
                  {
                    borderColor: theme.border,
                    backgroundColor: theme.backgroundSecondary,
                  },
                ]}
              >
                <Pressable
                  onPress={() => setNotifyAudience((current) => !current)}
                  accessibilityRole="button"
                  accessibilityLabel="Toggle update notifications"
                  accessibilityState={{ selected: notifyAudience }}
                  style={styles.appearanceToggleText}
                >
                  <ThemedText
                    style={[
                      styles.appearanceToggleTitle,
                      { color: theme.text },
                    ]}
                  >
                    Notify staff and attendees
                  </ThemedText>
                  <ThemedText
                    style={[
                      styles.appearanceToggleHint,
                      { color: theme.textSecondary },
                    ]}
                  >
                    Create an in-app announcement and send push notifications.
                    Off publishes silently.
                  </ThemedText>
                  <ThemedText
                    style={[
                      styles.appearanceToggleState,
                      {
                        color: notifyAudience
                          ? AppColors.primary
                          : theme.textTertiary,
                      },
                    ]}
                  >
                    {notifyAudience
                      ? "Current choice: Publish & Notify"
                      : "Current choice: Publish Silently"}
                  </ThemedText>
                </Pressable>
                <Switch
                  value={notifyAudience}
                  onValueChange={setNotifyAudience}
                  trackColor={{ false: "#9CA3AF", true: AppColors.primary }}
                  thumbColor="#FFFFFF"
                  testID="switch-notify-publish-updates"
                />
              </View>
              {error ? (
                <View style={styles.errorBox}>
                  <Feather
                    name="alert-circle"
                    size={16}
                    color={AppColors.error}
                  />
                  <ThemedText style={{ color: AppColors.error, flex: 1 }}>
                    {error}
                  </ThemedText>
                </View>
              ) : null}
            </>
          ) : null}

          <View style={styles.modalFooter}>
            {result ? (
              <Pressable
                onPress={closeResult}
                style={[styles.btn, { backgroundColor: AppColors.primary }]}
                testID="button-close-publish-updates-result"
              >
                <ThemedText style={{ color: "#fff", fontWeight: "700" }}>
                  Done
                </ThemedText>
              </Pressable>
            ) : (
              <>
                <Pressable
                  onPress={onClose}
                  style={[
                    styles.btn,
                    { backgroundColor: theme.backgroundSecondary },
                  ]}
                >
                  <ThemedText style={styles.modalButtonText} numberOfLines={1}>
                    Cancel
                  </ThemedText>
                </Pressable>
                <Pressable
                  onPress={handlePublishUpdates}
                  disabled={loading}
                  style={[styles.btn, { backgroundColor: AppColors.primary }]}
                  testID="button-confirm-publish-updates"
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <ThemedText style={{ color: "#fff", fontWeight: "700" }}>
                      {notifyAudience ? "Publish & Notify" : "Publish Silently"}
                    </ThemedText>
                  )}
                </Pressable>
              </>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function DeleteEventModal({
  event,
  onClose,
  theme,
}: {
  event: AppEvent | null;
  onClose: () => void;
  theme: any;
}) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    if (!event) return;
    setLoading(true);
    try {
      await apiRequest(`/api/admin/events/${event.id}`, { method: "DELETE" });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/events"] });
      onClose();
    } catch {
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      visible={!!event}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View
          style={[
            styles.confirmCard,
            {
              backgroundColor: theme.cardBackground,
              paddingBottom: Spacing.xl + insets.bottom,
            },
          ]}
        >
          <View
            style={[
              styles.publishIconWrap,
              { backgroundColor: `${AppColors.error}18` },
            ]}
          >
            <Feather name="trash-2" size={28} color={AppColors.error} />
          </View>
          <ThemedText
            type="h4"
            style={{ textAlign: "center", marginBottom: Spacing.sm }}
          >
            {event?.status === "published"
              ? "Delete Live Event?"
              : "Delete Event?"}
          </ThemedText>
          <ThemedText
            style={[styles.confirmText, { color: theme.textSecondary }]}
          >
            {event?.status === "published"
              ? `"${event?.name}" is currently live. Deleting it will immediately remove it from the attendee app and permanently delete its users, content, and notifications. This cannot be undone.`
              : `This will permanently delete "${event?.name}". This cannot be undone.`}
          </ThemedText>
          <View style={styles.modalFooter}>
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
              onPress={handleDelete}
              disabled={loading}
              style={[styles.btn, { backgroundColor: AppColors.error }]}
              testID="button-confirm-delete-event"
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <ThemedText
                  style={[
                    styles.modalButtonText,
                    { color: "#fff", fontWeight: "700" },
                  ]}
                  numberOfLines={1}
                >
                  Delete
                </ThemedText>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function DeleteEventPickerModal({
  events,
  visible,
  onClose,
  onSelect,
  theme,
}: {
  events: AppEvent[];
  visible: boolean;
  onClose: () => void;
  onSelect: (event: AppEvent) => void;
  theme: any;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View
          style={[
            styles.confirmCard,
            styles.deletePickerCard,
            {
              backgroundColor: theme.cardBackground,
              paddingBottom: Spacing.xl + insets.bottom,
            },
          ]}
        >
          <View
            style={[
              styles.publishIconWrap,
              { backgroundColor: `${AppColors.error}18` },
            ]}
          >
            <Feather name="trash-2" size={26} color={AppColors.error} />
          </View>
          <ThemedText
            type="h4"
            style={{ textAlign: "center", marginBottom: Spacing.sm }}
          >
            Choose an Event to Delete
          </ThemedText>
          <ThemedText
            style={[styles.confirmText, { color: theme.textSecondary }]}
          >
            Select one event year below. Live events require an extra warning
            before deletion.
          </ThemedText>

          <ScrollView
            style={styles.deletePickerList}
            contentContainerStyle={styles.deletePickerListContent}
            showsVerticalScrollIndicator={false}
          >
            {events.length === 0 ? (
              <View
                style={[
                  styles.noDeleteEvents,
                  { backgroundColor: theme.backgroundSecondary },
                ]}
              >
                <Feather name="shield" size={20} color={theme.textSecondary} />
                <ThemedText
                  style={{ color: theme.textSecondary, textAlign: "center" }}
                >
                  There are no events available to delete.
                </ThemedText>
              </View>
            ) : (
              events.map((event) => {
                const config =
                  STATUS_CONFIG[event.status] || STATUS_CONFIG.draft;
                const isLive = event.status === "published";
                return (
                  <Pressable
                    key={event.id}
                    onPress={() => onSelect(event)}
                    style={({ pressed }) => [
                      styles.deleteEventBubble,
                      {
                        backgroundColor: theme.backgroundSecondary,
                        borderColor: theme.border,
                        opacity: pressed ? 0.75 : 1,
                      },
                    ]}
                    testID={`button-select-delete-event-${event.id}`}
                  >
                    <View
                      style={[
                        styles.deleteEventYearBubble,
                        { backgroundColor: `${AppColors.error}14` },
                      ]}
                    >
                      <ThemedText
                        style={{ color: AppColors.error, fontWeight: "800" }}
                      >
                        {event.year}
                      </ThemedText>
                    </View>
                    <View style={styles.deleteEventBubbleInfo}>
                      <ThemedText
                        style={{
                          color: theme.text,
                          fontSize: 14,
                          fontWeight: "700",
                        }}
                        numberOfLines={1}
                      >
                        {event.name}
                      </ThemedText>
                      <ThemedText
                        style={{
                          color: theme.textSecondary,
                          fontSize: 12,
                          marginTop: 2,
                        }}
                      >
                        {isLive
                          ? "Live · Deletion needs extra confirmation"
                          : `${config.label} · Tap to delete`}
                      </ThemedText>
                    </View>
                    <Feather
                      name="chevron-right"
                      size={18}
                      color={theme.textTertiary as string}
                    />
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          <Pressable
            onPress={onClose}
            style={[
              styles.btn,
              {
                backgroundColor: theme.backgroundSecondary,
                alignSelf: "stretch",
              },
            ]}
          >
            <ThemedText style={{ fontWeight: "600", textAlign: "center" }}>
              Cancel
            </ThemedText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export default function AdminEventControlScreen() {
  const { theme } = useTheme();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const { setAdminEvent } = useAdminEvent();
  const [showCreate, setShowCreate] = useState(false);
  const [publishEvent, setPublishEvent] = useState<AppEvent | null>(null);
  const [deleteEvent, setDeleteEvent] = useState<AppEvent | null>(null);
  const [appearanceEvent, setAppearanceEvent] = useState<AppEvent | null>(null);
  const [publishUpdatesEvent, setPublishUpdatesEvent] =
    useState<AppEvent | null>(null);
  const [editDetailsEvent, setEditDetailsEvent] = useState<AppEvent | null>(
    null,
  );
  const [showDeletePicker, setShowDeletePicker] = useState(false);

  const { data: events = [], isLoading } = useQuery<AppEvent[]>({
    queryKey: ["/api/admin/events"],
  });

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => setShowDeletePicker(true)}
          style={{ paddingHorizontal: 16, paddingVertical: 8 }}
          testID="button-open-delete-event-picker"
        >
          <Feather name="trash-2" size={20} color={AppColors.error} />
        </Pressable>
      ),
    });
  }, [navigation]);

  const renderEvent = ({ item }: { item: AppEvent }) => {
    const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.draft;
    const isLive = item.status === "published";
    const hasTheme = item.primaryColor && item.primaryColor !== "#0c0057";
    return (
      <View
        style={[
          styles.eventCard,
          { backgroundColor: theme.cardBackground },
          isLive && styles.liveCard,
          Shadows.medium,
        ]}
      >
        {isLive ? (
          <View style={styles.liveBanner}>
            <Feather name="radio" size={12} color="#059669" />
            <ThemedText style={styles.liveBannerText}>
              Currently Live — Attendees see this event
            </ThemedText>
          </View>
        ) : null}
        <View style={styles.eventCardBody}>
          <View style={styles.eventLeft}>
            {item.logoUrl ? (
              <Image
                source={{ uri: item.logoUrl }}
                style={styles.eventLogoThumb}
                resizeMode="contain"
              />
            ) : (
              <View
                style={[
                  styles.yearBadge,
                  { backgroundColor: `${AppColors.primary}15` },
                ]}
              >
                <ThemedText
                  style={[styles.yearText, { color: AppColors.primary }]}
                >
                  {item.year}
                </ThemedText>
              </View>
            )}
          </View>
          <View style={styles.eventInfo}>
            <ThemedText style={styles.eventName} numberOfLines={2}>
              {item.name}
            </ThemedText>
            {item.startDate ? (
              <View style={styles.eventMeta}>
                <Feather
                  name="calendar"
                  size={13}
                  color={theme.textSecondary}
                />
                <ThemedText
                  style={[styles.eventMetaText, { color: theme.textSecondary }]}
                >
                  {item.startDate}
                  {item.endDate ? ` – ${item.endDate}` : ""}
                </ThemedText>
              </View>
            ) : null}
            {item.location ? (
              <View style={styles.eventMeta}>
                <Feather name="map-pin" size={13} color={theme.textSecondary} />
                <ThemedText
                  style={[styles.eventMetaText, { color: theme.textSecondary }]}
                >
                  {item.location}
                </ThemedText>
              </View>
            ) : null}
            <View style={styles.statusRow}>
              <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
                <Feather name={cfg.icon} size={11} color={cfg.color} />
                <ThemedText style={[styles.statusText, { color: cfg.color }]}>
                  {cfg.label}
                </ThemedText>
              </View>
              {hasTheme ? (
                <View style={styles.themeDots}>
                  <View
                    style={[
                      styles.themeDot,
                      { backgroundColor: item.primaryColor || "#0c0057" },
                    ]}
                  />
                  <View
                    style={[
                      styles.themeDot,
                      { backgroundColor: item.accentColor || "#f78f1e" },
                    ]}
                  />
                </View>
              ) : null}
            </View>
          </View>
        </View>

        <View style={[styles.eventActions, { borderTopColor: theme.border }]}>
          <Pressable
            onPress={() => {
              // Switch the admin context to this event, then navigate to the dashboard
              setAdminEvent({
                id: item.id,
                name: item.name,
                year: item.year,
                status: item.status,
              });
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              navigation.navigate("AdminDashboard");
            }}
            style={[
              styles.actionPill,
              { backgroundColor: `${AppColors.primary}12` },
            ]}
            testID={`button-manage-event-${item.id}`}
          >
            <Feather name="settings" size={14} color={AppColors.primary} />
            <ThemedText
              style={[styles.actionPillText, { color: AppColors.primary }]}
            >
              Manage
            </ThemedText>
          </Pressable>

          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setEditDetailsEvent(item);
            }}
            style={[
              styles.actionPill,
              {
                backgroundColor: `${AppColors.primary}08`,
                borderWidth: 1,
                borderColor: `${AppColors.primary}20`,
              },
            ]}
            testID={`button-edit-details-event-${item.id}`}
          >
            <Feather name="edit-2" size={14} color={AppColors.primary} />
            <ThemedText
              style={[styles.actionPillText, { color: AppColors.primary }]}
            >
              Edit Details
            </ThemedText>
          </Pressable>

          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setAppearanceEvent(item);
            }}
            style={[
              styles.actionPill,
              { backgroundColor: `${AppColors.accent}12` },
            ]}
            testID={`button-appearance-event-${item.id}`}
          >
            <Feather name="droplet" size={14} color={AppColors.accent} />
            <ThemedText
              style={[styles.actionPillText, { color: AppColors.accent }]}
            >
              Appearance
            </ThemedText>
          </Pressable>

          {item.status !== "published" ? (
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setPublishEvent(item);
              }}
              style={[styles.actionPill, { backgroundColor: "#D1FAE5" }]}
              testID={`button-publish-event-${item.id}`}
            >
              <Feather name="radio" size={14} color="#059669" />
              <ThemedText style={[styles.actionPillText, { color: "#059669" }]}>
                Go Live
              </ThemedText>
            </Pressable>
          ) : null}

          {isLive ? (
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setPublishUpdatesEvent(item);
              }}
              style={[
                styles.actionPill,
                { backgroundColor: `${AppColors.primary}12` },
              ]}
              testID={`button-publish-updates-event-${item.id}`}
            >
              <Feather
                name="upload-cloud"
                size={14}
                color={AppColors.primary}
              />
              <ThemedText
                style={[styles.actionPillText, { color: AppColors.primary }]}
              >
                Publish Updates
              </ThemedText>
            </Pressable>
          ) : null}

          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setDeleteEvent(item);
            }}
            style={[
              styles.actionPill,
              { backgroundColor: `${AppColors.error}12` },
            ]}
            testID={`button-delete-event-${item.id}`}
          >
            <Feather name="trash-2" size={14} color={AppColors.error} />
            <ThemedText
              style={[styles.actionPillText, { color: AppColors.error }]}
            >
              Delete
            </ThemedText>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <View style={[styles.topBar, { paddingTop: Spacing.lg }]}>
        <View style={styles.topBarTitle}>
          <ThemedText
            type="h3"
            style={[styles.topBarTitleText, { color: theme.text }]}
          >
            Event Control Panel
          </ThemedText>
          <ThemedText style={[styles.subtitle, { color: theme.textSecondary }]}>
            Manage event years. Only one can be Live at a time.
          </ThemedText>
        </View>
        <Pressable
          onPress={() => setShowCreate(true)}
          style={[styles.createBtn, { backgroundColor: AppColors.primary }]}
          testID="button-create-event-open"
        >
          <Feather name="plus" size={18} color="#fff" />
          <ThemedText style={styles.createBtnText}>New Year</ThemedText>
        </Pressable>
      </View>

      {isLoading ? (
        <ActivityIndicator
          style={{ marginTop: 60 }}
          color={AppColors.primary}
          size="large"
        />
      ) : events.length === 0 ? (
        <View style={styles.empty}>
          <View
            style={[
              styles.emptyIcon,
              { backgroundColor: `${AppColors.primary}12` },
            ]}
          >
            <Feather name="calendar" size={36} color={AppColors.primary} />
          </View>
          <ThemedText type="h4" style={{ marginBottom: Spacing.sm }}>
            No Events Yet
          </ThemedText>
          <ThemedText
            style={[styles.emptyText, { color: theme.textSecondary }]}
          >
            Create your first event year to get started.
          </ThemedText>
          <Pressable
            onPress={() => setShowCreate(true)}
            style={[styles.emptyBtn, { backgroundColor: AppColors.primary }]}
          >
            <ThemedText style={{ color: "#fff", fontWeight: "700" }}>
              Create First Event
            </ThemedText>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={events}
          keyExtractor={(e) => e.id}
          renderItem={renderEvent}
          contentContainerStyle={{
            paddingHorizontal: Spacing.lg,
            paddingTop: Spacing.md,
            paddingBottom: insets.bottom + 80,
          }}
          showsVerticalScrollIndicator={false}
        />
      )}

      <CreateEventModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        theme={theme}
      />
      <EditDetailsModal
        event={editDetailsEvent}
        onClose={() => setEditDetailsEvent(null)}
        theme={theme}
      />
      <AppearanceModal
        event={appearanceEvent}
        onClose={() => setAppearanceEvent(null)}
        theme={theme}
      />
      <PublishConfirmModal
        event={publishEvent}
        onClose={() => setPublishEvent(null)}
        onEditTimetable={() => {
          if (!publishEvent) return;
          setAdminEvent({
            id: publishEvent.id,
            name: publishEvent.name,
            year: publishEvent.year,
            status: publishEvent.status,
          });
          setPublishEvent(null);
          navigation.navigate("AdminTimetable" as never);
        }}
        theme={theme}
      />
      <PublishUpdatesModal
        event={publishUpdatesEvent}
        onClose={() => setPublishUpdatesEvent(null)}
        theme={theme}
      />
      <DeleteEventPickerModal
        events={events}
        visible={showDeletePicker}
        onClose={() => setShowDeletePicker(false)}
        onSelect={(event) => {
          setShowDeletePicker(false);
          setDeleteEvent(event);
        }}
        theme={theme}
      />
      <DeleteEventModal
        event={deleteEvent}
        onClose={() => setDeleteEvent(null)}
        theme={theme}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  topBarTitle: {
    flex: 1,
    minWidth: 0,
    marginRight: Spacing.md,
  },
  topBarTitleText: {
    flexShrink: 1,
  },
  subtitle: { fontSize: 13, marginTop: 4, maxWidth: 200 },
  createBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
  },
  createBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  eventCard: {
    borderRadius: BorderRadius.xl,
    marginBottom: Spacing.md,
    overflow: "hidden",
  },
  liveCard: { borderWidth: 1.5, borderColor: "#059669" },
  liveBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    backgroundColor: "#D1FAE5",
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
  },
  liveBannerText: { fontSize: 12, fontWeight: "600", color: "#059669" },
  eventCardBody: { flexDirection: "row", padding: Spacing.md, gap: Spacing.md },
  eventLeft: { alignItems: "center", paddingTop: 2 },
  eventLogoThumb: { width: 48, height: 48, borderRadius: BorderRadius.sm },
  yearBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm,
  },
  yearText: { fontSize: 18, fontWeight: "800" },
  eventInfo: { flex: 1, gap: 5 },
  eventName: { fontSize: 17, fontWeight: "700", lineHeight: 22 },
  eventMeta: { flexDirection: "row", alignItems: "center", gap: 5 },
  eventMetaText: { fontSize: 13 },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: BorderRadius.xs,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  themeDots: { flexDirection: "row", gap: 4, alignItems: "center" },
  themeDot: { width: 10, height: 10, borderRadius: 5 },
  eventActions: {
    flexDirection: "row",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderTopWidth: 1,
    flexWrap: "wrap",
  },
  actionPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
  },
  actionPillText: { fontSize: 13, fontWeight: "600" },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: { textAlign: "center", fontSize: 14, lineHeight: 20 },
  emptyBtn: {
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.full,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  modalCard: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: "92%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.md,
  },
  modalBody: { paddingHorizontal: Spacing.xl },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  fieldHint: {
    fontSize: 11,
    marginTop: -2,
    marginBottom: Spacing.xs,
  },
  pickerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
  },
  input: {
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    fontSize: 15,
  },
  textArea: { height: 90, textAlignVertical: "top" },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginTop: Spacing.md,
    padding: Spacing.sm,
    backgroundColor: `${AppColors.error}12`,
    borderRadius: BorderRadius.md,
  },
  appearanceToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.md,
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginTop: Spacing.lg,
  },
  appearanceToggleText: { flex: 1, gap: 3 },
  appearanceToggleTitle: { fontSize: 14, fontWeight: "700" },
  appearanceToggleHint: { fontSize: 12, lineHeight: 17 },
  appearanceToggleState: { fontSize: 12, fontWeight: "700", marginTop: 2 },
  modalFooter: {
    flexDirection: "row",
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
    width: "100%",
    alignSelf: "stretch",
  },
  btn: {
    flex: 0,
    flexGrow: 0,
    flexShrink: 0,
    width: "48%",
    minWidth: 120,
    minHeight: 52,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 14,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  modalButtonText: { fontWeight: "600", textAlign: "center", flexShrink: 0 },
  confirmCard: {
    width: "100%",
    maxWidth: "100%",
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    padding: Spacing.xl,
    alignItems: "center",
  },
  deletePickerCard: { width: "100%", maxWidth: "100%", maxHeight: "92%" },
  deletePickerList: { width: "100%", maxHeight: 300, marginBottom: Spacing.lg },
  deletePickerListContent: { gap: Spacing.sm },
  deleteEventBubble: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    borderWidth: 1,
    borderRadius: BorderRadius.xl,
    padding: Spacing.md,
  },
  deleteEventYearBubble: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteEventBubbleInfo: { flex: 1 },
  noDeleteEvents: {
    width: "100%",
    alignItems: "center",
    gap: Spacing.sm,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
  },
  publishIconWrap: {
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
  resultBox: {
    width: "100%",
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  // Appearance modal
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.xs,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.sm,
  },
  colorInput: {
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "monospace",
  },
  colorSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    borderTopWidth: 1,
    marginTop: Spacing.lg,
    paddingTop: Spacing.lg,
    marginBottom: Spacing.xs,
  },
  colorSectionTitle: { fontSize: 12, fontWeight: "600" },
  previewStrip: {
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.md,
    overflow: "hidden",
  },
  previewGradient: {
    height: 40,
    justifyContent: "center",
    alignItems: "flex-end",
    paddingRight: Spacing.md,
  },
  previewAccentDot: { width: 20, height: 20, borderRadius: 10 },
  previewContent: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    gap: 4,
  },
  previewPrimary: { width: 20, height: 20, borderRadius: 4 },
  livePreviewCard: {
    borderWidth: 1,
    borderRadius: BorderRadius.xl,
    padding: Spacing.md,
    marginTop: Spacing.lg,
    marginBottom: Spacing.md,
  },
  livePreviewHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: Spacing.md,
  },
  livePreviewTitle: { fontSize: 15, fontWeight: "800" },
  livePreviewHint: { fontSize: 11, marginTop: 3, lineHeight: 16 },
  previewLiveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: BorderRadius.full,
  },
  previewLiveDot: { width: 6, height: 6, borderRadius: 3 },
  previewTabs: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: 3,
    marginBottom: Spacing.md,
  },
  previewTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 8,
    borderRadius: BorderRadius.sm,
  },
  previewDevice: {
    width: "100%",
    height: 350,
    borderRadius: 22,
    overflow: "hidden",
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  previewLoginScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.lg,
    overflow: "hidden",
  },
  previewGradientOverlay: {
    ...StyleSheet.absoluteFill,
  },
  previewLoginGlow: {
    position: "absolute",
    width: 190,
    height: 190,
    borderRadius: 95,
    right: -70,
    top: -60,
    backgroundColor: "#ffffff12",
  },
  previewBrandBlock: { alignItems: "center", marginTop: 18, maxWidth: "90%" },
  logoEditorSection: {
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  logoEditorHeading: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  logoEditorTitle: { fontSize: 14, fontWeight: "800" },
  logoEditorHint: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  logoEditorCanvas: {
    alignSelf: "center",
  },
  logoEditorCanvasBorder: {
    ...StyleSheet.absoluteFill,
    borderWidth: 2,
  },
  logoEditorGuide: {
    ...StyleSheet.absoluteFill,
    borderWidth: 1,
  },
  logoEditorControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  logoEditorControl: {
    width: 32,
    height: 32,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  logoEditorZoom: {
    minWidth: 48,
    textAlign: "center",
    fontSize: 12,
    fontWeight: "700",
  },
  logoEditorReset: {
    marginLeft: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
  },
  previewLogoFrame: {
    width: 64,
    height: 64,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  previewEventLogo: {
    marginBottom: 10,
    backgroundColor: "#ffffff18",
  },
  previewLogoImage: { width: 46, height: 46, borderRadius: 12 },
  scheduleRow: { flexDirection: "row", gap: Spacing.md },
  scheduleField: { flex: 1 },
  previewEventName: {
    color: "#fff",
    fontSize: 19,
    fontWeight: "800",
    textAlign: "center",
  },
  previewEventYear: {
    color: "#ffffffe6",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 2,
  },
  previewDate: { fontSize: 11, fontWeight: "800", marginTop: 5 },
  previewTagline: {
    color: "#ffffffbb",
    fontSize: 11,
    textAlign: "center",
    marginTop: 5,
  },
  previewLoginForm: { width: "100%", gap: 8, marginBottom: 4 },
  previewInput: {
    height: 38,
    backgroundColor: "#ffffffee",
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 11,
  },
  previewPlaceholder: { color: "#8b91a7", fontSize: 11 },
  previewButton: {
    height: 38,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  previewButtonText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  previewHomeScreen: { flex: 1 },
  previewHomeHero: { height: 145, padding: Spacing.md, paddingTop: 16 },
  previewHomeTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  previewMiniLogo: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: "#ffffff22",
    alignItems: "center",
    justifyContent: "center",
  },
  previewMiniLogoImage: { width: 22, height: 22, borderRadius: 6 },
  previewWelcome: { color: "#ffffffbb", fontSize: 10 },
  previewHomeTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "800",
    marginTop: 2,
  },
  previewHomeDate: { fontSize: 10, fontWeight: "800", marginTop: 5 },
  gradientSafetyNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm,
    marginTop: Spacing.sm,
  },
  gradientSafetyText: { flex: 1, fontSize: 11, lineHeight: 16 },
  previewHomeBody: { flex: 1, padding: Spacing.md, gap: 9 },
  previewSectionTitle: { fontSize: 13, fontWeight: "800" },
  previewHomeCards: { flexDirection: "row", gap: 8 },
  previewHomeCard: {
    flex: 1,
    borderRadius: 10,
    padding: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  previewHomeCardText: { fontSize: 10, fontWeight: "800" },
  previewSessionCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  previewTimePill: {
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderRadius: 7,
  },
  previewSessionTitle: { fontSize: 11, fontWeight: "800", marginBottom: 2 },
  previewBottomNav: {
    height: 38,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
  },
  // ColorPicker
  cpHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
    marginTop: Spacing.md,
  },
  cpPreview: { width: 22, height: 22, borderRadius: 11, borderWidth: 1 },
  cpLabel: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  swatchGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  swatchActive: {
    borderWidth: 2.5,
    borderColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  swatchCustom: { borderWidth: 1.5 },
});
