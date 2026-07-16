// sessions_yield tool tests cover cooperative turn yielding and unsupported
// context errors.
import { describe, expect, it, vi } from "vitest";
import { createSessionsYieldTool } from "./sessions-yield-tool.js";

type SessionsYieldDetails = {
  status?: string;
  message?: string;
  acknowledgment?: string;
  error?: string;
};

describe("sessions_yield tool", () => {
  it("returns error when no sessionId is provided", async () => {
    const onYield = vi.fn();
    const tool = createSessionsYieldTool({ onYield });
    const result = await tool.execute("call-1", {});
    const details = result.details as SessionsYieldDetails;
    expect(details.status).toBe("error");
    expect(details.error).toBe("No session context");
    expect(onYield).not.toHaveBeenCalled();
  });

  it("invokes onYield callback with default message and no acknowledgment", async () => {
    const onYield = vi.fn();
    const tool = createSessionsYieldTool({ sessionId: "test-session", onYield });
    const result = await tool.execute("call-1", {});
    const details = result.details as SessionsYieldDetails;
    expect(details.status).toBe("yielded");
    expect(details.message).toBe("Turn yielded.");
    expect(details.acknowledgment).toBeUndefined();
    expect(onYield).toHaveBeenCalledOnce();
    // Hidden default only — no user-visible acknowledgment inferred.
    expect(onYield).toHaveBeenCalledWith("Turn yielded.", undefined);
  });

  it("passes the custom message through the yield callback as hidden context only", async () => {
    // The callback message becomes hidden scheduler/next-turn context, so the
    // tool must not replace a supplied reason with the default text.
    const onYield = vi.fn();
    const tool = createSessionsYieldTool({ sessionId: "test-session", onYield });
    const result = await tool.execute("call-1", { message: "Waiting for fact-checker" });
    const details = result.details as SessionsYieldDetails;
    expect(details.status).toBe("yielded");
    expect(details.message).toBe("Waiting for fact-checker");
    expect(details.acknowledgment).toBeUndefined();
    expect(onYield).toHaveBeenCalledOnce();
    expect(onYield).toHaveBeenCalledWith("Waiting for fact-checker", undefined);
  });

  it("passes an explicit acknowledgment separately from hidden message", async () => {
    const onYield = vi.fn();
    const tool = createSessionsYieldTool({ sessionId: "test-session", onYield });
    const result = await tool.execute("call-1", {
      message: "internal: wait for fact-checker",
      acknowledgment: "Research started, I'll send results shortly",
    });
    const details = result.details as SessionsYieldDetails;
    expect(details.status).toBe("yielded");
    expect(details.message).toBe("internal: wait for fact-checker");
    expect(details.acknowledgment).toBe("Research started, I'll send results shortly");
    expect(onYield).toHaveBeenCalledOnce();
    expect(onYield).toHaveBeenCalledWith(
      "internal: wait for fact-checker",
      "Research started, I'll send results shortly",
    );
  });

  it("returns error without onYield callback", async () => {
    const tool = createSessionsYieldTool({ sessionId: "test-session" });
    const result = await tool.execute("call-1", {});
    const details = result.details as SessionsYieldDetails;
    expect(details.status).toBe("error");
    expect(details.error).toBe("Yield not supported in this context");
  });
});
