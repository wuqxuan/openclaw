/**
 * Real behavior proof for #103846 / PR #103988.
 *
 * Exercises the production manager → lock → refreshCredential → getOAuthApiKey
 * → provider.refreshToken → persist path with a credential inside the shared
 * 5-minute pre-expiry margin. Only the provider network refresh is stubbed.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetFileLockStateForTest } from "../../infra/file-lock.js";
// Import the real oauth helper module path so shared Vitest mocks of
// `src/llm/oauth.js` do not replace register/refresh behavior for this proof.
import {
  getOAuthApiKey,
  registerOAuthProvider,
  resetOAuthProviders,
  type OAuthCredentials,
  type OAuthProviderInterface,
} from "../../llm/utils/oauth/index.js";
import { captureEnv } from "../../test-utils/env.js";
import { DEFAULT_OAUTH_REFRESH_MARGIN_MS, hasUsableOAuthCredential } from "./credential-state.js";
import { testing as externalAuthTesting } from "./external-auth.js";
import { createOAuthManager } from "./oauth-manager.js";
import {
  clearRuntimeAuthProfileStoreSnapshots,
  ensureAuthProfileStoreWithoutExternalProfiles,
  loadAuthProfileStoreWithoutExternalProfiles,
  saveAuthProfileStore,
} from "./store.js";
import type { OAuthCredential } from "./types.js";

const PROFILE_ID = "anthropic:default";
const PROVIDER = "anthropic";

const envSnapshot = captureEnv(["OPENCLAW_STATE_DIR", "OPENCLAW_AGENT_DIR"]);
const tempDirs: string[] = [];

function logProof(label: string, payload: unknown): void {
  // eslint-disable-next-line no-console -- proof transcript for PR body / CI logs
  console.log(`[oauth-margin-proof] ${label}: ${JSON.stringify(payload)}`);
}

async function withAgentDir(run: (agentDir: string) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-oauth-margin-proof-"));
  tempDirs.push(root);
  const agentDir = path.join(root, "agents", "main", "agent");
  await fs.mkdir(agentDir, { recursive: true });
  process.env.OPENCLAW_STATE_DIR = root;
  process.env.OPENCLAW_AGENT_DIR = agentDir;
  await run(agentDir);
}

function seedCredential(expires: number): OAuthCredential {
  return {
    type: "oauth",
    provider: PROVIDER,
    access: "stale-access-margin",
    refresh: "stale-refresh-margin",
    expires,
  };
}

function registerSpyProvider(refreshToken: OAuthProviderInterface["refreshToken"]): void {
  registerOAuthProvider({
    id: PROVIDER,
    name: "Anthropic (Claude Pro/Max)",
    async login() {
      throw new Error("login unused in margin proof");
    },
    refreshToken,
    getApiKey(creds: OAuthCredentials) {
      return creds.access;
    },
  } satisfies OAuthProviderInterface);
}

beforeEach(() => {
  resetFileLockStateForTest();
  clearRuntimeAuthProfileStoreSnapshots();
  externalAuthTesting.setResolveExternalAuthProfilesForTest(() => []);
  resetOAuthProviders();
});

afterEach(async () => {
  envSnapshot.restore();
  resetFileLockStateForTest();
  clearRuntimeAuthProfileStoreSnapshots();
  externalAuthTesting.resetResolveExternalAuthProfilesForTest();
  resetOAuthProviders();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("oauth refresh margin manager-path real behavior proof (#103846)", () => {
  it("refreshes and persists when manager needs refresh inside the pre-expiry margin", async () => {
    await withAgentDir(async (agentDir) => {
      const now = Date.now();
      const expires = now + 4 * 60 * 1000; // inside 5m margin, not raw-expired
      const stale = seedCredential(expires);
      const freshExpires = now + 3_600_000;
      const refreshToken = vi.fn(async (_creds: OAuthCredentials) => ({
        access: "fresh-access-margin",
        refresh: "fresh-refresh-margin",
        expires: freshExpires,
      }));
      registerSpyProvider(refreshToken);

      const managerNeedsRefresh = !hasUsableOAuthCredential(stale, {
        now,
        refreshMarginMs: DEFAULT_OAUTH_REFRESH_MARGIN_MS,
      });
      expect(managerNeedsRefresh).toBe(true);

      // Control: unmargined helper (main-era contract) is a silent no-op.
      const mainEra = await getOAuthApiKey(
        PROVIDER,
        { [PROVIDER]: { access: stale.access, refresh: stale.refresh, expires: stale.expires } },
        { now, refreshMarginMs: 0 },
      );
      expect(refreshToken).not.toHaveBeenCalled();
      expect(mainEra?.newCredentials.access).toBe(stale.access);

      saveAuthProfileStore(
        {
          version: 1,
          profiles: {
            [PROFILE_ID]: stale,
          },
        },
        agentDir,
        { filterExternalAuthProfiles: false },
      );

      // Production-shaped refresh: manager → refreshCredential → real getOAuthApiKey.
      const manager = createOAuthManager({
        buildApiKey: async (_provider, credential) => credential.access,
        refreshCredential: async (credential) => {
          const result = await getOAuthApiKey(PROVIDER, {
            [PROVIDER]: {
              access: credential.access,
              refresh: credential.refresh,
              expires: credential.expires,
            },
          });
          return result?.newCredentials ?? null;
        },
        readBootstrapCredential: () => null,
        isRefreshTokenReusedError: () => false,
      });

      const store = ensureAuthProfileStoreWithoutExternalProfiles(agentDir, {
        allowKeychainPrompt: false,
      });
      const result = await manager.resolveOAuthAccess({
        store,
        profileId: PROFILE_ID,
        credential: stale,
        agentDir,
      });

      expect(result?.apiKey).toBe("fresh-access-margin");
      expect(result?.credential.access).toBe("fresh-access-margin");
      expect(refreshToken).toHaveBeenCalledTimes(1);

      const reloaded = loadAuthProfileStoreWithoutExternalProfiles(agentDir);
      const persisted = reloaded.profiles[PROFILE_ID];
      expect(persisted?.type).toBe("oauth");
      if (persisted?.type !== "oauth") {
        throw new Error("expected persisted oauth credential");
      }
      expect(persisted.access).toBe("fresh-access-margin");
      expect(persisted.refresh).toBe("fresh-refresh-margin");
      expect(persisted.expires).toBe(freshExpires);

      logProof("result", {
        managerNeedsRefresh,
        networkRefreshCallWasMade: refreshToken.mock.calls.length === 1,
        returnedApiKey: result?.apiKey,
        mainEraNoOpAccess: mainEra?.newCredentials.access,
        persistedAccess: persisted.access,
        persistedExpires: persisted.expires,
        staleExpires: expires,
        marginMs: DEFAULT_OAUTH_REFRESH_MARGIN_MS,
        agentDirBasename: path.basename(path.dirname(path.dirname(agentDir))),
      });
    });
  });
});
