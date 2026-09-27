import { Alert, Platform } from "react-native";

/**
 * Alert button arrays do not reliably render actionable buttons in the web
 * build. Keep the native confirmation UX, but use the browser's confirmation
 * dialog on web so destructive actions cannot silently stop after the tap.
 */
export function confirmAction(
  title: string,
  message: string,
  confirmLabel: string,
  danger = false,
): Promise<boolean> {
  if (Platform.OS === "web") {
    return Promise.resolve(
      typeof window !== "undefined" && window.confirm(`${title}\n\n${message}`),
    );
  }

  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        {
          text: confirmLabel,
          style: danger ? "destructive" : "default",
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

export function confirmDestructive(
  title: string,
  message: string,
  confirmLabel = "Delete",
): Promise<boolean> {
  return confirmAction(title, message, confirmLabel, true);
}
