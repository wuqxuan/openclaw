import type { AssistantMessage } from "../types.js";

/**
 * Resolve auto-retry sleep using exponential backoff as the floor and a validated
 * server Retry-After as a lower bound, capped by the operator max delay.
 */
export function resolveAutoRetryDelayMs(params: {
  attempt: number;
  baseDelayMs: number;
  retryAfterSeconds?: number;
  maxRetryDelayMs: number;
}): number {
  const attempt = Math.max(1, Math.trunc(params.attempt));
  const baseDelayMs = Math.max(0, params.baseDelayMs);
  const exponentialDelayMs = baseDelayMs * 2 ** (attempt - 1);
  const maxRetryDelayMs = Math.max(0, params.maxRetryDelayMs);
  const retryAfterSeconds = params.retryAfterSeconds;
  if (
    retryAfterSeconds === undefined ||
    !Number.isFinite(retryAfterSeconds) ||
    retryAfterSeconds < 0
  ) {
    return exponentialDelayMs;
  }
  // Cap server cooldown at the configured provider max so extreme Retry-After values
  // cannot stall a session indefinitely; values within the cap are honored in full.
  const retryAfterDelayMs = Math.min(maxRetryDelayMs, Math.ceil(retryAfterSeconds * 1000));
  return Math.max(exponentialDelayMs, retryAfterDelayMs);
}

function buildProviderErrorPattern(patterns: readonly string[]): RegExp {
  return new RegExp(patterns.join("|"), "i");
}

const NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN = buildProviderErrorPattern([
  "GoUsageLimitError",
  "FreeUsageLimitError",
  "Monthly usage limit reached",
  "available balance",
  "insufficient_quota",
  "out of budget",
]);

const RETRYABLE_PROVIDER_ERROR_PATTERN = buildProviderErrorPattern([
  "overloaded",
  "rate.?limit",
  "too many requests",
  "429",
  "500",
  "502",
  "503",
  "504",
  "service.?unavailable",
  "server.?error",
  "internal.?error",
  "provider.?returned.?error",
  "network.?error",
  "connection.?error",
  "connection.?refused",
  "connection.?lost",
  "other side closed",
  "fetch failed",
  "upstream.?connect",
  "reset before headers",
  "socket hang up",
  "timed? out",
  "timeout",
  "terminated",
  "websocket.?closed",
  "websocket.?error",
  "ended without",
  "stream ended before message_stop",
  "http2 request did not get a response",
  "retry delay",
  "you can retry your request",
  "try your request again",
  "please retry your request",
]);

/** Classify transient provider/transport failures for outer retry policy. */
export function isRetryableAssistantError(message: AssistantMessage): boolean {
  if (message.stopReason !== "error" || !message.errorMessage) {
    return false;
  }
  if (NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN.test(message.errorMessage)) {
    return false;
  }
  return RETRYABLE_PROVIDER_ERROR_PATTERN.test(message.errorMessage);
}
