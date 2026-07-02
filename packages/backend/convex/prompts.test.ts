import { describe, expect, test } from "vitest";

import {
  GLOBAL_IMPACT_FALLBACK,
  LIMITED_COVERAGE_FALLBACK,
  buildArticleBiasScoringPrompt,
  buildEventSummaryPrompt,
} from "./prompts";

const article = (over: Partial<Parameters<typeof buildEventSummaryPrompt>[0]["articles"][number]> = {}) => ({
  title: "Guvernul a adoptat bugetul pe 2027",
  sourceName: "Digi24",
  sourceBiasLabel: "center",
  sourceReliability: 8,
  publishedAt: "2026-07-01T10:00:00Z",
  summary: "Guvernul a adoptat marți bugetul de stat.",
  rssSnippet: undefined,
  atomicFacts: ["Bugetul a fost adoptat marți."],
  canonicalUrl: "https://digi24.ro/a",
  ...over,
});

describe("Romanian-first event summary prompt (BIV-202)", () => {
  const prompt = buildEventSummaryPrompt({
    eventTitle: "Bugetul pe 2027",
    articles: [
      article(),
      article({ sourceName: "G4Media", sourceBiasLabel: "left-center" }),
      article({ sourceName: "Antena 3 CNN", sourceBiasLabel: "right" }),
    ],
  });

  test("system prompt requires Romanian output explicitly", () => {
    expect(prompt.system).toContain("EXCLUSIV în limba română");
    expect(prompt.system).toContain("diacritice");
  });

  test("output keys are the new axis keys, not left/right", () => {
    expect(prompt.system).toContain(
      "neutral, reformist, suveranist, globalImpact",
    );
    expect(prompt.system).not.toMatch(/\bcenter, left, right\b/);
  });

  test("defines both poles of the axis without value judgment", () => {
    expect(prompt.system).toContain("Cadrarea reformistă");
    expect(prompt.system).toContain("Cadrarea suveranistă");
    expect(prompt.system).toContain("descriptive, nu evaluative");
  });

  test("articles carry Romanian framing labels instead of left/right", () => {
    expect(prompt.user).toContain("cadrareaSursei: reformistă");
    expect(prompt.user).toContain("cadrareaSursei: suveranistă");
    expect(prompt.user).toContain("cadrareaSursei: neutră");
    expect(prompt.user).not.toContain("sourceBiasLabel");
  });

  test("fallback strings are Romanian", () => {
    expect(GLOBAL_IMPACT_FALLBACK).toMatch(/articolele furnizate/);
    expect(LIMITED_COVERAGE_FALLBACK.reformist).toMatch(/reformist/);
    expect(LIMITED_COVERAGE_FALLBACK.suveranist).toMatch(/suveranist/);
  });

  test("precomputed perspective counts count by framing group", () => {
    expect(prompt.system).toContain("articole cu cadrare reformistă: 1");
    expect(prompt.system).toContain("articole cu cadrare suveranistă: 1");
  });
});

describe("Romanian-first bias scoring prompt (BIV-202)", () => {
  const prompt = buildArticleBiasScoringPrompt({
    maxInputChars: 6000,
    articles: [
      {
        id: "a1",
        title: "Titlu",
        sourceName: "Digi24",
        sourceLean: "center",
        sourceReliability: 8,
        bodyText: "Text de articol.",
      },
    ],
  });

  test("requires Romanian rationale and defines the named axis", () => {
    expect(prompt.system).toContain("EXCLUSIV în limba română");
    expect(prompt.system).toContain('bias.axis = "reformist_suveranist"');
    expect(prompt.system).toContain("Puternic reformist");
    expect(prompt.system).toContain("Puternic suveranist");
  });

  test("instructs scoring the text's framing, not the topic", () => {
    expect(prompt.system).toContain("cadrarea TEXTULUI, nu subiectul");
  });
});
