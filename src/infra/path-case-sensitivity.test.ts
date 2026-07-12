// Covers filesystem case-sensitivity child probes for path identity keys.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pathCaseInsensitive } from "./path-case-sensitivity.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-path-case-"));
  tempRoots.push(root);
  return root;
}

function probeChildCaseInsensitive(dir: string): boolean {
  const marker = path.join(dir, `caseProbeChild-${process.pid}`);
  fs.writeFileSync(marker, "x", "utf8");
  try {
    const swapped = marker.replace(/[A-Za-z]/g, (char) => {
      const lower = char.toLowerCase();
      return char === lower ? char.toUpperCase() : lower;
    });
    if (swapped === marker) {
      return process.platform === "win32";
    }
    try {
      const a = fs.statSync(marker);
      const b = fs.statSync(swapped);
      return a.dev === b.dev && a.ino === b.ino;
    } catch {
      return false;
    }
  } finally {
    fs.rmSync(marker, { force: true });
  }
}

describe("pathCaseInsensitive", () => {
  it("matches child lookup semantics on the host temp volume", () => {
    const root = makeTempRoot();
    const expected = probeChildCaseInsensitive(root);
    expect(pathCaseInsensitive(root)).toBe(expected);
  });

  it("uses closest existing parent for absent nested paths", () => {
    const root = makeTempRoot();
    const absent = path.join(root, "AgentState", "nested", "missing");
    const expected = probeChildCaseInsensitive(root);
    expect(pathCaseInsensitive(absent)).toBe(expected);
  });

  it("probes an existing empty directory via temporary child marker", () => {
    const root = makeTempRoot();
    const empty = path.join(root, "emptyDir");
    fs.mkdirSync(empty);
    const expected = probeChildCaseInsensitive(empty);
    expect(pathCaseInsensitive(empty)).toBe(expected);
  });

  it("probes via an existing lettered child without leaving a marker", () => {
    const root = makeTempRoot();
    const child = path.join(root, "LetterEntry");
    fs.writeFileSync(child, "x", "utf8");
    const before = new Set(fs.readdirSync(root));
    const result = pathCaseInsensitive(path.join(root, "does-not-exist-yet"));
    const after = new Set(fs.readdirSync(root));
    expect(result).toBe(probeChildCaseInsensitive(root));
    expect(after).toEqual(before);
  });
});
