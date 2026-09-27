/**
 * Dynamic Expo app configuration.
 *
 * This file extends the static app.json and injects runtime/build-time values:
 *   - extra.apiUrl — read from EXPO_PUBLIC_API_URL at EAS build time
 *   - extra.eas.projectId — added by `eas init` when the project is linked
 *   - iOS buildNumber and Android versionCode (must increment for each store upload)
 *
 * To build for production:
 *   1. Set EXPO_PUBLIC_API_URL to the Railway URL in the EAS production environment
 *   2. Run: eas build --platform all --profile production
 */

export default ({ config }) => ({
  ...config,
  // Web is enabled only for local browser preview. EAS production builds
  // remain explicitly mobile-only through app.json.
  platforms:
    process.env.EXPO_PREVIEW_WEB === "1"
      ? ["ios", "android", "web"]
      : ["ios", "android"],
  ios: {
    ...config.ios,
    buildNumber: process.env.IOS_BUILD_NUMBER || "1",
  },
  android: {
    ...config.android,
    versionCode: Number.parseInt(process.env.ANDROID_VERSION_CODE || "1", 10),
  },
  extra: {
    // apiUrl is read by client/lib/query-client.ts via Constants.expoConfig.extra.apiUrl
    // In development, falls back to the local API URL from the expo:dev npm script.
    apiUrl: getApiUrl(),
    // EAS project ID — filled in automatically when the project is linked.
    eas: {
      projectId: getEasProjectId(config),
    },
  },
});

function getApiUrl() {
  const apiUrl =
    process.env.EXPO_PUBLIC_API_URL || process.env.EXPO_PUBLIC_DOMAIN || null;
  const isEasBuild = process.env.EAS_BUILD === "1";

  if (isEasBuild && !apiUrl) {
    throw new Error(
      "Missing EXPO_PUBLIC_API_URL for the EAS build. Configure the intended HTTPS API URL in the EAS preview or production environment.",
    );
  }

  if (isEasBuild && !/^https:\/\//i.test(apiUrl)) {
    throw new Error(
      "EXPO_PUBLIC_API_URL for an EAS build must be the intended HTTPS API URL.",
    );
  }

  if (apiUrl && !/^https?:\/\//i.test(apiUrl)) {
    return `https://${apiUrl}`;
  }

  return apiUrl?.replace(/\/$/, "") || null;
}

function getEasProjectId(config) {
  const projectId = config.extra?.eas?.projectId;
  if (process.env.EAS_BUILD === "1" && !projectId) {
    throw new Error(
      "EAS project is not linked. Run `eas init` with the owner account before starting an EAS build.",
    );
  }
  return projectId;
}
