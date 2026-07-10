import { describe, expect, it } from "vitest";
import { normalizePlainTextToolCallStreamEvents } from "./stream-normalizer.js";

async function collect(source: AsyncIterable<unknown>): Promise<unknown[]> {
  const items: unknown[] = [];
  for await (const item of source) {
    items.push(item);
  }
  return items;
}

const matcher = {
  hasExactName: (name: string) => name === "get_system_info",
  hasNamePrefix: (prefix: string) => "get_system_info".startsWith(prefix),
};

describe("normalizePlainTextToolCallStreamEvents", () => {
  it("promotes a complete zero-argument XML tool call without leaking the text delta", async () => {
    const promotedMessage = {
      role: "assistant",
      content: [],
      toolCalls: [{ name: "get_system_info", arguments: {} }],
    };

    const result = await collect(
      normalizePlainTextToolCallStreamEvents(
        (async function* () {
          yield { type: "text_delta", delta: "<function=get_system_info></function>" };
          yield {
            type: "done",
            message: { content: "<function=get_system_info></function>" },
            reason: "stop",
          };
        })(),
        {
          matcher,
          normalizeDoneMessage: () => ({ kind: "promoted", message: promotedMessage }),
          createPromotedToolCallEvents: (message) => [{ type: "tool_call", message }],
        },
      ),
    );

    // If the stream normalizer treated </function> as impossible, the text_delta
    // would flush before promotion. Keeping it buffered lets promotion hide it.
    expect(result).toEqual([
      { type: "tool_call", message: promotedMessage },
      { type: "done", reason: "toolUse", message: promotedMessage },
    ]);
  });

  it("still flushes ordinary non-tool text immediately", async () => {
    const result = await collect(
      normalizePlainTextToolCallStreamEvents(
        (async function* () {
          yield { type: "text_delta", delta: "hello world" };
          yield { type: "done", message: { content: "hello world" }, reason: "stop" };
        })(),
        {
          matcher,
          normalizeDoneMessage: () => undefined,
          createPromotedToolCallEvents: () => [],
        },
      ),
    );

    expect(result).toEqual([
      { type: "text_delta", delta: "hello world" },
      { type: "done", message: { content: "hello world" }, reason: "stop" },
    ]);
  });
});
