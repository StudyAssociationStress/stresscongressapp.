import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import { AppState, Platform } from "react-native";
import { getApiUrl, queryClient } from "@/lib/query-client";
import { getStoredAuthToken, useAuth } from "@/contexts/AuthContext";

export interface EventTheme {
  eventId: string | null;
  eventName: string;
  year: number | null;
  displayDate: string | null;
  startDate: string | null;
  endDate: string | null;
  scheduleStart: string | null;
  scheduleEnd: string | null;
  location: string | null;
  logoUrl: string | null;
  logoShape: "circle" | "square";
  logoZoom: number;
  logoOffsetX: number;
  logoOffsetY: number;
  primaryColor: string;
  accentColor: string;
  gradientStart: string;
  gradientEnd: string;
  tagline: string | null;
  showYearOnLogin: boolean;
  lastPublishedAt: string | null;
  isLoading: boolean;
}

const DEFAULT_THEME: EventTheme = {
  eventId: null,
  eventName: "",
  year: null,
  displayDate: null,
  startDate: null,
  endDate: null,
  scheduleStart: null,
  scheduleEnd: null,
  location: null,
  logoUrl: null,
  logoShape: "square",
  logoZoom: 100,
  logoOffsetX: 0,
  logoOffsetY: 0,
  primaryColor: "#2D3541",
  accentColor: "#f78f1e",
  gradientStart: "#171A1F",
  gradientEnd: "#2D3541",
  tagline: null,
  showYearOnLogin: true,
  lastPublishedAt: null,
  isLoading: true,
};

const EVENT_THEME_REFRESH_INTERVAL_MS = 15_000;

const EventThemeContext = createContext<{
  eventTheme: EventTheme;
  refreshTheme: () => Promise<void>;
}>({
  eventTheme: DEFAULT_THEME,
  refreshTheme: async () => {},
});

export function EventThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isLoading: isAuthLoading } = useAuth();
  const [eventTheme, setEventTheme] = useState<EventTheme>(DEFAULT_THEME);
  const isFetchingRef = useRef(false);
  const hasResolvedThemeRef = useRef(false);
  const publishedVersionRef = useRef<string | null | undefined>(undefined);

  const fetchTheme = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      const baseUrl = getApiUrl();
      const url = new URL("/api/events/active", baseUrl);
      // Expo Go can retain a conditional response from before publication.
      // Use a unique query for each refresh so the native client receives the
      // current event body instead of reusing a stale 304 response.
      url.searchParams.set("_themeRefresh", String(Date.now()));
      const token = await getStoredAuthToken();
      const res = await fetch(url.toString(), {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (res.status === 304) return;
      if (!res.ok) {
        if (res.status === 404 || !hasResolvedThemeRef.current) {
          setEventTheme({ ...DEFAULT_THEME, isLoading: false });
        }
        return;
      }
      const data = await res.json();
      const nextPublishedAt =
        typeof data.lastPublishedAt === "string" ? data.lastPublishedAt : null;
      const publishedVersionChanged =
        hasResolvedThemeRef.current &&
        publishedVersionRef.current !== nextPublishedAt;
      hasResolvedThemeRef.current = true;
      publishedVersionRef.current = nextPublishedAt;
      if (publishedVersionChanged) {
        // Publish Updates is the single refresh boundary for attendee-facing
        // content. Invalidate every cached query so the active screen refetches
        // immediately and screens opened later cannot reuse stale data.
        await queryClient.invalidateQueries();
      }
      setEventTheme({
        eventId: data.id ?? null,
        eventName: data.name ?? "",
        year: data.year ?? null,
        displayDate: data.displayDate ?? null,
        startDate: data.startDate ?? null,
        endDate: data.endDate ?? null,
        scheduleStart: data.scheduleStart ?? null,
        scheduleEnd: data.scheduleEnd ?? null,
        location: data.location ?? null,
        logoUrl: data.logoUrl ?? null,
        logoShape: data.logoShape === "circle" ? "circle" : "square",
        logoZoom: typeof data.logoZoom === "number" ? data.logoZoom : 100,
        logoOffsetX:
          typeof data.logoOffsetX === "number" ? data.logoOffsetX : 0,
        logoOffsetY:
          typeof data.logoOffsetY === "number" ? data.logoOffsetY : 0,
        primaryColor: data.primaryColor ?? "#2D3541",
        accentColor: data.accentColor ?? "#f78f1e",
        gradientStart: data.gradientStart ?? "#171A1F",
        gradientEnd: data.gradientEnd ?? "#2D3541",
        tagline: data.tagline ?? null,
        showYearOnLogin: data.showYearOnLogin !== false,
        lastPublishedAt: nextPublishedAt,
        isLoading: false,
      });
    } catch {
      setEventTheme({ ...DEFAULT_THEME, isLoading: false });
    } finally {
      isFetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!isAuthLoading) void fetchTheme();
  }, [fetchTheme, isAuthLoading, user?.id]);

  useEffect(() => {
    const onAppStateChange = (state: string) => {
      if (state === "active") {
        void fetchTheme();
      }
    };
    const appStateSubscription = AppState.addEventListener(
      "change",
      onAppStateChange,
    );
    const refreshInterval = setInterval(() => {
      if (AppState.currentState === "active") {
        void fetchTheme();
      }
    }, EVENT_THEME_REFRESH_INTERVAL_MS);

    if (Platform.OS === "web" && typeof window !== "undefined") {
      const refreshOnFocus = () => void fetchTheme();
      window.addEventListener("focus", refreshOnFocus);
      document.addEventListener("visibilitychange", refreshOnFocus);
      return () => {
        appStateSubscription.remove();
        clearInterval(refreshInterval);
        window.removeEventListener("focus", refreshOnFocus);
        document.removeEventListener("visibilitychange", refreshOnFocus);
      };
    }

    return () => {
      appStateSubscription.remove();
      clearInterval(refreshInterval);
    };
  }, [fetchTheme]);

  return (
    <EventThemeContext.Provider
      value={{ eventTheme, refreshTheme: fetchTheme }}
    >
      {children}
    </EventThemeContext.Provider>
  );
}

export function useEventTheme(): EventTheme {
  return useContext(EventThemeContext).eventTheme;
}

export function useRefreshEventTheme(): () => Promise<void> {
  return useContext(EventThemeContext).refreshTheme;
}
