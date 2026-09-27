import { Alert, Platform } from "react-native";

export function requireAdminEvent(
  eventId: string | null | undefined,
  action = "continue",
): eventId is string {
  if (eventId) return true;

  const message = `No event is selected or created. Create an event or select one in the admin event switcher before you can ${action}.`;

  if (Platform.OS === "web") {
    const existing = document.getElementById("admin-event-required-error");
    existing?.remove();

    const panel = document.createElement("div");
    panel.id = "admin-event-required-error";
    panel.setAttribute("role", "alertdialog");
    panel.style.cssText = [
      "position:fixed",
      "z-index:2147483647",
      "top:24px",
      "left:50%",
      "transform:translateX(-50%)",
      "width:min(440px,calc(100vw - 32px))",
      "padding:20px",
      "border-radius:14px",
      "background:#fff",
      "border:2px solid #dc2626",
      "box-shadow:0 12px 40px rgba(0,0,0,.28)",
      "font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "color:#111827",
    ].join(";");

    const title = document.createElement("div");
    title.textContent = "Select an event first";
    title.style.cssText =
      "font-size:18px;font-weight:700;color:#b91c1c;margin-bottom:8px";

    const body = document.createElement("div");
    body.textContent = message;
    body.style.cssText = "font-size:14px;line-height:20px;margin-bottom:16px";

    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    close.style.cssText =
      "border:0;border-radius:8px;background:#b91c1c;color:#fff;padding:9px 18px;font-size:14px;font-weight:600;cursor:pointer";
    close.onclick = () => panel.remove();

    panel.append(title, body, close);
    document.body.appendChild(panel);
  } else {
    Alert.alert("Select an event first", message);
  }
  return false;
}
