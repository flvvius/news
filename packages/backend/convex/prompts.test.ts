import { describe, expect, test } from "vitest";

import {
  GLOBAL_IMPACT_FALLBACK,
  LIMITED_COVERAGE_FALLBACK,
  SIDE_COVERAGE_FALLBACK,
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

  // v8 (BIV-812): the limited-coverage text is retired. It is still exported
  // so stored copies can be recognized and stripped, but the prompt must never
  // ask for it again — writing it produced a perspective tab whose only
  // content was a remark about how much coverage exists.
  test("v8: the prompt never asks for the limited-coverage placeholder", () => {
    for (const counts of [
      [1, 1],
      [0, 3],
      [1, 4],
    ] as const) {
      const built = buildEventSummaryPrompt({
        eventTitle: "Bugetul pe 2027",
        articles: [
          ...Array.from({ length: counts[0] }, (_, i) =>
            article({ sourceName: `Reformist ${i}`, sourceBiasLabel: "left" }),
          ),
          ...Array.from({ length: counts[1] }, (_, i) =>
            article({ sourceName: `Suveranist ${i}`, sourceBiasLabel: "right" }),
          ),
        ],
      });
      expect(built.system).not.toContain(LIMITED_COVERAGE_FALLBACK.reformist);
      expect(built.system).not.toContain(LIMITED_COVERAGE_FALLBACK.suveranist);
      expect(built.system).not.toMatch(/scrie exact "Acoperire limitată/);
    }
  });

  test("v8: zero articles on a side means an empty field, one means CASE B", () => {
    const built = buildEventSummaryPrompt({
      eventTitle: "Bugetul pe 2027",
      articles: [
        article(),
        article({ sourceName: "G4Media", sourceBiasLabel: "left-center" }),
      ],
    });
    // 0 suveranist articles → CASE A, empty field, no commentary on absence.
    expect(built.system).toContain(
      "CAZUL A — 0 articole cu cadrare suveranistă",
    );
    // 1 reformist article → CASE B, that outlet's own angle or nothing.
    expect(built.system).toContain(
      "CAZUL B — un singur articol cu cadrare reformistă",
    );
    expect(built.system).toContain("unghi propriu");
    // Coverage-volume prose is banned outright, at any article count.
    expect(built.system).toContain(
      "INTERZIS în ORICE caz, indiferent de numărul de articole",
    );
  });

  // BIV-805: these fallbacks are stored as perspective summaries and rendered
  // to users, so they must not use the "cadrare" framing calque. The
  // LLM-internal prompt vocabulary (cadrareaSursei etc.) is exempt — it is
  // model-facing only.
  test("user-visible fallbacks avoid the 'cadrare' calque (BIV-805)", () => {
    const visible = [
      GLOBAL_IMPACT_FALLBACK,
      LIMITED_COVERAGE_FALLBACK.reformist,
      LIMITED_COVERAGE_FALLBACK.suveranist,
      SIDE_COVERAGE_FALLBACK,
    ];
    for (const text of visible) {
      expect(text).not.toMatch(/cadrare|cadrăr|încadr/i);
    }
    expect(LIMITED_COVERAGE_FALLBACK.reformist).toContain(
      "orientare reformistă",
    );
    expect(SIDE_COVERAGE_FALLBACK).toContain("perspectivă distinctă");
  });

  test("precomputed perspective counts count by framing group", () => {
    expect(prompt.system).toContain("articole cu cadrare reformistă: 1");
    expect(prompt.system).toContain("articole cu cadrare suveranistă: 1");
  });
});

describe("event summary prompt v3 (full bodies + CASE D)", () => {
  const prompt = buildEventSummaryPrompt({
    eventTitle: "Bugetul pe 2027",
    articles: [
      article({ bodyText: "Textul complet al articolului despre buget." }),
      article({ sourceName: "G4Media", sourceBiasLabel: "left-center" }),
    ],
  });

  test("includes the transient body text when present, omits the block otherwise", () => {
    expect(prompt.user).toContain(
      "Textul articolului: Textul complet al articolului despre buget.",
    );
    // The second article has no bodyText — exactly one body block.
    expect(prompt.user.match(/Textul articolului:/g)).toHaveLength(1);
  });

  test("declares the body text as primary material over summary/snippet", () => {
    expect(prompt.system).toContain("materialul principal");
    expect(prompt.system).toContain("Rezumat extras");
  });

  test("defines CASE D with the perspectiveApplicable flag and a political guardrail", () => {
    expect(prompt.system).toContain("CAZUL D");
    expect(prompt.system).toContain("perspectiveApplicable");
    expect(prompt.system).toContain("are prioritate față de A/B/C");
    // The guardrail: political/justice/EU/budget/election stories never CASE D.
    expect(prompt.system).toMatch(/NU folosi CAZUL D.*politic/);
    expect(prompt.user).toContain("perspectiveApplicable (boolean)");
  });

  test("v7: CASE C demands concrete emphases/omissions and allows short quotes", () => {
    expect(prompt.system).toContain("ce omite");
    expect(prompt.system).toContain("maxim 10 cuvinte");
    // Perspective boxes must lead with the concrete difference.
    expect(prompt.system).toContain("ÎNCEP cu diferența concretă");
  });

  test("v7: bans the 'nucleul factual comun' boilerplate and allows an empty side", () => {
    // The banned meta-statement must never be written as perspective text; a
    // non-diverging side is left empty instead (UI hides the tab).
    expect(prompt.system).toContain(
      'INTERZIS ca text de perspectivă: sintagma „nucleul factual comun"',
    );
    expect(prompt.system).toContain('lasă câmpul șir gol ("")');
    // No CASE B remains; the pre-v7 boilerplate instruction is gone.
    expect(prompt.system).not.toContain("au reflectat în mare nucleul factual");
    // Do not fabricate a tonal difference the articles do not support.
    expect(prompt.system).toContain(
      "Nu scrie o diferență de ton pe care articolele nu o susțin",
    );
  });

  test("globalImpact must not restate the neutral summary", () => {
    expect(prompt.system).toContain("globalImpact NU repetă rezumatul neutral");
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
