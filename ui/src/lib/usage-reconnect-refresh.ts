/**
 * Control UI usage/cost loads are expensive on the gateway. After a transient
 * websocket drop, reconnect rehydration should reuse already-loaded data
 * instead of reissuing sessions.usage + usage.cost on every connect.
 *
 * Refresh on reconnect only when there is no retained payload yet, or when the
 * retained payload is past the stale window and the document is visible.
 * Explicit operator refresh always bypasses this policy.
 */

/** Default TTL for reconnect-time auto-refresh of usage/cost payloads. */
export const USAGE_RECONNECT_STALE_MS = 5 * 60 * 1000;

export type UsageReconnectRefreshInput = {
  hasRetainedData: boolean;
  loadedAtMs: number | null;
  nowMs: number;
  visible: boolean;
  staleMs?: number;
};

/**
 * Decide whether a gateway reconnect should re-fetch usage/cost data.
 * Client identity changes still force a full reset/load outside this helper.
 */
export function shouldRefreshUsageOnReconnect(input: UsageReconnectRefreshInput): boolean {
  if (!input.hasRetainedData || input.loadedAtMs == null) {
    return true;
  }
  const staleMs = input.staleMs ?? USAGE_RECONNECT_STALE_MS;
  const stale = input.nowMs - input.loadedAtMs >= staleMs;
  return stale && input.visible;
}

export function isDocumentVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}
