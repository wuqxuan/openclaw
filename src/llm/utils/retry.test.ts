import { describe, expect, it } from "vitest";
import type { AssistantMessage } from "../types.js";
import { isRetryableAssistantError, resolveAutoRetryDelayMs } from "./retry.js";

function errorMessage(message: string): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "test-api",
    provider: "test-provider",
    model: "test-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "error",
    errorMessage: message,
    timestamp: 1,
  };
}

describe("isRetryableAssistantError", () => {
  it.each([
    "An error occurred while processing your request. You can retry your request.",
    "The system encountered an unexpected error. Try your request again.",
    "Temporary provider failure; please retry your request.",
  ])("accepts explicit retry guidance: %s", (text) => {
    expect(isRetryableAssistantError(errorMessage(text))).toBe(true);
  });

  it("keeps concrete quota failures non-retryable", () => {
    expect(isRetryableAssistantError(errorMessage("429 insufficient_quota"))).toBe(false);
    expect(isRetryableAssistantError(errorMessage("Monthly usage limit reached"))).toBe(false);
  });

  it("retries transient billing-service failures", () => {
    expect(
      isRetryableAssistantError(
        errorMessage("503 billing service unavailable; please retry your request"),
      ),
    ).toBe(true);
  });

  it("retries short-window quota exhaustion", () => {
    expect(
      isRetryableAssistantError(
        errorMessage(
          "429 RESOURCE_EXHAUSTED: Quota exceeded for quota metric requests per minute; please retry your request",
        ),
      ),
    ).toBe(true);
  });
});

describe("resolveAutoRetryDelayMs", () => {
  it("uses Retry-After as a lower bound when it exceeds exponential backoff", () => {
    expect(
      resolveAutoRetryDelayMs({
        attempt: 1,
        baseDelayMs: 2000,
        retryAfterSeconds: 30,
        maxRetryDelayMs: 60_000,
      }),
    ).toBe(30_000);
  });

  it("keeps exponential backoff when Retry-After is shorter", () => {
    expect(
      resolveAutoRetryDelayMs({
        attempt: 3,
        baseDelayMs: 2000,
        retryAfterSeconds: 1,
        maxRetryDelayMs: 60_000,
      }),
    ).toBe(8000);
  });

  it("caps Retry-After at the configured provider max delay", () => {
    expect(
      resolveAutoRetryDelayMs({
        attempt: 1,
        baseDelayMs: 2000,
        retryAfterSeconds: 3600,
        maxRetryDelayMs: 60_000,
      }),
    ).toBe(60_000);
  });

  it("honors cooldowns above 60s when the operator raises maxRetryDelayMs", () => {
    expect(
      resolveAutoRetryDelayMs({
        attempt: 1,
        baseDelayMs: 2000,
        retryAfterSeconds: 90,
        maxRetryDelayMs: 120_000,
      }),
    ).toBe(90_000);
  });
});
