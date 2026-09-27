import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View, ActivityIndicator, Platform } from "react-native";
import {
  NavigationContainer,
  DefaultTheme,
  DarkTheme,
} from "@react-navigation/native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import * as Font from "expo-font";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { navigationRef } from "@/lib/navigationRef";

import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";

import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { EventThemeProvider } from "@/contexts/EventThemeContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { useTheme } from "@/hooks/useTheme";
import RootStackNavigator from "@/navigation/RootStackNavigator";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { OfflineBanner } from "@/components/OfflineBanner";
import { Colors, AppColors } from "@/constants/theme";
import { createNotificationTapQueue } from "@/lib/notificationTapQueue";
import { reportClientError } from "@/lib/client-error-reporting";

// Show push notifications as banners even when the app is foregrounded.
// SDK 0.32+: shouldShowBanner (lock-screen / notification-center style) and
// shouldShowList (notification centre) replace the deprecated shouldShowAlert.
const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const notificationsSupported = Platform.OS !== "web" && !isExpoGo;

// Do not import expo-notifications in Expo Go. Its native module is loaded at
// import time and crashes Expo Go before any runtime feature guard can run.
const loadNotifications = () =>
  notificationsSupported ? import("expo-notifications") : Promise.resolve(null);
const LEGACY_COUNTDOWN_NOTIFICATION_PREFIX = "stress-congress-event-countdown-";

// Expo Go no longer includes the native push-notification module. The
// production development build and store builds do, so keep push handling
// enabled there while making the local Expo Go preview notification-free.
if (notificationsSupported) {
  loadNotifications().then((Notifications) => {
    Notifications?.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  });
}

function LegacyCountdownNotificationCleanup() {
  useEffect(() => {
    let active = true;

    void loadNotifications()
      .then(async (Notifications) => {
        if (!Notifications || !active) return;
        const scheduled =
          await Notifications.getAllScheduledNotificationsAsync();
        await Promise.all(
          scheduled
            .filter((item) =>
              item.identifier.startsWith(LEGACY_COUNTDOWN_NOTIFICATION_PREFIX),
            )
            .map((item) =>
              Notifications.cancelScheduledNotificationAsync(item.identifier),
            ),
        );
      })
      .catch(() => {
        // Legacy cleanup is best effort and must not block app startup.
      });

    return () => {
      active = false;
    };
  }, []);

  return null;
}

SplashScreen.preventAutoHideAsync();

const LightNavTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: Colors.light.backgroundRoot,
    card: Colors.light.backgroundDefault,
    text: Colors.light.text,
    border: Colors.light.border,
    primary: AppColors.accent,
  },
};

const DarkNavTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: Colors.dark.backgroundRoot,
    card: Colors.dark.backgroundDefault,
    text: Colors.dark.text,
    border: Colors.dark.border,
    primary: AppColors.accent,
  },
};

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}

function AppContent() {
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const { isDark } = useTheme();
  const [navigationReady, setNavigationReady] = useState(false);

  useEffect(() => {
    async function loadFonts() {
      try {
        await Font.loadAsync({
          feather: require("@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Feather.ttf"),
        });
      } catch (e) {
        console.warn("Font loading error:", e);
      } finally {
        setFontsLoaded(true);
        SplashScreen.hideAsync();
      }
    }
    loadFonts();
  }, []);

  if (!fontsLoaded) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const navTheme = isDark ? DarkNavTheme : LightNavTheme;

  return (
    <ErrorBoundary onError={reportClientError}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <EventThemeProvider>
            <SafeAreaProvider>
              <GestureHandlerRootView style={styles.root}>
                <KeyboardProvider>
                  <OfflineBanner />
                  <LegacyCountdownNotificationCleanup />
                  <NotificationResponseHandler
                    navigationReady={navigationReady}
                  />
                  <NavigationContainer
                    ref={navigationRef}
                    theme={navTheme}
                    onReady={() => setNavigationReady(true)}
                  >
                    <RootStackNavigator />
                  </NavigationContainer>
                  <StatusBar style={isDark ? "light" : "dark"} />
                </KeyboardProvider>
              </GestureHandlerRootView>
            </SafeAreaProvider>
          </EventThemeProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

function NotificationResponseHandler({
  navigationReady,
}: {
  navigationReady: boolean;
}) {
  const { isAuthenticated, isLoading } = useAuth();
  const tapQueueRef = useRef(createNotificationTapQueue());

  const navigateToNotifications = useCallback(() => {
    const ready =
      navigationReady &&
      navigationRef.isReady() &&
      isAuthenticated &&
      !isLoading;
    const pendingTapCount = tapQueueRef.current.consumeAllIfReady(ready);
    if (pendingTapCount === 0) return;

    // The Notifications screen fetches history for the authenticated
    // attendee's event. Never use a payload eventId to switch event context.
    for (let index = 0; index < pendingTapCount; index += 1) {
      navigationRef.navigate("Main", { screen: "Notifications" });
    }
  }, [isAuthenticated, isLoading, navigationReady]);

  useEffect(() => {
    // Expo notification response APIs are not available in the web preview.
    // Push notification handling is configured for native iOS/Android builds.
    let subscription: { remove: () => void } | null = null;
    let active = true;

    loadNotifications().then((Notifications) => {
      if (!Notifications || !active) return;
      subscription = Notifications.addNotificationResponseReceivedListener(
        (response) => {
          tapQueueRef.current.remember(response);
          navigateToNotifications();
        },
      );
      Notifications.getLastNotificationResponseAsync().then((response) => {
        if (!active || !response) return;
        tapQueueRef.current.remember(response);
        navigateToNotifications();
      });
    });

    return () => {
      active = false;
      subscription?.remove();
    };
  }, [navigateToNotifications]);

  useEffect(() => {
    navigateToNotifications();
  }, [navigateToNotifications]);

  return null;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});
