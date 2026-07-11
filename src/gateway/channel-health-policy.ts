// Gateway channel health policy.
// Evaluates channel lifecycle snapshots for restart/readiness decisions.
import type { ChannelId } from "../channels/plugins/types.public.js";

type ChannelHealthSnapshot = {
  running?: boolean;
  connected?: boolean;
  enabled?: boolean;
  configured?: boolean;
  restartPending?: boolean;
  busy?: boolean;
  activeRuns?: number;
  lastRunActivityAt?: number | null;
  lastEventAt?: number | null;
  lastConnectedAt?: number | null;
  lastTransportActivityAt?: number | null;
  lastStartAt?: number | null;
  reconnectAttempts?: number;
  mode?: string;
  terminalDisconnect?: boolean;
};

type ChannelHealthEvaluationReason =
  | "healthy"
  | "unmanaged"
  | "not-running"
  | "terminal-disconnect"
  | "busy"
  | "stuck"
  | "startup-connect-grace"
  | "disconnected"
  | "stale-socket";

export type ChannelHealthEvaluation = {
  healthy: boolean;
  reason: ChannelHealthEvaluationReason;
};

export type ChannelHealthPolicy = {
  channelId: ChannelId;
  now: number;
  staleEventThresholdMs: number;
  channelConnectGraceMs: number;
};

type ChannelRestartReason = "gave-up" | "stopped" | "stale-socket" | "stuck" | "disconnected";

/** Must match manager crash-loop bound in `server-channels.ts` (`MAX_RESTART_ATTEMPTS`). */
export const CHANNEL_MAX_RESTART_ATTEMPTS = 10;

/**
 * Who owns recovery for a stopped/unhealthy account snapshot.
 * Manager backoff and terminal give-up are authoritative; the health monitor
 * must not clear attempt accounting or revive those states.
 */
export type ChannelHealthRecoveryOwnership =
  | { kind: "manager-owned"; phase: "active-backoff" | "gave-up" }
  | { kind: "available" };

function isManagedAccount(snapshot: ChannelHealthSnapshot): boolean {
  return snapshot.enabled !== false && snapshot.configured !== false;
}

/**
 * Classify whether the channel manager already owns crash-loop recovery.
 * Active backoff: mid-restart sleep with a positive attempt counter.
 * Gave-up: terminal after exceeding CHANNEL_MAX_RESTART_ATTEMPTS.
 * Available: monitor may stop/start and reset attempts (wedged/timed-out recovery).
 */
export function resolveChannelHealthRecoveryOwnership(
  snapshot: Pick<ChannelHealthSnapshot, "running" | "restartPending" | "reconnectAttempts">,
  opts?: { maxRestartAttempts?: number },
): ChannelHealthRecoveryOwnership {
  if (snapshot.running === true) {
    return { kind: "available" };
  }
  const maxRestartAttempts = opts?.maxRestartAttempts ?? CHANNEL_MAX_RESTART_ATTEMPTS;
  const attempts =
    typeof snapshot.reconnectAttempts === "number" && Number.isFinite(snapshot.reconnectAttempts)
      ? Math.max(0, Math.trunc(snapshot.reconnectAttempts))
      : 0;
  // Manager crash-loop backoff sets restartPending with attempt >= 1 while a
  // task still owns the account; timed-out recovery uses reconnectAttempts=0.
  if (snapshot.restartPending === true && attempts > 0) {
    return { kind: "manager-owned", phase: "active-backoff" };
  }
  // Manager give-up clears restartPending and leaves reconnectAttempts above the
  // bound (attempt becomes MAX+1). Policy logging also treats >= MAX as gave-up.
  if (snapshot.restartPending !== true && attempts >= maxRestartAttempts) {
    return { kind: "manager-owned", phase: "gave-up" };
  }
  return { kind: "available" };
}

const BUSY_ACTIVITY_STALE_THRESHOLD_MS = 25 * 60_000;
// Keep these shared between the background health monitor and on-demand readiness
// probes so both surfaces evaluate channel lifecycle windows consistently.
export const DEFAULT_CHANNEL_STALE_EVENT_THRESHOLD_MS = 30 * 60_000;
export const DEFAULT_CHANNEL_CONNECT_GRACE_MS = 120_000;

