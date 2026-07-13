// Covers safe formatting of circular non-Error rejections for stream catch paths.
import { describe, expect, it } from "vitest";
import { formatUnknownError } from "./format-unknown-error.js";

describe("formatUnknownError", () => {
  it("prefers Error.message", () => {
    expect(formatUnknownError(new Error("boom"))).toBe("boom");
  });

  it("JSON-stringifies ordinary non-Error values", () => {
    expect(formatUnknownError({ code: "ECONNRESET" })).toBe('{"code":"ECONNRESET"}');
    expect(formatUnknownError("plain")).toBe('"plain"');
    expect(formatUnknownError(42)).toBe("42");
  });

  it("falls back to String for circular structures without throwing", () => {
    const circular: Record<string, unknown> = { kind: "provider-reject" };
    circular.self = circular;
    expect(() => JSON.stringify(circular)).toThrow();
    const formatted = formatUnknownError(circular);
    expect(typeof formatted).toBe("string");
    expect(formatted.length).toBeGreaterThan(0);
    expect(formatted).toContain("Object");
  });

  it("returns a stable literal when String conversion throws", () => {
    // Reach the String fallback with a circular null-prototype object:
    // JSON.stringify throws on the cycle, and String() throws without Object.prototype.
    const nullProto = Object.create(null) as Record<string, unknown>;
    nullProto.kind = "null-proto-reject";
    nullProto.self = nullProto;
    expect(() => JSON.stringify(nullProto)).toThrow();
    expect(() => String(nullProto)).toThrow();
    expect(formatUnknownError(nullProto)).toBe("Unknown error");

    // Hostile conversion hooks with a cycle force the same final fallback.
    const hostile: {
      self?: unknown;
      toString: () => string;
      valueOf: () => number;
    } = {
      toString() {
        throw new Error("toString blocked");
      },
      valueOf() {
        throw new Error("valueOf blocked");
      },
    };
    hostile.self = hostile;
    expect(() => JSON.stringify(hostile)).toThrow();
    expect(() => String(hostile)).toThrow();
    expect(formatUnknownError(hostile)).toBe("Unknown error");
  });
});
