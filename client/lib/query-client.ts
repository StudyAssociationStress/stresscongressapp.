import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";

// ── Global 401 handler ────────────────────────────────────────────────────────
// AuthProvider registers handleSessionExpired here so any stale-token API
// response from a background query automatically clears auth state and shows
// the login screen — without the user needing to manually refresh.
let _unauthorizedHandler: ((code?: string) => void) | null = null;
export function setUnauthorizedHandler(fn: (code?: string) => void): void {
  _unauthorizedHandler = fn;
}

const TOKEN_KEY = "auth_token";
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Prevent an unreachable development server or interrupted mobile connection
 * from leaving a screen in a permanent loading state.
 */
export async function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        "Request timed out. Please check your connection and try again.",
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    return localStorage.getItem(TOKEN_KEY);
  }
  return await SecureStore.getItemAsync(TOKEN_KEY);
}

/**
 * Gets the base URL for the Express API server.
 *
 * Resolution order:
 *   1. Constants.expoConfig.extra.apiUrl  — set at EAS build time via app.config.js
 *   2. EXPO_PUBLIC_API_URL env var         — set in the EAS environment or local shell
 *   3. EXPO_PUBLIC_DOMAIN env var          — development-only fallback
 */
export function getApiUrl(): string {
  // The browser preview is served by Metro, which proxies same-origin /api
  // requests to the backend. Avoid the separate development hostname here so
  // the preview does not run into cross-origin restrictions.
  if (
    Platform.OS === "web" &&
    process.env.EXPO_PUBLIC_PREVIEW_WEB === "1" &&
    typeof window !== "undefined"
  ) {
    return window.location.origin;
  }

  const extraUrl = (Constants.expoConfig?.extra as any)?.apiUrl as
    | string
    | undefined;
  const host =
    extraUrl ||
    process.env.EXPO_PUBLIC_API_URL ||
    process.env.EXPO_PUBLIC_DOMAIN;

  if (!host) {
    throw new Error(
      "API URL not configured. Set EXPO_PUBLIC_API_URL in the EAS production environment, " +
        "or EXPO_PUBLIC_DOMAIN in your dev environment.",
    );
  }

  // Accept full URLs (https://...) or bare hostnames (domain:port)
  const clean = host.replace(/\/$/, "");
  if (clean.startsWith("http://") || clean.startsWith("https://")) {
    return clean;
  }
  return `https://${clean}`;
}

export class ApiError extends Error {
  status: number;
  retryable: boolean;
  code?: string;
  details?: unknown;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryable = status === 408 || status === 429 || status >= 500;
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    let message = text;
    let payload: {
      message?: string;
      code?: string;
      starterSlots?: unknown;
    } | null = null;
    try {
      payload = JSON.parse(text);
      message = payload?.message || text;
    } catch {
      // Keep the plain response text for non-JSON proxy/network errors.
    }
    const error = new ApiError(res.status, message);
    error.code = payload?.code;
    error.details = payload?.starterSlots;
    throw error;
  }
}

export async function apiRequest(
  route: string,
  options?: { method?: string; body?: string },
): Promise<Response> {
  const baseUrl = getApiUrl();
  const url = new URL(route, baseUrl);
  const token = await getToken();

  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  if (options?.body) {
    headers["Content-Type"] = "application/json";
  }

  let res: Response;
  try {
    res = await fetchWithTimeout(url, {
      method: options?.method || "GET",
      headers,
      body: options?.body,
      credentials: "include",
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("timed out"))
      throw error;
    throw new Error(
      "Network unavailable. Check your connection and try again.",
    );
  }

  if (res.status === 401) {
    const payload = await res
      .clone()
      .json()
      .catch(() => ({}) as { code?: string });
    _unauthorizedHandler?.(payload.code);
  }
  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const baseUrl = getApiUrl();
    const url = new URL(queryKey.join("/") as string, baseUrl);
    const token = await getToken();

    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetchWithTimeout(url, {
      headers,
      credentials: "include",
    });

    if (res.status === 401) {
      // Fire the global handler so AuthProvider can clear state and redirect to login.
      // We call it here (not in throwIfResNotOk) so that mutation-level 401s (e.g.
      // wrong password on the login screen) are NOT misidentified as session expiry.
      const payload = await res
        .clone()
        .json()
        .catch(() => ({}) as { code?: string });
      _unauthorizedHandler?.(payload.code);
      if (unauthorizedBehavior === "returnNull") return null;
      const text = (await res.text()) || res.statusText;
      throw new ApiError(401, text);
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      // 5 minute stale time — data stays fresh for 5 min before refetching
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
    mutations: {
      retry: false,
    },
  },
});
