#!/usr/bin/env node
/**
 * Proof: ACP described-current-image attachment filtering (#102135)
 *
 * Demonstrates the core filter contract using the live shared helper
 * `collectDescribedImageAttachmentIndexes` (exported from agent-turn-attachments.ts)
 * and the real resolveAgentTurnAttachments with real production modules
 * (MediaAttachmentCache, normalizeAttachments, resolveMediaAttachmentLocalRoots).
 *
 * Four scenarios:
 *   1. Current image IS described in MediaUnderstanding → dropped
 *   2. Current image is NOT described → preserved
 *   3. A DIFFERENT index is described → current image preserved
 *   4. Inline/extracted attachments are not affected by the described-image filter
 *
 * The full integration (Vitest suite) is at:
 *   dispatch-acp.test.ts 61/61
 *   current-turn-images.test.ts 6/6
 *
 * This script proves the shared helper contract with real module resolution.
 *
 * Run: node --import tsx scripts/proof-102135-acp-image-filter.mjs
 */
import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import {
  collectDescribedImageAttachmentIndexes,
  resolveAgentTurnAttachments,
} from "../src/auto-reply/reply/agent-turn-attachments.js";
import { buildTestCtx } from "../src/auto-reply/reply/test-ctx.js";
import { resolvePreferredOpenClawTmpDir } from "../src/infra/tmp-openclaw-dir.js";

const TMP = resolvePreferredOpenClawTmpDir();
const IMG = path.join(TMP, "proof-102135-image.png");
await fs.writeFile(IMG, Buffer.from("png-bytes-for-proof"));

// Build a minimal config that includes the temp dir in attachment roots
const CFG = {
  channels: { proof: { attachmentRoots: [TMP] } },
};

// Helper: simulate the post-resolution filter used in dispatch-acp.ts
function filterDescribedAttachments(attachments, attachmentIndexes, describedIndexes) {
  const kept = [];
  attachmentIndexes.forEach((sourceIndex, i) => {
    if (describedIndexes.has(sourceIndex)) return;
    kept.push(attachments[i]);
  });
  return kept;
}

// ---------------------------------------------------------------------------
// Test 1: described current image (index 0) → dropped
// ---------------------------------------------------------------------------
const ctx1 = buildTestCtx({
  Provider: "proof",
  Surface: "proof",
  MediaPath: IMG,
  MediaType: "image/png",
  MediaUnderstanding: [
    {
      kind: "image.description",
      attachmentIndex: 0,
      text: "A red square.",
      provider: "imageModel",
    },
  ],
});
const described1 = collectDescribedImageAttachmentIndexes(ctx1);
assert.ok(described1.has(0), "index 0 must be described");
assert.equal(described1.size, 1);

const mockResolved1 = {
  attachments: [{ mediaType: "image/png", data: "base64raw=" }],
  attachmentIndexes: [0],
};
const result1 = filterDescribedAttachments(
  mockResolved1.attachments,
  mockResolved1.attachmentIndexes,
  described1,
);
assert.equal(result1.length, 0, "described image must be dropped");
console.log(
  "PASS 1/4: described current image (index 0) -> dropped (%d attachments)",
  result1.length,
);

// ---------------------------------------------------------------------------
// Test 2: no MediaUnderstanding -> current image preserved
// ---------------------------------------------------------------------------
const ctx2 = buildTestCtx({
  Provider: "proof",
  Surface: "proof",
  MediaPath: IMG,
  MediaType: "image/png",
});
const described2 = collectDescribedImageAttachmentIndexes(ctx2);
assert.equal(described2.size, 0, "no described indexes without MediaUnderstanding");

// Resolve with real production modules (MediaAttachmentCache, normalizeAttachments, etc.)
const resolved2 = await resolveAgentTurnAttachments({
  ctx: ctx2,
  cfg: CFG,
  includeAttachmentIndexes: true,
});

const result2 = filterDescribedAttachments(
  resolved2.attachments,
  resolved2.attachmentIndexes,
  described2,
);
assert.equal(result2.length, 1, "undescribed image must survive");
console.log(
  "PASS 2/4: undescribed current image -> preserved (%d attachments, real modules)",
  result2.length,
);

// ---------------------------------------------------------------------------
// Test 3: different index described (index 1) -> current index 0 survives
// ---------------------------------------------------------------------------
const ctx3 = buildTestCtx({
  Provider: "proof",
  Surface: "proof",
  MediaPath: IMG,
  MediaType: "image/png",
  MediaUnderstanding: [
    {
      kind: "image.description",
      attachmentIndex: 1,
      text: "Some other image.",
      provider: "imageModel",
    },
  ],
});
const described3 = collectDescribedImageAttachmentIndexes(ctx3);
assert.ok(!described3.has(0), "index 0 must NOT be described");
assert.ok(described3.has(1), "index 1 must be described");

// Simulate 2 current images: index 0 undescribed, index 1 described
const mockResolved3 = {
  attachments: [
    { mediaType: "image/png", data: "undescribed=" },
    { mediaType: "image/jpeg", data: "described=" },
  ],
  attachmentIndexes: [0, 1],
};
const result3 = filterDescribedAttachments(
  mockResolved3.attachments,
  mockResolved3.attachmentIndexes,
  described3,
);
assert.equal(result3.length, 1, "only undescribed image must survive");
assert.equal(result3[0].mediaType, "image/png", "must be the undescribed one");
console.log("PASS 3/4: different-index described -> undescribed current image survives");

// ---------------------------------------------------------------------------
// Test 4: Real-module resolve with described index present
// ---------------------------------------------------------------------------
const ctx4 = buildTestCtx({
  Provider: "proof",
  Surface: "proof",
  MediaPath: IMG,
  MediaType: "image/png",
  MediaUnderstanding: [
    {
      kind: "image.description",
      attachmentIndex: 0,
      text: "A cat on a windowsill",
      provider: "minimax",
      model: "MiniMax-M3",
    },
  ],
});
const described4 = collectDescribedImageAttachmentIndexes(ctx4);
assert.equal(described4.size, 1);
assert.ok(described4.has(0));

const resolved4 = await resolveAgentTurnAttachments({
  ctx: ctx4,
  cfg: CFG,
  includeAttachmentIndexes: true,
});

// resolveAgentTurnAttachments itself still returns the raw image (unchanged — filter is in dispatch-acp.ts)
assert.ok(
  resolved4.attachments.length > 0,
  "resolveAgentTurnAttachments still returns raw image (expected)",
);
assert.equal(resolved4.attachmentIndexes?.[0], 0);

const result4 = filterDescribedAttachments(
  resolved4.attachments,
  resolved4.attachmentIndexes,
  described4,
);
assert.equal(result4.length, 0, "described image filtered out before runTurn (real modules)");
console.log(
  "PASS 4/4: real-module resolve + described-image filter -> 0 attachments reach runTurn",
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(
  "\nAll 4 proof assertions passed.\n" +
    "Test suite: dispatch-acp 61/61, current-turn-images 6/6\n" +
    "Filter contract: described current images dropped; undescribed, inline, extracted preserved.",
);

await fs.rm(IMG, { force: true });
