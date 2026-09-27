import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  ReactNode,
} from "react";
import * as SecureStore from "expo-secure-store";
import { Alert, AppState, AppStateStatus, Platform } from "react-native";
import {
  ApiError,
  apiRequest,
  fetchWithTimeout,
  getApiUrl,
  setUnauthorizedHandler,
} from "@/lib/query-client";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { getNotificationDeviceId } from "@/lib/notification-device";
import {
  registerPushToken,
  type PushRegistrationDependencies,
} from "@/lib/push-registration";

export interface User {
  id: string;
  email: string;
  name: string;
  role: "attendee" | "staff" | "admin";
  qrCodeValue: string;
  checkedIn: boolean;
  photoUrl?: string | null;
}

export interface LoginEventOption {
  id: string;
  name: string;
  year: number;
  status: string;
  needsSetup: boolean;
  showYearOnLogin?: boolean;
}

export interface EmailLoginResult {
  success: boolean;
  needsSetup?: boolean;
  needsPassword?: boolean;
  accountType?: "event" | "global";
  event?: LoginEventOption | null;
  eventOptions?: LoginEventOption[];
  eventSelectionRequired?: boolean;
  userName?: string;
  error?: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (
    email: string,
    password?: string,
    eventId?: string,
  ) => Promise<EmailLoginResult>;
  setupPassword: (
    email: string,
    newPassword: string,
    code?: string,
    eventId?: string,
  ) => Promise<{ success: boolean; error?: string; errorCode?: string }>;
  requestActivation: (
    email: string,
    eventId?: string,
  ) => Promise<{ success: boolean; userName?: string; error?: string }>;
  forgotPassword: (
    email: string,
    eventId?: string,
  ) => Promise<{
    success: boolean;
    error?: string;
    errorCode?: string;
    retryAfterSeconds?: number;
  }>;
  verifyResetCode: (
    email: string,
    code: string,
    eventId?: string,
  ) => Promise<{ success: boolean; error?: string; errorCode?: string }>;
  verifyActivationCode: (
    email: string,
    code: string,
    eventId?: string,
  ) => Promise<{ success: boolean; error?: string; errorCode?: string }>;
  resetPassword: (
    email: string,
    code: string,
    newPassword: string,
    eventId?: string,
  ) => Promise<{ success: boolean; error?: string; errorCode?: string }>;
  changePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<{ success: boolean; error?: string; errorCode?: string }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  notificationDeviceId: string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = "auth_token";

async function getToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    return localStorage.getItem(TOKEN_KEY);
  }
  return await SecureStore.getItemAsync(TOKEN_KEY);
}

export async function getStoredAuthToken(): Promise<string | null> {
  return getToken();
}

async function setToken(token: string): Promise<void> {
  if (Platform.OS === "web") {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  }
}

async function removeToken(): Promise<void> {
  if (Platform.OS === "web") {
    localStorage.removeItem(TOKEN_KEY);
  } else {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }
}

// ─── Optional push registration ──────────────────────────────────────────────
// Keep this completely separate from auth so a broken native notification
// module or push endpoint cannot block sign-in or event access.
function pushRegistrationDependencies(): PushRegistrationDependencies {
  return {
    isSupported:
      Platform.OS !== "web" &&
      Constants.executionEnvironment !== ExecutionEnvironment.StoreClient,
    projectId: (Constants.expoConfig?.extra as any)?.eas?.projectId as
      | string
      | undefined,
    // Keep expo-notifications out of the Expo Go module graph at runtime.
    // Expo Go does not contain PushNotificationIOS and crashes on import.
    loadNotifications: () => import("expo-notifications"),
    getDeviceId: getNotificationDeviceId,
    getApiUrl,
    fetchWithTimeout,
    warn: (message) => console.warn(message),
  };
}

