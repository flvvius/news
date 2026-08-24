import { describe, expect, test } from "vitest";

import {
  GLOBAL_IMPACT_FALLBACK,
  isFallbackGlobalImpact,
  leadSentence,
  splitIntoSentences,
  stripFallbackGlobalImpact,
  toSummaryPoints,
} from "./lib/summaryText";

describe("splitIntoSentences", () => {
  test("splits on sentence boundaries", () => {
    expect(
      splitIntoSentences("Guvernul a amânat votul. Partidele au cerut timp."),
    ).toEqual(["Guvernul a amânat votul.", "Partidele au cerut timp."]);
  });

  test("keeps numbers and abbreviations intact", () => {
    expect(
      splitIntoSentences(
        "Proiectul valorează 770 de milioane de euro. Vezi art. 12 din lege.",
      ),
    ).toEqual([
      "Proiectul valorează 770 de milioane de euro.",
      "Vezi art. 12 din lege.",
    ]);
    expect(splitIntoSentences("Suma este 2.5 miliarde lei.")).toEqual([
      "Suma este 2.5 miliarde lei.",
    ]);
  });
});

describe("toSummaryPoints", () => {
  const summary =
    "Guvernul a amânat consultările pe legea salarizării. Partidele au cerut mai mult timp. Legea trebuie adoptată până la 31 august. Valoarea de referință scade cu 100 de lei.";

  test("first sentence becomes the lead, the rest become points", () => {
    const { lead, points } = toSummaryPoints(summary);
    expect(lead).toBe("Guvernul a amânat consultările pe legea salarizării.");
    expect(points).toHaveLength(3);
    expect(points[0]).toBe("Partidele au cerut mai mult timp.");
  });

  test("leadCount 0 turns every sentence into a point", () => {
    const { lead, points } = toSummaryPoints(summary, { leadCount: 0 });
    expect(lead).toBe("");
    expect(points).toHaveLength(4);
  });

  test("short texts stay a paragraph — a two-item list is just chrome", () => {
    const short = "Guvernul a amânat votul. Partidele au cerut timp.";
    expect(toSummaryPoints(short)).toEqual({ lead: short, points: [] });
  });

  test("empty input yields nothing to render", () => {
    expect(toSummaryPoints("")).toEqual({ lead: "", points: [] });
    expect(toSummaryPoints(undefined)).toEqual({ lead: "", points: [] });
  });

  test("points reassemble into the stored prose, losing no text", () => {
    const { lead, points } = toSummaryPoints(summary);
    expect([lead, ...points].join(" ")).toBe(summary);
  });
});

describe("leadSentence", () => {
  test("returns the opening sentence for feed previews", () => {
    expect(leadSentence("Prima frază. A doua frază.")).toBe("Prima frază.");
  });

  test("falls back to the whole text when there is no boundary", () => {
    expect(leadSentence("Fără punct final")).toBe("Fără punct final");
    expect(leadSentence(undefined)).toBe("");
  });
});

describe("isFallbackGlobalImpact", () => {
  test("matches the canonical fallback", () => {
    expect(isFallbackGlobalImpact(GLOBAL_IMPACT_FALLBACK)).toBe(true);
    expect(stripFallbackGlobalImpact(GLOBAL_IMPACT_FALLBACK)).toBe("");
  });

  test("matches the qualified variants the model actually writes", () => {
    for (const variant of [
      "Impactul concret nu este precizat în articolele furnizate în ceea ce privește eventuale restricții de circulație.",
      "Impactul concret nu este menționat în articolele furnizate.",
      "Articolele furnizate nu precizează un impact concret al deciziei.",
      "Nu este precizat un impact concret în acoperirea disponibilă.",
    ]) {
      expect(isFallbackGlobalImpact(variant)).toBe(true);
    }
  });

  test("keeps a real impact that happens to start with a caveat", () => {
    const real =
      "Impactul concret nu este cuantificat de autorități, dar 770 de milioane de euro din PNRR depind de adoptarea legii până la 31 august, potrivit Digi24. Fără lege, plata tranșei se amână, iar bugetul pe 2027 pierde finanțarea, arată Adevărul.";
    expect(isFallbackGlobalImpact(real)).toBe(false);
    expect(stripFallbackGlobalImpact(real)).toBe(real);
  });

  test("empty values are not fallbacks", () => {
    expect(isFallbackGlobalImpact("")).toBe(false);
    expect(isFallbackGlobalImpact(null)).toBe(false);
    expect(isFallbackGlobalImpact(undefined)).toBe(false);
    expect(stripFallbackGlobalImpact(undefined)).toBe("");
  });
});

describe("toSummaryPoints without a lead (the impact section)", () => {
  // Prompt v9 asks globalImpact for exactly 2-3 consequence-first sentences,
  // so the two-sentence case has to list — it is the common case, not an edge.
  test("two consequences become two bullets", () => {
    const impact =
      "România riscă să piardă 770 de milioane de euro din PNRR. Angajații din sistemul public rămân fără grila nouă din septembrie.";
    const { lead, points } = toSummaryPoints(impact, { leadCount: 0 });
    expect(lead).toBe("");
    expect(points).toHaveLength(2);
  });

  test("a single consequence stays a sentence", () => {
    const impact = "România riscă să piardă 770 de milioane de euro din PNRR.";
    expect(toSummaryPoints(impact, { leadCount: 0 })).toEqual({
      lead: impact,
      points: [],
    });
  });
});

describe("sentence boundaries after digits", () => {
  // The original guard suppressed a split after ANY trailing digit, so a
  // sentence ending in a year or a numeric outlet name was glued to the next
  // one — which silently defeated both the bulleting and the grounding map.
  test("splits after a year or a numeric source name", () => {
    expect(
      splitIntoSentences(
        "Lucrările se încheie în 2028. Traficul se reia marți, arată Digi24. Primarul a confirmat.",
      ),
    ).toEqual([
      "Lucrările se încheie în 2028.",
      "Traficul se reia marți, arată Digi24.",
      "Primarul a confirmat.",
    ]);
  });

  test("still does not split inside a decimal", () => {
    expect(splitIntoSentences("Bugetul este de 2.500 de lei.")).toEqual([
      "Bugetul este de 2.500 de lei.",
    ]);
  });

  test("still does not split an enumeration marker", () => {
    expect(splitIntoSentences("1. Primul punct al listei.")).toEqual([
      "1. Primul punct al listei.",
    ]);
  });
});
