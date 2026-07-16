/**
 * Resolve a one-shot user-facing sessions_yield acknowledgment payload.
 *
 * Only emits when the attempt yielded with a non-empty message and the turn
 * produced no other visible delivery. Heartbeat and subagent sessions keep the
 * message as internal context only.
 */
export function resolveSessionsYieldAckPayload(params: {
  yieldMessage?: string | null;
  yielded?: boolean;
  isHeartbeat: boolean;
  isSubagentSession: boolean;
  hasVisibleDelivery: boolean;
}): { text: string } | undefined {
  if (params.yielded !== true) {
    return undefined;
  }
  if (params.isHeartbeat || params.isSubagentSession || params.hasVisibleDelivery) {
    return undefined;
  }
  const text = typeof params.yieldMessage === "string" ? params.yieldMessage.trim() : "";
  if (!text) {
    return undefined;
  }
  return { text };
}
