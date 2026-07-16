// Control UI E2E: route-preloaded Skills hydrates ClawHub security verdicts.
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  canRunPlaywrightChromium,
  installMockGateway,
  resolvePlaywrightChromiumExecutablePath,
  startControlUiE2eServer,
  type ControlUiE2eServer,
} from "../test-helpers/control-ui-e2e.ts";

const chromiumExecutablePath = resolvePlaywrightChromiumExecutablePath(chromium.executablePath());
const chromiumAvailable = canRunPlaywrightChromium(chromiumExecutablePath);
const allowMissingChromium = process.env.OPENCLAW_UI_E2E_ALLOW_MISSING_CHROMIUM === "1";
const describeControlUiE2e = chromiumAvailable || !allowMissingChromium ? describe : describe.skip;
const updateScreenshots = process.env.OPENCLAW_UPDATE_E2E_SCREENSHOTS === "1";
const artifactDir = path.resolve(
  process.cwd(),
  ".artifacts/control-ui-e2e/skills-security-verdicts",
);
const desktopViewport = { height: 1000, width: 1440 };

const linkedSkillStatusReport = {
  workspaceDir: "/tmp/openclaw-e2e/workspace",
  managedSkillsDir: "/tmp/openclaw-e2e/skills",
  skills: [
    {
      name: "AgentReceipt",
      description: "Linked ClawHub skill used for security badge proof.",
      source: "workspace",
      filePath: "/tmp/openclaw-e2e/workspace/skills/agentreceipt/SKILL.md",
      baseDir: "/tmp/openclaw-e2e/workspace/skills/agentreceipt",
      skillKey: "agentreceipt",
      bundled: false,
      primaryEnv: undefined,
      homepage: "https://clawhub.ai/openclaw/skills/agentreceipt",
      always: false,
      disabled: false,
      blockedByAllowlist: false,
      blockedByAgentFilter: false,
      eligible: true,
      requirements: { bins: [], env: [], config: [], os: [] },
      missing: { bins: [], env: [], config: [], os: [] },
      configChecks: [],
      install: [],
      clawhub: {
        status: "linked",
        valid: true,
        registry: "https://clawhub.ai",
        slug: "agentreceipt",
        installedVersion: "1.2.3",
        installedAt: 1_700_000_000_000,
      },
    },
  ],
};

const cleanSecurityVerdicts = {
  schema: "openclaw.skills.security-verdicts.v1",
  items: [
    {
      registry: "https://clawhub.ai",
      ok: true,
      decision: "pass",
      reasons: [],
      requestedSlug: "agentreceipt",
      requestedVersion: "1.2.3",
      slug: "agentreceipt",
      version: "1.2.3",
      securityStatus: "clean",
      securityPassed: true,
    },
  ],
};

let browser: Browser;
let server: ControlUiE2eServer;

async function captureScreenshot(page: Page, name: string): Promise<void> {
  if (!updateScreenshots) {
    return;
  }
  await mkdir(artifactDir, { recursive: true });
  await page.locator(".content").screenshot({
    animations: "disabled",
    caret: "hide",
    path: path.join(artifactDir, name),
  });
}

async function newContext(viewport = desktopViewport): Promise<BrowserContext> {
  return browser.newContext({
    locale: "en-US",
    serviceWorkers: "block",
    viewport,
  });
}

describeControlUiE2e("Control UI Skills security verdicts route-preload E2E", () => {
  beforeAll(async () => {
    if (!chromiumAvailable) {
      throw new Error(
        `Playwright Chromium is not installed at ${chromiumExecutablePath}. Run \`pnpm --dir ui exec playwright install chromium\`, or set OPENCLAW_UI_E2E_ALLOW_MISSING_CHROMIUM=1 only when intentionally skipping this lane.`,
      );
    }
    if (updateScreenshots) {
      await rm(artifactDir, { force: true, recursive: true });
      await mkdir(artifactDir, { recursive: true });
    }
    server = await startControlUiE2eServer();
    browser = await chromium.launch({ executablePath: chromiumExecutablePath });
  });

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  it("shows Clean for linked skills after route-preloaded skills.status hydrates securityVerdicts", async () => {
    const context = await newContext();
    const page = await context.newPage();
    const gateway = await installMockGateway(page, {
      featureMethods: ["skills.status", "skills.securityVerdicts", "agents.list"],
      methodResponses: {
        "skills.status": linkedSkillStatusReport,
        "skills.securityVerdicts": cleanSecurityVerdicts,
      },
    });

    try {
      const response = await page.goto(`${server.baseUrl}skills`);
      expect(response?.status()).toBe(200);

      // Route loader preloads skills.status; page then hydrates bulk verdicts.
      await gateway.waitForRequest("skills.status");
      await gateway.waitForRequest("skills.securityVerdicts");

      await page.locator("openclaw-skills-page").waitFor({ state: "attached" });
      await page.locator(".settings-row__title", { hasText: "AgentReceipt" }).waitFor({
        state: "visible",
        timeout: 10_000,
      });
      // English locale (context locale en-US): clean pass → "Clean", not "Unavailable".
      const cleanBadge = page.locator(".settings-row__control").getByText("Clean", { exact: true });
      await cleanBadge.waitFor({ state: "visible", timeout: 10_000 });
      await expect
        .poll(async () =>
          page.locator(".settings-row__control").getByText("Unavailable", { exact: true }).count(),
        )
        .toBe(0);

      await captureScreenshot(page, "01-skills-route-preload-clean.png");

      // Route path must not re-fetch skills.status after the loader already provided it.
      const statusRequests = await gateway.getRequests("skills.status");
      const verdictRequests = await gateway.getRequests("skills.securityVerdicts");
      expect(statusRequests.length).toBe(1);
      expect(verdictRequests.length).toBe(1);
    } finally {
      await context.close().catch(() => {});
    }
  });
});
