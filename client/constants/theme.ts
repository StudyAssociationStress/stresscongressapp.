import { Platform } from "react-native";

export const AppColors = {
  primary: "#4F46E5",
  primaryLight: "#6366F1",
  accent: "#f78f1e",
  accentLight: "#f9a84d",
  success: "#22C55E",
  warning: "#f78f1e",
  error: "#EF4444",
  white: "#FFFFFF",
  black: "#000000",
};

function parseHexColor(value: string): [number, number, number] | null {
  const normalized = value.trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  return [
    parseInt(normalized.slice(0, 2), 16),
    parseInt(normalized.slice(2, 4), 16),
    parseInt(normalized.slice(4, 6), 16),
  ];
}

function getRelativeLuminance(value: string): number {
  const rgb = parseHexColor(value);
  if (!rgb) return 0.05;

  return rgb.reduce((luminance, channel, index) => {
    const normalized = channel / 255;
    const linear =
      normalized <= 0.03928
        ? normalized / 12.92
        : Math.pow((normalized + 0.055) / 1.055, 2.4);
    const weight = [0.2126, 0.7152, 0.0722][index];
    return luminance + linear * weight;
  }, 0);
}

function getContrastRatio(luminance: number, foreground: "light" | "dark") {
  const foregroundLuminance = foreground === "light" ? 1 : 0;
  const lighter = Math.max(luminance, foregroundLuminance);
  const darker = Math.min(luminance, foregroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function getRequiredOverlayAlpha(
  luminance: number,
  foreground: "light" | "dark",
): number {
  const targetLuminance = foreground === "light" ? 0.1833 : 0.175;
  if (foreground === "light") {
    return luminance > targetLuminance ? 1 - targetLuminance / luminance : 0;
  }
  return luminance < targetLuminance
    ? (targetLuminance - luminance) / (1 - luminance)
    : 0;
}

export function getReadableEventGradient(
  start: string,
  end: string,
): [string, string] {
  // Keep the administrator's saved colors intact. Readability is handled by
  // getEventGradientReadability instead of silently swapping the gradient.
  return [start, end];
}

export interface EventGradientReadability {
  foreground: "#FFFFFF" | "#111827";
  mutedForeground: string;
  overlay: string;
  adjusted: boolean;
}

export function getEventGradientReadability(
  start: string,
  end: string,
): EventGradientReadability {
  const luminances = [start, end].map(getRelativeLuminance);
  const lightContrast = Math.min(
    ...luminances.map((luminance) => getContrastRatio(luminance, "light")),
  );
  const darkContrast = Math.min(
    ...luminances.map((luminance) => getContrastRatio(luminance, "dark")),
  );
  const useLightForeground = lightContrast >= darkContrast;
  const foreground = useLightForeground ? "#FFFFFF" : "#111827";
  const overlayAlpha = Math.min(
    0.9,
    Math.max(
      ...luminances.map((luminance) =>
        getRequiredOverlayAlpha(
          luminance,
          useLightForeground ? "light" : "dark",
        ),
      ),
    ),
  );

  return {
    foreground,
    mutedForeground: useLightForeground
      ? "rgba(255,255,255,0.76)"
      : "rgba(17,24,39,0.76)",
    overlay: useLightForeground
      ? `rgba(0,0,0,${overlayAlpha.toFixed(2)})`
      : `rgba(255,255,255,${overlayAlpha.toFixed(2)})`,
    adjusted: overlayAlpha > 0.01,
  };
}

export function getReadableTextColor(value: string): "#FFFFFF" | "#111827" {
  const luminance = getRelativeLuminance(value);
  return getContrastRatio(luminance, "light") >=
    getContrastRatio(luminance, "dark")
    ? "#FFFFFF"
    : "#111827";
}

export const Colors = {
  light: {
    text: "#18181B",
    textSecondary: "#71717A",
    textTertiary: "#A1A1AA",
    buttonText: "#FFFFFF",
    tabIconDefault: "#A1A1AA",
    tabIconSelected: "#4F46E5",
    link: "#3730A3",
    backgroundRoot: "#F7F6F3",
    backgroundDefault: "#FFFFFF",
    backgroundSecondary: "#F0EEE9",
    backgroundTertiary: "#E8E5DF",
    border: "#EBEBEB",
    borderSubtle: "#F2F2F2",
    primary: "#4F46E5",
    primaryLight: "#6366F1",
    accent: "#f78f1e",
    success: "#22C55E",
    warning: "#f78f1e",
    error: "#EF4444",
    cardBackground: "#FFFFFF",
    cardBorder: "#F0EEE9",
    drawerBackground: "#FAFAF8",
    drawerActiveBackground: "#FFF4E5",
    drawerActiveTint: "#f78f1e",
    drawerInactiveTint: "#71717A",
  },
  dark: {
    text: "#F8FAFC",
    textSecondary: "#CBD5E1",
    textTertiary: "#94A3B8",
    buttonText: "#FFFFFF",
    tabIconDefault: "#94A3B8",
    tabIconSelected: "#818CF8",
    link: "#A5B4FC",
    backgroundRoot: "#101318",
    backgroundDefault: "#171B22",
    backgroundSecondary: "#202631",
    backgroundTertiary: "#2A3340",
    border: "#3E4A5B",
    borderSubtle: "#303A48",
    primary: "#6366F1",
    primaryLight: "#818CF8",
    accent: "#f78f1e",
    success: "#22C55E",
    warning: "#f78f1e",
    error: "#EF4444",
    cardBackground: "#171B22",
    cardBorder: "#3E4A5B",
    drawerBackground: "#0D1117",
    drawerActiveBackground: "#818CF81A",
    drawerActiveTint: "#f78f1e",
    drawerInactiveTint: "#B8C4D6",
  },
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 28,
  "3xl": 36,
  "4xl": 48,
  "5xl": 60,
  "6xl": 80,
  inputHeight: 56,
  buttonHeight: 56,
};

export const BorderRadius = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  "2xl": 32,
  "3xl": 40,
  full: 9999,
};

export const Typography = {
  h1: {
    fontSize: 34,
    lineHeight: 42,
    fontWeight: "700" as const,
    letterSpacing: -0.5,
  },
  h2: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: "700" as const,
    letterSpacing: -0.3,
  },
  h3: {
    fontSize: 22,
    lineHeight: 30,
    fontWeight: "600" as const,
    letterSpacing: -0.2,
  },
  h4: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "600" as const,
    letterSpacing: -0.1,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "400" as const,
  },
  small: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "400" as const,
  },
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "400" as const,
  },
  link: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "500" as const,
  },
};

export const Shadows = {
  small: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  medium: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 16,
    elevation: 3,
  },
  large: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 6,
  },
  card: {
    shadowColor: "#1A1A2E",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
};

export const Fonts = Platform.select({
  ios: {
    sans: "system-ui",
    serif: "ui-serif",
    rounded: "ui-rounded",
    mono: "ui-monospace",
  },
  default: {
    sans: "sans-serif",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded:
      "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
