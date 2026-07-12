// Path case-sensitivity probes for identity keys (agentDir, trusted bins, …).
// Measures *child* lookup semantics on the target filesystem so mount boundaries
// are not misclassified by case-swapping a parent path name.
import fs from "node:fs";
import path from "node:path";

function swapAsciiCase(value: string): string {
  return value.replace(/[A-Za-z]/g, (char) => {
    const lower = char.toLowerCase();
    return char === lower ? char.toUpperCase() : lower;
  });
}

function sameFsObject(a: fs.Stats, b: fs.Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

function hasAsciiLetters(value: string): boolean {
  return /[A-Za-z]/.test(value);
}

/**
 * Probe whether children of `dir` are resolved case-insensitively.
 * Prefer an existing lettered entry (works on read-only system dirs);
 * otherwise create a temporary marker and remove it.
 * Returns null when the directory cannot be probed.
 */
function probeDirectoryChildCaseInsensitive(dir: string): boolean | null {
  try {
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      if (!hasAsciiLetters(entry)) {
        continue;
      }
      const swapped = swapAsciiCase(entry);
      if (swapped === entry) {
        continue;
      }
      const originalPath = path.join(dir, entry);
      const alternatePath = path.join(dir, swapped);
      try {
        const original = fs.statSync(originalPath);
        try {
          const alternate = fs.statSync(alternatePath);
          return sameFsObject(original, alternate);
        } catch {
          // Original child exists, alternate spelling does not → case-sensitive.
          return false;
        }
      } catch {
        // Entry disappeared between readdir and stat; try another.
      }
    }
  } catch {
    // Not readable; fall through to a write probe when possible.
  }

  // No usable existing entry: create a short-lived child marker.
  // Child probe (not parent-name swap) is required at mount boundaries.
  const markerName = `.openclawCaseProbe-${process.pid}-${Date.now().toString(36)}`;
  const markerPath = path.join(dir, markerName);
  const swappedPath = swapAsciiCase(markerPath);
  if (swappedPath === markerPath) {
    return process.platform === "win32";
  }

  try {
    fs.writeFileSync(markerPath, "x", { flag: "wx" });
  } catch {
    return null;
  }

  try {
    const original = fs.statSync(markerPath);
    try {
      const alternate = fs.statSync(swappedPath);
      return sameFsObject(original, alternate);
    } catch {
      return false;
    }
  } finally {
    fs.rmSync(markerPath, { force: true });
  }
}

/**
 * True when `value` lives on a volume where child path lookups fold case.
 * Walks to the closest existing directory so configured paths need not exist yet.
 * Probes child lookup semantics on that directory (mount-boundary safe).
 */
export function pathCaseInsensitive(value: string): boolean {
  let candidate = path.resolve(value);
  for (;;) {
    try {
      const stats = fs.statSync(candidate);
      if (stats.isDirectory()) {
        const probed = probeDirectoryChildCaseInsensitive(candidate);
        if (probed !== null) {
          return probed;
        }
        // Directory exists but is unreadable/unwritable: do not walk past a
        // mount boundary by case-swapping the parent name. Fall back to OS default.
        return process.platform === "win32";
      }
      // Existing non-directory: children of the containing dir share its volume.
    } catch {
      // Path may not exist yet; walk to the closest existing parent directory.
    }

    const parent = path.dirname(candidate);
    if (parent === candidate) {
      // Unknown root: Windows volumes are case-insensitive by default; POSIX is not.
      return process.platform === "win32";
    }
    candidate = parent;
  }
}