export function evaluateChannelHealth(
  snapshot: ChannelHealthSnapshot,
  policy: ChannelHealthPolicy,
): ChannelHealthEvaluation {
  if (!isManagedAccount(snapshot)) {
    return { healthy: true, reason: "unmanaged" };
  }
  if (!snapshot.running && snapshot.terminalDisconnect) {
    return { healthy: false, reason: "terminal-disconnect" };
  }
  if (!snapshot.running) {
    return { healthy: false, reason: "not-running" };
  }
  const activeRuns =
    typeof snapshot.activeRuns === "number" && Number.isFinite(snapshot.activeRuns)
      ? Math.max(0, Math.trunc(snapshot.activeRuns))
      : 0;
  const isBusy = snapshot.busy === true || activeRuns > 0;
  const lastStartAt =
    typeof snapshot.lastStartAt === "number" && Number.isFinite(snapshot.lastStartAt)
      ? snapshot.lastStartAt
      : null;
  const lastRunActivityAt =
    typeof snapshot.lastRunActivityAt === "number" && Number.isFinite(snapshot.lastRunActivityAt)
      ? snapshot.lastRunActivityAt
      : null;
  const lastTransportActivityAt =
    typeof snapshot.lastTransportActivityAt === "number" &&
    Number.isFinite(snapshot.lastTransportActivityAt)
      ? snapshot.lastTransportActivityAt
      : null;
  const busyStateInitializedForLifecycle =
    lastStartAt == null || (lastRunActivityAt != null && lastRunActivityAt >= lastStartAt);

  // Runtime snapshots are patch-merged, so a restarted lifecycle can temporarily
  // inherit stale busy fields from the previous instance. Ignore busy short-circuit
  // until run activity is known to belong to the current lifecycle.
  if (isBusy) {
    if (!busyStateInitializedForLifecycle) {
      // Fall through to normal startup/disconnect checks below.
    } else {
      const runActivityAge =
        lastRunActivityAt == null
          ? Number.POSITIVE_INFINITY
          : Math.max(0, policy.now - lastRunActivityAt);
      if (runActivityAge < BUSY_ACTIVITY_STALE_THRESHOLD_MS) {
        return { healthy: true, reason: "busy" };
      }
      return { healthy: false, reason: "stuck" };
    }
  }
  if (snapshot.lastStartAt != null) {
    const upDuration = policy.now - snapshot.lastStartAt;
    if (upDuration < policy.channelConnectGraceMs) {
      return { healthy: true, reason: "startup-connect-grace" };
    }
  }
  if (snapshot.connected === false) {
    return { healthy: false, reason: "disconnected" };
  }
  // App-level events are not socket liveness: quiet Slack/Discord workspaces can
  // go idle while their upstream clients maintain heartbeats internally.
  const shouldCheckStaleSocket = snapshot.connected === true && lastTransportActivityAt != null;
  if (shouldCheckStaleSocket) {
    if (lastStartAt != null && lastTransportActivityAt < lastStartAt) {
      const lifecycleEventGap = Math.max(0, policy.now - lastStartAt);
      if (lifecycleEventGap <= policy.staleEventThresholdMs) {
        return { healthy: true, reason: "healthy" };
      }
      return { healthy: false, reason: "stale-socket" };
    }
    const eventAge = policy.now - lastTransportActivityAt;
    if (eventAge > policy.staleEventThresholdMs) {
      return { healthy: false, reason: "stale-socket" };
    }
  }
  return { healthy: true, reason: "healthy" };
}

export function resolveChannelRestartReason(
  snapshot: ChannelHealthSnapshot,
  evaluation: ChannelHealthEvaluation,
): ChannelRestartReason {
  // Restart reasons are intentionally coarse: downstream logs/UI need stable
  // categories, while detailed channel state stays in the health snapshot.
  if (evaluation.reason === "stale-socket") {
    return "stale-socket";
  }
  if (evaluation.reason === "not-running") {
    return snapshot.reconnectAttempts && snapshot.reconnectAttempts >= 10 ? "gave-up" : "stopped";
  }
  if (evaluation.reason === "disconnected") {
    return "disconnected";
  }
  return "stuck";
}
