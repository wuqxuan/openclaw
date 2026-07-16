/**
 * sessions_yield built-in tool.
 *
 * Ends the current turn after subagent spawning so completion events can resume the session later.
 *
 * Contract:
 * - `message` is optional hidden follow-up context for the next turn (shipped semantics).
 * - `acknowledgment` is optional user-visible text delivered only when the turn has no
 *   other visible payload (explicit empty-turn ack; never inferred from `message`).
 */
import { Type } from "typebox";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";

const SessionsYieldToolSchema = Type.Object({
  /** Hidden continuation context for the next turn; not user-visible channel text. */
  message: Type.Optional(Type.String()),
  /** Optional user-visible acknowledgment for otherwise empty spawn-and-yield turns. */
  acknowledgment: Type.Optional(Type.String()),
});

/** Creates the sessions_yield tool for runtimes that support yield callbacks. */
export function createSessionsYieldTool(opts?: {
  sessionId?: string;
  onYield?: (message: string, acknowledgment?: string) => Promise<void> | void;
}): AnyAgentTool {
  return {
    label: "Yield",
    name: "sessions_yield",
    description:
      "End turn after subagent spawn; results arrive next message. " +
      "`message` stays hidden context; optional `acknowledgment` is user-visible on empty turns.",
    parameters: SessionsYieldToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      // Default keeps the shipped hidden-context contract when the model omits message.
      const message = readStringParam(params, "message") || "Turn yielded.";
      const acknowledgment = readStringParam(params, "acknowledgment");
      if (!opts?.sessionId) {
        return jsonResult({ status: "error", error: "No session context" });
      }
      if (!opts?.onYield) {
        return jsonResult({ status: "error", error: "Yield not supported in this context" });
      }
      // The runtime owns the actual pause/end-turn behavior; this tool records intent.
      await opts.onYield(message, acknowledgment || undefined);
      return jsonResult({
        status: "yielded",
        message,
        ...(acknowledgment ? { acknowledgment } : {}),
      });
    },
  };
}
