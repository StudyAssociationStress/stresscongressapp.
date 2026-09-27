import { Platform } from "react-native";
import { useTheme } from "@/hooks/useTheme";

interface UseScreenOptionsParams {
  transparent?: boolean;
}

export function useScreenOptions({
  transparent = true,
}: UseScreenOptionsParams = {}) {
  const { theme, isDark } = useTheme();

  const isAndroid = Platform.OS === "android";
  const useTransparent = transparent && !isAndroid;

  return {
    headerTitleAlign: "center" as const,
    headerTransparent: useTransparent,
    headerBlurEffect: isDark ? ("dark" as const) : ("light" as const),
    headerTintColor: theme.text,
    headerStyle: {
      backgroundColor: useTransparent ? undefined : theme.backgroundRoot,
    },
    gestureEnabled: true,
    contentStyle: {
      backgroundColor: theme.backgroundRoot,
    },
  };
}

/**
 * Return the content offset required below a screen header.
 *
 * Android's native header is opaque and already participates in layout, while
 * the transparent header used on iOS and web overlays the screen content.
 */
export function getScreenContentTopPadding(
  headerHeight: number,
  spacing: number,
): number {
  return Platform.OS === "android" ? spacing : headerHeight + spacing;
}
