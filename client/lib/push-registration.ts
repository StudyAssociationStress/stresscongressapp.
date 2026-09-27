export interface PushNotificationsModule {
  getPermissionsAsync: () => Promise<{ status: string }>;
  requestPermissionsAsync: () => Promise<{ status: string }>;
  getExpoPushTokenAsync: (options?: {
    projectId?: string;
  }) => Promise<{ data: string }>;
}

export interface PushRegistrationDependencies {
  isSupported: boolean;
  projectId?: string;
  loadNotifications: () => Promise<PushNotificationsModule>;
  getDeviceId: () => Promise<string>;
  getApiUrl: () => string;
  fetchWithTimeout: (input: string, init?: RequestInit) => Promise<Response>;
  warn?: (message: string) => void;
}

/**
 * Register a device for push notifications without making it part of auth.
 *
 * Push is optional. A native-module failure, permission problem, token failure,
 * or rejected endpoint must resolve as an unsuccessful registration rather
 * than reject into the sign-in flow.
 */
export async function registerPushToken(
  authToken: string,
  dependencies: PushRegistrationDependencies,
): Promise<boolean> {
  if (!dependencies.isSupported) return false;

  try {
    const Notifications = await dependencies.loadNotifications();
    const { status: current } = await Notifications.getPermissionsAsync();
    let granted = current === "granted";
    if (!granted) {
      const { status } = await Notifications.requestPermissionsAsync();
      granted = status === "granted";
    }
    if (!granted) return false;

    const tokenData = await Notifications.getExpoPushTokenAsync(
      dependencies.projectId
        ? { projectId: dependencies.projectId }
        : undefined,
    );
    const deviceId = await dependencies.getDeviceId();
    const response = await dependencies.fetchWithTimeout(
      new URL("/api/users/push-token", dependencies.getApiUrl()).href,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ token: tokenData.data, deviceId }),
      },
    );
    if (!response.ok) {
      throw new Error("Push token endpoint rejected registration");
    }
    return true;
  } catch {
    // Do not include the error or token in logs. Some native SDK errors may
    // contain token details, and push registration must never affect auth.
    dependencies.warn?.(
      "[Push] Token registration unavailable; continuing without push.",
    );
    return false;
  }
}