async function getOptionalNotificationDeviceId(): Promise<string | undefined> {
  try {
    return await getNotificationDeviceId();
  } catch {
    // A device ID is useful for preferences, but it is not required for auth
    // or event-scoped notification history.
    console.warn(
      "[Push] Device registration unavailable; continuing without push.",
    );
    return undefined;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notificationDeviceId, setNotificationDeviceId] = useState("");

  useEffect(() => {
    getNotificationDeviceId()
      .then(setNotificationDeviceId)
      .catch(() => {});
  }, []);

  // Tracks whether we are currently refreshing to avoid concurrent foreground checks
  const isRefreshingRef = useRef(false);
  const sessionExpiredRef = useRef(false);

  // Possible outcomes from /api/auth/me:
  //   User        — request succeeded, session is valid
  //   "expired"   — server returned 401; token is definitively rejected
  //   "password_changed" — server revoked the token after a password change
  //   "error"     — network failure or non-auth server error; treat as transient
  const fetchUser = async (
    token: string,
  ): Promise<User | "expired" | "password_changed" | "error"> => {
    try {
      const baseUrl = getApiUrl();
      const response = await fetchWithTimeout(
        new URL("/api/auth/me", baseUrl).href,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (response.ok) return await response.json();
      if (response.status === 401) {
        const payload = await response
          .clone()
          .json()
          .catch(() => ({}) as { code?: string });
        return payload.code === "PASSWORD_CHANGED"
          ? "password_changed"
          : "expired";
      }
      // 5xx or other non-401 failure — treat as transient, not as auth invalidation
      return "error";
    } catch {
      // Network error (offline, timeout, DNS) — definitely transient
      return "error";
    }
  };

  // Silently refresh the JWT if it expires within 1 day.
  // Returns the new/existing token, or null if the token is expired AND the
  // refresh endpoint also rejects it (unrecoverable — caller should log out).
  const refreshTokenIfNeeded = async (
    token: string,
  ): Promise<string | null> => {
    try {
      // Decode payload (no verification — just check expiry client-side for UX)
      const parts = token.split(".");
      if (parts.length !== 3) return token;
      const payload = JSON.parse(
        atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
      );
      const expiresAt = payload.exp * 1000;
      const oneDayMs = 24 * 60 * 60 * 1000;
      if (expiresAt - Date.now() > oneDayMs) return token; // still plenty of time
      // Token expires within 1 day (or is already expired) — try to refresh
      const baseUrl = getApiUrl();
      const res = await fetchWithTimeout(
        new URL("/api/auth/refresh", baseUrl).href,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (res.ok) {
        const data = await res.json();
        if (data.token) {
          await setToken(data.token);
          return data.token;
        }
      }
      // Refresh failed — if the token is already past expiry it is unrecoverable
      if (expiresAt < Date.now()) return null;
    } catch {
      // Network error during refresh — don't force logout, connectivity may be flaky
    }
    return token;
  };

  // Show an alert and clear auth state so the user lands on the login screen
  const handleSessionExpired = async (reason?: string) => {
    if (sessionExpiredRef.current) return;
    sessionExpiredRef.current = true;
    await removeToken();
    setUser(null);
    Alert.alert(
      reason === "PASSWORD_CHANGED" ? "Signed Out" : "Session Expired",
      reason === "PASSWORD_CHANGED"
        ? "You were logged out because your password was changed. Please sign in again."
        : "Your session expired. Please sign in again.",
      [{ text: "OK" }],
    );
  };

  // Register the session-expired callback with the query client so any
  // background query that receives a 401 automatically triggers logout,
  // without the user having to manually refresh or restart the app.
  useEffect(() => {
    setUnauthorizedHandler((reason) => {
      handleSessionExpired(reason);
    });
    return () => setUnauthorizedHandler(() => {}); // cleanup on unmount
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      try {
        let token = await getToken();
        if (token) {
          const refreshed = await refreshTokenIfNeeded(token);
          if (refreshed === null) {
            // Token is definitively expired and the server rejected the refresh
            await handleSessionExpired();
            return;
          }
          const userData = await fetchUser(refreshed);
          if (userData === "password_changed") {
            await handleSessionExpired("PASSWORD_CHANGED");
          } else if (userData === "expired") {
            // Server explicitly rejected the token — clear it
            await handleSessionExpired();
          } else if (userData === "error") {
            // Network or server error — could be flaky conference Wi-Fi.
            // Keep the token so the next foreground event can retry; do not
            // force the user to log in again over a transient connectivity issue.
            console.warn(
              "[Auth] Could not verify session on startup (network error); keeping token for retry.",
            );
          } else {
            // userData is a valid User object
            setUser(userData);
          }
        }
      } catch (error) {
        console.error("Auth init error:", error);
      } finally {
        setIsLoading(false);
      }
    };
    initAuth();
  }, []);

  // Re-check token validity whenever the app comes back to the foreground
  useEffect(() => {
    const validateStoredSession = async () => {
      if (isRefreshingRef.current) return;
      isRefreshingRef.current = true;
      try {
        const token = await getToken();
        if (!token) return; // not logged in — nothing to do
        const refreshed = await refreshTokenIfNeeded(token);
        if (refreshed === null) {
          // Expired and unrecoverable — log the user out gracefully
          await handleSessionExpired();
          return;
        }
        // Verify the (possibly refreshed) token is still accepted by the server
        const userData = await fetchUser(refreshed);
        if (userData === "password_changed") {
          await handleSessionExpired("PASSWORD_CHANGED");
        } else if (userData === "expired") {
          await handleSessionExpired();
        } else if (userData === "error") {
          // Network/server error — keep the user logged in; they can retry naturally
          console.warn(
            "[Auth] Foreground session check failed (network error); keeping existing session.",
          );
        } else {
          setUser(userData);
        }
      } catch (e) {
        console.warn("[Auth] Foreground token check failed:", e);
      } finally {
        isRefreshingRef.current = false;
      }
    };

    const handleAppStateChange = async (nextState: AppStateStatus) => {
      if (nextState !== "active") return;
      await validateStoredSession();
    };

    const subscription = AppState.addEventListener(
      "change",
      handleAppStateChange,
    );
    const interval = setInterval(() => {
      if (AppState.currentState === "active") {
        void validateStoredSession();
      }
    }, 10_000);
    return () => {
      subscription.remove();
      clearInterval(interval);
    };
  }, []);

  const login = async (
    email: string,
    password?: string,
    eventId?: string,
  ): Promise<EmailLoginResult> => {
    try {
      const deviceId = await getOptionalNotificationDeviceId();
      const baseUrl = getApiUrl();
      const response = await fetchWithTimeout(
        new URL("/api/auth/login", baseUrl).href,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            eventId,
            ...(deviceId ? { deviceId } : {}),
          }),
        },
      );
      const data = await response.json();
      if (response.status === 200 && data.token) {
        sessionExpiredRef.current = false;
        await setToken(data.token);
        setUser(data.user);
        // Register for push notifications in the background — non-blocking.
        void registerPushToken(data.token, pushRegistrationDependencies());
        return { success: true };
      }
      if (
        response.status === 200 &&
        (data.needsPassword || data.needsSetup || data.eventSelectionRequired)
      ) {
        return {
          success: false,
          needsPassword: data.needsPassword === true,
          needsSetup: data.needsSetup === true,
          accountType:
            data.accountType === "event" || data.accountType === "global"
              ? data.accountType
              : undefined,
          event: data.event ?? null,
          eventOptions: Array.isArray(data.eventOptions)
            ? data.eventOptions
            : undefined,
          eventSelectionRequired: data.eventSelectionRequired === true,
        };
      }
      return { success: false, error: data.message || "Login failed" };
    } catch {
      return {
        success: false,
        error:
          "Can't reach the conference server. Check your internet connection and try again.",
      };
    }
  };

  const setupPassword = async (
    email: string,
    newPassword: string,
    code?: string,
    eventId?: string,
  ): Promise<{ success: boolean; error?: string; errorCode?: string }> => {
    try {
      const deviceId = await getOptionalNotificationDeviceId();
      const baseUrl = getApiUrl();
      const response = await fetchWithTimeout(
        new URL("/api/auth/set-password", baseUrl).href,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            code,
            newPassword,
            eventId,
            ...(deviceId ? { deviceId } : {}),
          }),
        },
      );
      const data = await response.json();
      if (response.ok && data.token) {
        sessionExpiredRef.current = false;
        await setToken(data.token);
        setUser(data.user);
        // Also register push token on first-time password setup.
        void registerPushToken(data.token, pushRegistrationDependencies());
        return { success: true };
      }
      return {
        success: false,
        error: data.message || "Failed to set password",
        errorCode: data.code,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof ApiError
            ? error.message
            : "Network error. Please try again.",
        errorCode: error instanceof ApiError ? error.code : undefined,
      };
    }
  };

  const requestActivation = async (
    email: string,
    eventId?: string,
  ): Promise<{ success: boolean; userName?: string; error?: string }> => {
    try {
      const response = await fetchWithTimeout(
        new URL("/api/auth/request-activation", getApiUrl()).href,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, eventId }),
        },
      );
      const data = await response.json();
      if (response.ok) return { success: true, userName: data.name };
      return {
        success: false,
        error: data.message || "Failed to send activation code",
      };
    } catch {
      return { success: false, error: "Network error. Please try again." };
    }
  };

  const forgotPassword = async (
    email: string,
    eventId?: string,
  ): Promise<{
    success: boolean;
    error?: string;
    errorCode?: string;
    retryAfterSeconds?: number;
  }> => {
    try {
      const baseUrl = getApiUrl();
      const response = await fetchWithTimeout(
        new URL("/api/auth/forgot-password", baseUrl).href,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, eventId }),
        },
      );
      const data = await response.json();
      if (response.ok) return { success: true };
      return {
        success: false,
        error: data.message || "Failed to send code",
        errorCode: data.code,
        retryAfterSeconds: data.retryAfterSeconds,
      };
    } catch {
      return { success: false, error: "Network error. Please try again." };
    }
  };

  const verifyResetCode = async (
    email: string,
    code: string,
    eventId?: string,
  ): Promise<{ success: boolean; error?: string; errorCode?: string }> => {
    try {
      const baseUrl = getApiUrl();
      const response = await fetchWithTimeout(
        new URL("/api/auth/verify-reset-code", baseUrl).href,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, code, purpose: "reset", eventId }),
        },
      );
      const data = await response.json();
      if (response.ok && data.valid) return { success: true };
      return {
        success: false,
        error: data.message || "Invalid or expired code",
        errorCode: data.code,
      };
    } catch {
      return { success: false, error: "Network error. Please try again." };
    }
  };

  const verifyActivationCode = async (
    email: string,
    code: string,
    eventId?: string,
  ): Promise<{ success: boolean; error?: string; errorCode?: string }> => {
    try {
      const baseUrl = getApiUrl();
      const response = await fetchWithTimeout(
        new URL("/api/auth/verify-reset-code", baseUrl).href,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, code, purpose: "activation", eventId }),
        },
      );
      const data = await response.json();
      if (response.ok && data.valid) return { success: true };
      return {
        success: false,
        error: data.message || "Invalid or expired code",
        errorCode: data.code,
      };
    } catch {
      return { success: false, error: "Network error. Please try again." };
    }
  };

  const resetPassword = async (
    email: string,
    code: string,
    newPassword: string,
    eventId?: string,
  ): Promise<{ success: boolean; error?: string; errorCode?: string }> => {
    try {
      const baseUrl = getApiUrl();
      const response = await fetchWithTimeout(
        new URL("/api/auth/reset-password", baseUrl).href,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, code, newPassword, eventId }),
        },
      );
      const data = await response.json();
      if (response.ok && (data.token || data.passwordChanged)) {
        // A password reset must end the recovery flow at the login screen.
        // Never turn a reset response into an authenticated session.
        await removeToken();
        setUser(null);
        return { success: true };
      }
      return {
        success: false,
        error: data.message || "Password reset failed",
        errorCode: data.code,
      };
    } catch {
      return { success: false, error: "Network error. Please try again." };
    }
  };

  const changePassword = async (
    currentPassword: string,
    newPassword: string,
  ): Promise<{ success: boolean; error?: string; errorCode?: string }> => {
    try {
      const response = await apiRequest("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await response.json();
      if (response.ok && data.passwordChanged) {
        await removeToken();
        setUser(null);
        return { success: true };
      }
      return {
        success: false,
        error: data.message || "Password change failed",
        errorCode: data.code,
      };
    } catch {
      return { success: false, error: "Network error. Please try again." };
    }
  };

  const logout = async () => {
    const token = await getToken();
    try {
      if (token) {
        await fetchWithTimeout(new URL("/api/auth/logout", getApiUrl()).href, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } catch {
      // Local logout still succeeds if the network is unavailable; the session
      // remains revocable from device management and expires normally.
    } finally {
      await removeToken();
      setUser(null);
    }
  };

  const refreshUser = async () => {
    const token = await getToken();
    if (token) {
      const userData = await fetchUser(token);
      if (userData === "password_changed") {
        await handleSessionExpired("PASSWORD_CHANGED");
      } else if (userData === "expired") {
        await handleSessionExpired();
      } else if (userData === "error") {
        // Transient failure — leave the current user state intact
      } else {
        setUser(userData);
      }
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        setupPassword,
        requestActivation,
        forgotPassword,
        verifyResetCode,
        verifyActivationCode,
        resetPassword,
        changePassword,
        logout,
        refreshUser,
        notificationDeviceId,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
