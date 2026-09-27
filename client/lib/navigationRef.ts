import { createNavigationContainerRef } from "@react-navigation/native";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

/**
 * Global navigation ref — used by the push notification tap handler in App.tsx
 * to navigate to the Notifications screen even when the navigator is not in scope.
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
