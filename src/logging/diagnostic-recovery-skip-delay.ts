// Heartbeat-delay gate for stuck-session recovery under event-loop observer stall.

/** Diagnostics heartbeat period; recovery skip scales in multiples of this. */
export const DIAGNOSTIC_HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Fixed multi-interval ceiling for default/high abort thresholds.
 * Low stuckSessionAbortMs configs scale the skip down via
 * resolveDiagnosticRecoverySkipHeartbeatDelayMs so observer-inflated ages
 * cannot cross abort while still under this 90s historical fixed cutoff.
 */
export const DIAGNOSTIC_HEARTBEAT_DELAY_RECOVERY_SKIP_MS = 3 * DIAGNOSTIC_HEARTBEAT_INTERVAL_MS;

/**
 * Heartbeat delay above which stuck-session recovery must not run on this tick.
 * Scales with the effective abort threshold so low configs stay protected; the
 * fixed multi-interval cap preserves the multi-minute observer-stall guard.
 */
export function resolveDiagnosticRecoverySkipHeartbeatDelayMs(stuckSessionAbortMs: number): number {
  if (!Number.isFinite(stuckSessionAbortMs) || stuckSessionAbortMs <= 0) {
    return DIAGNOSTIC_HEARTBEAT_DELAY_RECOVERY_SKIP_MS;
  }
  return Math.min(DIAGNOSTIC_HEARTBEAT_DELAY_RECOVERY_SKIP_MS, Math.floor(stuckSessionAbortMs));
}
