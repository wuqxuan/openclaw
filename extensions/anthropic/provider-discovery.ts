/**
 * Claude CLI provider discovery descriptor. It exposes subscription-backed
 * synthetic auth for catalog/runtime discovery without full Anthropic registration.
 */
import type { ProviderPlugin } from "openclaw/plugin-sdk/provider-model-shared";
import { readClaudeCliCredentialsForRuntime } from "./cli-auth-seam.js";
import { CLAUDE_CLI_API_KEY_HELPER_AUTH_MARKER, CLAUDE_CLI_BACKEND_ID } from "./cli-constants.js";

function resolveClaudeCliSyntheticAuth() {
  const credential = readClaudeCliCredentialsForRuntime();
  if (!credential) {
    return undefined;
  }
  if (credential.type === "api-key-helper") {
    return {
      apiKey: CLAUDE_CLI_API_KEY_HELPER_AUTH_MARKER,
      source: "Claude CLI apiKeyHelper auth",
      mode: "api-key" as const,
    };
  }
  return credential.type === "oauth"
    ? {
        apiKey: credential.access,
        source: "Claude CLI native auth",
        mode: "oauth" as const,
        expiresAt: credential.expires,
      }
    : {
        apiKey: credential.token,
        source: "Claude CLI native auth",
        mode: "token" as const,
        expiresAt: credential.expires,
      };
}

const anthropicProviderDiscovery: ProviderPlugin = {
  id: CLAUDE_CLI_BACKEND_ID,
  label: "Claude CLI",
  docsPath: "/providers/models",
  auth: [],
  resolveSyntheticAuth: ({ provider }) =>
    provider === CLAUDE_CLI_BACKEND_ID ? resolveClaudeCliSyntheticAuth() : undefined,
};

export default anthropicProviderDiscovery;
