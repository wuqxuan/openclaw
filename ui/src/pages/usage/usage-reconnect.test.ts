/* @vitest-environment jsdom */

import { nothing } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../../api/gateway.ts";
import type { ApplicationContext, ApplicationGatewaySnapshot } from "../../app/context.ts";
import type { UsageRouteData } from "./usage-page.ts";
import "./usage-page.ts";

type TestPage = HTMLElement & {
  context: ApplicationContext;
  routeData?: UsageRouteData;
  usageResult: UsageRouteData["result"];
  usageCostSummary: UsageRouteData["costSummary"];
  usageLoading: boolean;
  render: () => unknown;
  readonly updateComplete: Promise<boolean>;
};

function createMutableGateway(client: GatewayBrowserClient, connected: boolean) {
  let snapshot: ApplicationGatewaySnapshot = {
    client,
    connected,
    reconnecting: false,
    hello: null,
    assistantAgentId: null,
    sessionKey: "main",
    lastError: null,
    lastErrorCode: null,
  };
  const listeners = new Set<(next: ApplicationGatewaySnapshot) => void>();
  return {
    get snapshot() {
      return snapshot;
    },
    eventLog: [],
    subscribe(listener: (next: ApplicationGatewaySnapshot) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeEvents: () => () => undefined,
    subscribeEventLog: () => () => undefined,
    publish(next: Partial<ApplicationGatewaySnapshot>) {
      snapshot = { ...snapshot, ...next };
      for (const listener of listeners) {
        listener(snapshot);
      }
    },
  };
}

function createContext(gateway: ReturnType<typeof createMutableGateway>): ApplicationContext {
  const subscribe = () => () => undefined;
  return {
    basePath: "",
    gateway,
    agents: {
      state: { agentsList: null, agentsLoading: false, agentsError: null },
      ensureList: vi.fn(async () => null),
      subscribe,
    },
    agentIdentity: { get: () => undefined, ensure: vi.fn(async () => undefined), subscribe },
    agentSelection: {
      state: { selectedId: null, scopeId: null },
      set: vi.fn(),
      setScope: vi.fn(),
      subscribe,
    },
    channels: { subscribe },
    runtimeConfig: { state: { configSnapshot: null }, subscribe },
    sessions: {
      state: { result: null, loading: false },
      list: vi.fn(async () => null),
      subscribe,
    },
    workboard: { subscribe },
    navigate: vi.fn(),
    preload: vi.fn(async () => undefined),
  } as unknown as ApplicationContext;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("usage page reconnect refresh policy", () => {
  it("does not re-fetch sessions.usage or usage.cost on pure reconnect with fresh retained data", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.usage") {
        return { sessions: [{ key: "live" }] };
      }
      if (method === "usage.cost") {
        return { totals: { totalCost: 1 } };
      }
      if (method === "usage.status") {
        return null;
      }
      return {};
    });
    const client = { request } as unknown as GatewayBrowserClient;
    const gateway = createMutableGateway(client, true);
    const context = createContext(gateway);
    const retained = {
      sessions: [{ key: "retained" }],
    } as unknown as UsageRouteData["result"];
    const page = document.createElement("openclaw-usage-page") as TestPage;
    page.context = context;
    page.render = () => nothing;
    page.routeData = {
      gateway: context.gateway,
      gatewaySnapshot: gateway.snapshot,
      query: {
        startDate: "2026-07-15",
        endDate: "2026-07-15",
        scope: "family",
        timeZone: "local",
        agentId: null,
      },
      result: retained,
      costSummary: { totals: { totalCost: 2 } } as unknown as UsageRouteData["costSummary"],
      providerUsageSummary: null,
      error: null,
    };

    document.body.append(page);
    await page.updateComplete;
    expect(page.usageResult).toBe(retained);
    request.mockClear();

    // Transient drop keeps the same client identity (proxy idle timeout path).
    gateway.publish({ connected: false, reconnecting: true });
    await page.updateComplete;
    gateway.publish({ connected: true, reconnecting: false, client });
    await page.updateComplete;
    // Allow any accidental async load to schedule.
    await Promise.resolve();
    await Promise.resolve();

    expect(request).not.toHaveBeenCalled();
    expect(page.usageResult).toBe(retained);
  });

  it("still loads usage on first connect when no retained data exists", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.usage") {
        return { sessions: [{ key: "fresh" }] };
      }
      if (method === "usage.cost") {
        return { totals: { totalCost: 3 } };
      }
      if (method === "usage.status") {
        return null;
      }
      return {};
    });
    const client = { request } as unknown as GatewayBrowserClient;
    const gateway = createMutableGateway(client, false);
    const context = createContext(gateway);
    const page = document.createElement("openclaw-usage-page") as TestPage;
    page.context = context;
    page.render = () => nothing;
    page.routeData = {
      gateway: context.gateway,
      gatewaySnapshot: gateway.snapshot,
      query: {
        startDate: "2026-07-15",
        endDate: "2026-07-15",
        scope: "family",
        timeZone: "local",
        agentId: null,
      },
      result: null,
      costSummary: null,
      providerUsageSummary: null,
      error: null,
    };

    document.body.append(page);
    await page.updateComplete;
    request.mockClear();

    gateway.publish({ connected: true, client });
    await vi.waitFor(() => expect(request).toHaveBeenCalled());
    expect(request).toHaveBeenCalledWith("sessions.usage", expect.any(Object));
    expect(request).toHaveBeenCalledWith("usage.cost", expect.any(Object));
  });
});
