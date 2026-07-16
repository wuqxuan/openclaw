import { describe, expect, it } from "vitest";
import { resolveSessionsYieldAckPayload } from "./sessions-yield-ack.js";

describe("resolveSessionsYieldAckPayload", () => {
  it("emits the yield message when the turn has no other visible delivery", () => {
    expect(
      resolveSessionsYieldAckPayload({
        yielded: true,
        yieldMessage: "Research started, I'll send results shortly",
        isHeartbeat: false,
        isSubagentSession: false,
        hasVisibleDelivery: false,
      }),
    ).toEqual({ text: "Research started, I'll send results shortly" });
  });

  it("trims whitespace from the yield message", () => {
    expect(
      resolveSessionsYieldAckPayload({
        yielded: true,
        yieldMessage: "  waiting on workers  ",
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
        yieldMessage: "should not show",
        isHeartbeat: false,
        isSubagentSession: false,
        hasVisibleDelivery: false,
      }),
    ).toBeUndefined();
  });

  it("stays silent when yield has no message", () => {
    expect(
      resolveSessionsYieldAckPayload({
        yielded: true,
        yieldMessage: "   ",
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
        yieldMessage: "Research started",
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
        yieldMessage: "heartbeat yield",
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
        yieldMessage: "child yield",
        isHeartbeat: false,
        isSubagentSession: true,
        hasVisibleDelivery: false,
      }),
    ).toBeUndefined();
  });
});
