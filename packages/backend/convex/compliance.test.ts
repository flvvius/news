// L15 — compliance regression suite (invariant bundle). Deliberately
// breaking any L1–L14 invariant (e.g. raising the snippet ceiling) fails
// this suite and therefore the CI build. The behavioral round-trips live in
// their own suites: snippetEnforcement, verbatimOverlap, groundingGate,
// tdmPermissions, politeFetch, publisherRequests, generationAudit, reports,
// gdprCascade, consentHygiene, retention, imagePolicy — plus the web-side
// snippet/label tests and the e2e consent-free-storage + event-page specs.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { MAX_SNIPPET_CHARS } from "./lib/compliance";
import { MAX_VERBATIM_NGRAM } from "./lib/verbatimOverlap";
import { RETENTION_POLICY } from "./lib/retentionPolicy";
import { BOT_USER_AGENT } from "./lib/botIdentity";
import { BOT_UA_TOKEN } from "./lib/tdmPolicy";

const REPO_ROOT = join(__dirname, "..", "..", "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (
      [
        "node_modules",
        "_generated",
        ".git",
        ".tanstack",
        "dist",
        "build",
        ".vercel",
        "test-results",
        "ios",
      ].includes(entry)
    ) {
      return [];
    }
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|md|json|html)$/.test(entry) ? [full] : [];
  });
}

describe("compliance invariants (L15)", () => {
  test("L2: the third-party snippet ceiling is exactly 120 characters", () => {
    // Romania's Art. 94¹ 'very short extract' statutory ceiling. Raising
    // this constant is a legal decision, not a product tweak.
    expect(MAX_SNIPPET_CHARS).toBe(120);
  });

  test("L3: the default verbatim n-gram threshold stays at 8 words", () => {
    expect(MAX_VERBATIM_NGRAM).toBe(8);
  });

  test("L6: the crawler identifies as BiviantBot with the bot page link", () => {
    expect(BOT_UA_TOKEN).toBe("BiviantBot");
    expect(BOT_USER_AGENT).toContain("BiviantBot/1.0");
    expect(BOT_USER_AGENT).toContain("https://biviant.com/bot");
  });

  test("L11: retention policy values are the documented ones", () => {
    expect(RETENTION_POLICY).toMatchObject({
      waitlistUnengagedDays: 90,
      readingHistoryDays: 548,
      unverifiedAccountDays: 7,
      articleBodyTextDays: 0,
    });
  });

  test("L5+L1: the pipeline wires permission gates and checks before publish", () => {
    const summarization = readFileSync(
      join(__dirname, "summarizationNode.ts"),
      "utf8",
    );
    // Order matters: permission gate + both checks precede the apply call.
    expect(summarization).toContain("ensureDomainPermissions");
    expect(summarization).toContain("checkSummaryOverlap");
    expect(summarization).toContain("verifySummaryGrounding");
    expect(summarization).toContain("findRiskySentences");
    const enrichment = readFileSync(join(__dirname, "enrichmentNode.ts"), "utf8");
    expect(enrichment).toContain("ensureDomainPermissions");
    expect(enrichment).toContain("extractionAllowed");

    // L1: publication stamps the AI disclosure fields.
    const apply = readFileSync(join(__dirname, "summarization.ts"), "utf8");
    expect(apply).toContain("aiGenerated: true");
    expect(apply).toContain("appendGenerationAudit");
  });

  test("L14: no EU ODR link anywhere in the codebase (platform shut down 2025)", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(REPO_ROOT)) {
      const content = readFileSync(file, "utf8");
      if (/ec\.europa\.eu\/consumers\/odr|\bplatforma ODR\b/i.test(content)) {
        // This test file mentions the pattern on purpose.
        if (file.endsWith("compliance.test.ts")) continue;
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("L9: no fetcher stores publisher image bytes (storage.store allowlist)", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(__dirname))) {
      if (!/\.ts$/.test(file) || file.endsWith(".test.ts")) continue;
      const content = readFileSync(file, "utf8");
      if (/storage\.store\(/.test(content) && !file.endsWith("shareAssetsNode.ts")) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("L13: PostHog stays cookieless (memory persistence)", () => {
    const posthog = readFileSync(
      join(REPO_ROOT, "apps", "web", "src", "lib", "posthog.tsx"),
      "utf8",
    );
    expect(posthog).toContain('persistence: "memory"');
  });

  test("L12: waitlist send paths run through the suppression gate", () => {
    const emails = readFileSync(join(__dirname, "emails.ts"), "utf8");
    const gateCount = (emails.match(/getSendableWaitlistEntry/g) ?? []).length;
    // Welcome + invite (the two marketing-adjacent sends) both gate.
    expect(gateCount).toBeGreaterThanOrEqual(2);
  });
});
