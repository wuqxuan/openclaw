import { describe, expect, it } from "vitest";
import {
  USAGE_RECONNECT_STALE_MS,
  shouldRefreshUsageOnReconnect,
} from "./usage-reconnect-refresh.ts";

describe("shouldRefreshUsageOnReconnect", () => {
  const base = {
    loadedAtMs: 1_000_000,
    nowMs: 1_000_000,
    visible: true,
  };

  it("loads when no retained usage/cost data is available", () => {
    expect(
      shouldRefreshUsageOnReconnect({
        ...base,
        hasRetainedData: false,
      }),
    ).toBe(true);
  });

  it("loads when retained data exists but has no load timestamp", () => {
    expect(
      shouldRefreshUsageOnReconnect({
        ...base,
        hasRetainedData: true,
        loadedAtMs: null,
      }),
    ).toBe(true);
  });

  it("reuses fresh retained data on reconnect", () => {
    expect(
      shouldRefreshUsageOnReconnect({
        ...base,
        hasRetainedData: true,
        nowMs: base.loadedAtMs! + USAGE_RECONNECT_STALE_MS - 1,
        visible: true,
      }),
    ).toBe(false);
  });

  it("refreshes stale retained data only when the document is visible", () => {
    expect(
      shouldRefreshUsageOnReconnect({
        ...base,
        hasRetainedData: true,
        nowMs: base.loadedAtMs! + USAGE_RECONNECT_STALE_MS,
        visible: true,
      }),
    ).toBe(true);
    expect(
      shouldRefreshUsageOnReconnect({
        ...base,
        hasRetainedData: true,
        nowMs: base.loadedAtMs! + USAGE_RECONNECT_STALE_MS,
        visible: false,
      }),
    ).toBe(false);
  });

  it("honors a custom stale window", () => {
    expect(
      shouldRefreshUsageOnReconnect({
        ...base,
        hasRetainedData: true,
        nowMs: base.loadedAtMs! + 1_000,
        visible: true,
        staleMs: 500,
      }),
    ).toBe(true);
  });
});
