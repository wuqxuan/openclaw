import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OAUTH_REFRESH_MARGIN_MS,
  hasUsableOAuthCredential,
} from "../../../agents/auth-profiles/credential-state.js";
import {
  getOAuthApiKey,
  OAUTH_API_KEY_REFRESH_MARGIN_MS,
  registerOAuthProvider,
  resetOAuthProviders,
} from "./index.js";
import type { OAuthCredentials, OAuthProviderInterface } from "./types.js";

afterEach(() => {
  resetOAuthProviders();
  vi.restoreAllMocks();
});

function registerAnthropicProvider(refreshToken: OAuthProviderInterface["refreshToken"]) {
  registerOAuthProvider({
    id: "anthropic",
    name: "Anthropic (Claude Pro/Max)",
    async login() {
      throw new Error("unused");
    },
    refreshToken,
    getApiKey(creds: OAuthCredentials) {
      return creds.access;
    },
  } satisfies OAuthProviderInterface);
}

describe("getOAuthApiKey refresh margin", () => {
  it("keeps the oauth api-key margin aligned with auth-profiles default", () => {
    expect(OAUTH_API_KEY_REFRESH_MARGIN_MS).toBe(DEFAULT_OAUTH_REFRESH_MARGIN_MS);
  });

  it("refreshes when the credential is inside the shared pre-expiry margin", async () => {
    const now = 1_700_000_000_000;
    const expires = now + 4 * 60 * 1000;
    const stale: OAuthCredentials = {
      access: "stale-access",
      refresh: "stale-refresh",
      expires,
    };
    const refreshToken = vi.fn(async (_creds: OAuthCredentials) => ({
      access: "fresh-access",
      refresh: "fresh-refresh",
      expires: now + 3_600_000,
    }));
    registerAnthropicProvider(refreshToken);

    const managerSaysUsable = hasUsableOAuthCredential(
      {
        type: "oauth",
        provider: "anthropic",
        access: stale.access,
        refresh: stale.refresh,
        expires,
      },
      { now, refreshMarginMs: DEFAULT_OAUTH_REFRESH_MARGIN_MS },
    );
    expect(managerSaysUsable).toBe(false);

    const result = await getOAuthApiKey("anthropic", { anthropic: stale }, { now });
    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      apiKey: "fresh-access",
      newCredentials: {
        access: "fresh-access",
        refresh: "fresh-refresh",
        expires: now + 3_600_000,
      },
    });
  });

  it("does not refresh when the credential is still outside the margin", async () => {
    const now = 1_700_000_000_000;
    const expires = now + DEFAULT_OAUTH_REFRESH_MARGIN_MS + 60_000;
    const fresh: OAuthCredentials = {
      access: "fresh-access",
      refresh: "fresh-refresh",
      expires,
    };
    const refreshToken = vi.fn(async (creds: OAuthCredentials) => creds);
    registerAnthropicProvider(refreshToken);

    expect(
      hasUsableOAuthCredential(
        {
          type: "oauth",
          provider: "anthropic",
          access: fresh.access,
          refresh: fresh.refresh,
          expires,
        },
        { now, refreshMarginMs: DEFAULT_OAUTH_REFRESH_MARGIN_MS },
      ),
    ).toBe(true);

    const result = await getOAuthApiKey("anthropic", { anthropic: fresh }, { now });
    expect(refreshToken).not.toHaveBeenCalled();
    expect(result).toEqual({
      apiKey: "fresh-access",
      newCredentials: fresh,
    });
  });

  it("still refreshes when the raw expires timestamp has already elapsed", async () => {
    const now = 1_700_000_000_000;
    const expires = now - 1;
    const stale: OAuthCredentials = {
      access: "stale-access",
      refresh: "stale-refresh",
      expires,
    };
    const refreshToken = vi.fn(async (_creds: OAuthCredentials) => ({
      access: "fresh-access",
      refresh: "fresh-refresh",
      expires: now + 3_600_000,
    }));
    registerAnthropicProvider(refreshToken);

    const result = await getOAuthApiKey("anthropic", { anthropic: stale }, { now });
    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(result?.apiKey).toBe("fresh-access");
  });

  it("allows callers to disable the pre-expiry margin", async () => {
    const now = 1_700_000_000_000;
    const expires = now + 4 * 60 * 1000;
    const stale: OAuthCredentials = {
      access: "stale-access",
      refresh: "stale-refresh",
      expires,
    };
    const refreshToken = vi.fn(async (creds: OAuthCredentials) => creds);
    registerAnthropicProvider(refreshToken);

    const result = await getOAuthApiKey(
      "anthropic",
      { anthropic: stale },
      { now, refreshMarginMs: 0 },
    );
    expect(refreshToken).not.toHaveBeenCalled();
    expect(result?.newCredentials).toEqual(stale);
  });
});
