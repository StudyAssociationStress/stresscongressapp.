import Constants from "expo-constants";
import { Platform } from "react-native";
import { fetchWithTimeout, getApiUrl } from "@/lib/query-client";

type ClientErrorResponse = {
  clientErrorId?: string;
};

function trimForReport(value: string | undefined, maxLength: number): string {
  return (value || "").trim().slice(0, maxLength);
}

/**
 * Sends a redacted render error to the API. The server logs the returned
 * reference ID with the platform and app build so production issues can be
 * diagnosed without displaying a stack trace to attendees.
 */
export async function reportClientError(
  error: Error,
  componentStack: string,
): Promise<string | null> {
  try {
    const response = await fetchWithTimeout(
      new URL("/api/client-errors", getApiUrl()),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: Platform.OS,
          appVersion:
            Constants.nativeApplicationVersion ||
            Constants.expoConfig?.version ||
            "unknown",
          buildVersion: Constants.nativeBuildVersion || "unknown",
          osVersion: trimForReport(String(Platform.Version), 64),
          message: trimForReport(error.message, 1000),
          stack: trimForReport(error.stack, 6000),
          componentStack: trimForReport(componentStack, 6000),
        }),
      },
      5000,
    );

    if (!response.ok) return null;
    const payload = (await response.json()) as ClientErrorResponse;
    return payload.clientErrorId || null;
  } catch {
    // A failed diagnostic request must never make the fallback less useful.
    return null;
  }
}
