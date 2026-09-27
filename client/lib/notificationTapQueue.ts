export function createNotificationTapQueue() {
  const pendingResponses: unknown[] = [];
  const rememberedResponseIds = new Set<string>();
  const rememberedResponses = new WeakSet<object>();

  function getResponseId(response: unknown): string | null {
    if (!response || typeof response !== "object") return null;

    const notification = (response as { notification?: unknown }).notification;
    if (!notification || typeof notification !== "object") return null;

    const request = (notification as { request?: unknown }).request;
    if (!request || typeof request !== "object") return null;

    const identifier = (request as { identifier?: unknown }).identifier;
    if (typeof identifier !== "string" || !identifier) return null;

    const actionIdentifier = (response as { actionIdentifier?: unknown })
      .actionIdentifier;
    return `${identifier}:${typeof actionIdentifier === "string" ? actionIdentifier : ""}`;
  }

  return {
    remember(response: unknown) {
      if (!response || typeof response !== "object") return;

      const responseId = getResponseId(response);
      if (responseId) {
        if (rememberedResponseIds.has(responseId)) return;
        rememberedResponseIds.add(responseId);
      } else {
        if (rememberedResponses.has(response)) return;
        rememberedResponses.add(response);
      }

      pendingResponses.push(response);
    },
    consumeIfReady(ready: boolean) {
      if (!ready || pendingResponses.length === 0) return false;
      pendingResponses.shift();
      return true;
    },
    consumeAllIfReady(ready: boolean) {
      if (!ready || pendingResponses.length === 0) return 0;
      const pendingCount = pendingResponses.length;
      pendingResponses.length = 0;
      return pendingCount;
    },
  };
}
