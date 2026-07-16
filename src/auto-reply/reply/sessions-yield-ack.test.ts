import { describe, expect, it } from "vitest";
import { resolveSessionsYieldAckPayload } from "./sessions-yield-ack.js";

describe("resolveSessionsYieldAckPayload", () => {
  it("emits the explicit acknowledgment when the turn has no other visible delivery", () => {
    expect(
      resolveSessionsYieldAckPayload({
        yielded: true,
        yieldAcknowledgment: "Research started, I'll send results shortly",
        isHeartbeat: false,
        isSubagentSession: false,
        hasVisibleDelivery: false,
      }),
    ).toEqual({ text: "Research started, I'll send results shortly" });
  });

  it("trims whitespace from the acknowledgment", () => {
    expect(
      resolveSessionsYieldAckPayload({
        yielded: true,
        yieldAcknowledgment: "  waiting on workers  ",
        isHeartbeat: false,
        isSubagentSession: false,
        hasVisibleDelivery: false,
      }),
    ).toEqual({ text: "waiting on workers" });
  });

  it("stays silent without a yield flag", () => {
    expect(
      resolveSessionsYieldAckPayload({
        yielded: false,
        yieldAcknowledgment: "should not show",
        isHeartbeat: false,
        isSubagentSession: false,
        hasVisibleDelivery: false,
      }),
    ).toBeUndefined();
  });

  it("stays silent when yield has no acknowledgment (hidden message is not used)", () => {
    // Regression: shipped `message` remains hidden continuation context and
    // must never be inferred as user-visible text by this resolver.
    expect(
      resolveSessionsYieldAckPayload({
        yielded: true,
        yieldAcknowledgment: "   ",
        isHeartbeat: false,
        isSubagentSession: false,
        hasVisibleDelivery: false,
      }),
    ).toBeUndefined();
    expect(
      resolveSessionsYieldAckPayload({
        yielded: true,
        isHeartbeat: false,
        isSubagentSession: false,
        hasVisibleDelivery: false,
      }),
    ).toBeUndefined();
  });

  it("does not duplicate when the turn already has visible delivery", () => {
    expect(
      resolveSessionsYieldAckPayload({
        yielded: true,
        yieldAcknowledgment: "Research started",
        isHeartbeat: false,
        isSubagentSession: false,
        hasVisibleDelivery: true,
      }),
    ).toBeUndefined();
  });

  it("keeps heartbeat yields internal", () => {
    expect(
      resolveSessionsYieldAckPayload({
        yielded: true,
        yieldAcknowledgment: "heartbeat yield",
        isHeartbeat: true,
        isSubagentSession: false,
        hasVisibleDelivery: false,
      }),
    ).toBeUndefined();
  });

  it("keeps subagent-session yields internal", () => {
    expect(
      resolveSessionsYieldAckPayload({
        yielded: true,
        yieldAcknowledgment: "child yield",
        isHeartbeat: false,
        isSubagentSession: true,
        hasVisibleDelivery: false,
      }),
    ).toBeUndefined();
  });
});
