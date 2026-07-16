/**
 * Resolve a one-shot user-facing sessions_yield acknowledgment payload.
 *
 * Only emits when the attempt yielded with an explicit non-empty acknowledgment
 * and the turn produced no other visible delivery. Hidden `message` context is
 * never used here — that field remains internal continuation text.
 * Heartbeat and subagent sessions keep yields as internal context only.
 */
export function resolveSessionsYieldAckPayload(params: {
  /** Explicit user-visible acknowledgment only; never the hidden yield message. */
  yieldAcknowledgment?: string | null;
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
  const text =
    typeof params.yieldAcknowledgment === "string" ? params.yieldAcknowledgment.trim() : "";
  if (!text) {
    return undefined;
  }
  return { text };
}
