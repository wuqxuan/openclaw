/**
 * Shell command plans for sandbox filesystem bridge operations.
 *
 * Plans carry path-safety checks alongside the command so rechecks and execution stay coupled.
 */
import type { AnchoredSandboxEntry, PathSafetyCheck } from "./fs-bridge-path-safety.js";
import type { SandboxResolvedFsPath } from "./fs-paths.js";

export type SandboxFsCommandPlan = {
  checks: PathSafetyCheck[];
  script: string;
  args?: string[];
  stdin?: Buffer | string;
  recheckBeforeCommand?: boolean;
  allowFailure?: boolean;
};

/**
 * Locale-independent stdout marker for a missing anchored basename.
 * Prefer this over parsing localized `stat` stderr (e.g. "No such file or directory").
 */
export const SANDBOX_STAT_MISSING_MARKER = "__OPENCLAW_SANDBOX_STAT_MISSING__";

/** Builds a stat command that anchors the path at its canonical parent before reading metadata. */
export function buildStatPlan(
  target: SandboxResolvedFsPath,
  anchoredTarget: AnchoredSandboxEntry,
): SandboxFsCommandPlan {
  // Emit a reserved marker before invoking `stat` so missing paths do not depend on
  // English-only coreutils diagnostics under non-C locales.
  const script = [
    "set -eu",
    'cd -- "$1"',
    'if [ ! -e "$2" ]; then',
    `  printf '%s\\n' '${SANDBOX_STAT_MISSING_MARKER}'`,
    "  exit 0",
    "fi",
    'stat -c "%F|%s|%y" -- "$2"',
  ].join("\n");
  return {
    checks: [{ target, options: { action: "stat files" } }],
    script,
    args: [anchoredTarget.canonicalParentPath, anchoredTarget.basename],
    allowFailure: true,
  };
}
