import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/useColorScheme";

export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "stress-congress-theme-mode";

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  isDark: boolean;
  theme: typeof Colors.light;
}

const fallbackThemeValue: ThemeContextValue = {
  mode: "system",
  setMode: () => {},
  isDark: false,
  theme: Colors.light,
};

const ThemeContext = createContext<ThemeContextValue>(fallbackThemeValue);

async function readStoredMode(): Promise<ThemeMode | null> {
  try {
    const value =
      Platform.OS === "web"
        ? localStorage.getItem(STORAGE_KEY)
        : await SecureStore.getItemAsync(STORAGE_KEY);
    return value === "system" || value === "light" || value === "dark"
      ? value
      : null;
  } catch {
    return null;
  }
}

async function storeMode(mode: ThemeMode): Promise<void> {
  try {
    if (Platform.OS === "web") localStorage.setItem(STORAGE_KEY, mode);
    else await SecureStore.setItemAsync(STORAGE_KEY, mode);
  } catch {
    // Theme selection remains active for the current session if persistence is unavailable.
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");

  useEffect(() => {
    void readStoredMode().then((stored) => {
      if (stored) setModeState(stored);
    });
  }, []);

  const setMode = (nextMode: ThemeMode) => {
    setModeState(nextMode);
    void storeMode(nextMode);
  };

  const isDark =
    mode === "dark" || (mode === "system" && systemScheme === "dark");
  const value = useMemo(
    () => ({ mode, setMode, isDark, theme: Colors[isDark ? "dark" : "light"] }),
    [mode, isDark],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
