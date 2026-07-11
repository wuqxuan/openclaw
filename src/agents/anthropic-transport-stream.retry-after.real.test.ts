/**
 * Real local-stub proof for Anthropic 429 Retry-After preservation.
 * Uses a loopback HTTP server and the production transport stream function
 * (including buildGuardedModelFetch); only the provider endpoint is stubbed.
 */
import http from "node:http";
import type { Model } from "openclaw/plugin-sdk/llm";
import { afterEach, describe, expect, it } from "vitest";
import { createAnthropicMessagesTransportStreamFn } from "./anthropic-transport-stream.js";

type AnthropicMessagesModel = Model<"anthropic-messages">;

function waitForServerListening(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Expected loopback server to listen on a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
}

async function closeServer(server: http.Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

describe("anthropic transport Retry-After real stub", () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    if (server) {
      await closeServer(server);
      server = undefined;
    }
  });

  it("preserves HTTP status and Retry-After through the production stream path", async () => {
    let requestCount = 0;
    server = http.createServer((request, response) => {
      requestCount += 1;
      // Drain the body so the client is not left hanging on a half-open socket.
      request.resume();
      response.writeHead(429, {
        "content-type": "application/json",
        "retry-after": "30",
      });
      response.end(
        JSON.stringify({
          type: "error",
          error: {
            type: "rate_limit_error",
            message: "Number of request tokens has exceeded your per-minute rate limit.",
          },
        }),
      );
    });
    const port = await waitForServerListening(server);
    const model = {
      id: "claude-sonnet-4-6",
      name: "Claude Sonnet 4.6",
      api: "anthropic-messages",
      provider: "anthropic",
      baseUrl: `http://127.0.0.1:${port}`,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 1024,
    } satisfies AnthropicMessagesModel;

    const streamFn = createAnthropicMessagesTransportStreamFn();
    const stream = await Promise.resolve(
      streamFn(
        model,
        {
          messages: [{ role: "user", content: "hello" }],
        } as never,
        { apiKey: "sk-ant-test-key" } as never,
      ),
    );
    const result = await stream.result();

    expect(requestCount).toBe(1);
    expect(result.stopReason).toBe("error");
    expect(result.httpStatus).toBe(429);
    expect(result.retryAfterSeconds).toBe(30);
    expect(result.errorMessage ?? "").toContain("rate_limit_error");
  });
});
