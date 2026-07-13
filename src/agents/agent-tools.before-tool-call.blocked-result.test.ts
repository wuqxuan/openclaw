import { describe, expect, it } from "vitest";
import { buildBlockedToolResult } from "./agent-tools.before-tool-call.js";
import { resetAdjustedParamsByToolCallIdForTests } from "./agent-tools.before-tool-call.state.js";

describe("buildBlockedToolResult", () => {
  it("terminates the agent run for critical tool-loop vetoes", () => {
    resetAdjustedParamsByToolCallIdForTests();
    const result = buildBlockedToolResult({
      reason: "CRITICAL: Called exec with identical arguments 10 times.",
      deniedReason: "tool-loop",
      toolCallId: "call-1",
      runId: "run-1",
    });
    expect(result.details).toMatchObject({
      status: "blocked",
      deniedReason: "tool-loop",
    });
    expect(result.terminate).toBe(true);
  });

  it("does not terminate plugin or approval vetoes", () => {
    resetAdjustedParamsByToolCallIdForTests();
    const plugin = buildBlockedToolResult({
      reason: "plugin denied",
      deniedReason: "plugin-before-tool-call",
    });
    const approval = buildBlockedToolResult({
      reason: "approval denied",
      deniedReason: "plugin-approval",
    });
    expect(plugin.terminate).toBeUndefined();
    expect(approval.terminate).toBeUndefined();
  });
});
