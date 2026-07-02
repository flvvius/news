import { describe, expect, test } from "vitest";

import {
  foldDiacriticsToAscii,
  normalizeRomanianDiacritics,
} from "./lib/romanian";
import { normalizeArticleSnippet, normalizeArticleTitle } from "./ingestion";

describe("normalizeRomanianDiacritics (BIV-102)", () => {
  test("maps legacy cedilla forms to comma-below, both cases", () => {
    expect(normalizeRomanianDiacritics("ş")).toBe("ș"); // ş → ș
    expect(normalizeRomanianDiacritics("Ş")).toBe("Ș"); // Ş → Ș
    expect(normalizeRomanianDiacritics("ţ")).toBe("ț"); // ţ → ț
    expect(normalizeRomanianDiacritics("Ţ")).toBe("Ț"); // Ţ → Ț
  });

  test("normalizes a mixed legacy sentence", () => {
    // "Şedinţa coaliţiei" written entirely with cedilla forms
    const legacy = "Şedinţa coaliţiei şi moţiunea";
    expect(normalizeRomanianDiacritics(legacy)).toBe(
      "Ședința coaliției și moțiunea",
    );
  });

  test("composes decomposed sequences via NFC", () => {
    // a + combining breve → ă
    expect(normalizeRomanianDiacritics("ă")).toBe("ă");
    // s + combining comma below → ș
    expect(normalizeRomanianDiacritics("ș")).toBe("ș");
    // s + combining cedilla → ş (NFC) → ș (mapping)
    expect(normalizeRomanianDiacritics("ş")).toBe("ș");
    // t + combining cedilla → ţ (NFC) → ț (mapping)
    expect(normalizeRomanianDiacritics("ţ")).toBe("ț");
  });

  test("leaves correct comma-below forms and other diacritics untouched", () => {
    const correct = "Ședință în șir la Brăila";
    expect(normalizeRomanianDiacritics(correct)).toBe(correct);
  });

  test("is idempotent", () => {
    const once = normalizeRomanianDiacritics("Şedinţa şi ţara ăsta");
    expect(normalizeRomanianDiacritics(once)).toBe(once);
  });

  test("does not alter non-Romanian text or empty strings", () => {
    expect(normalizeRomanianDiacritics("Plain English text.")).toBe(
      "Plain English text.",
    );
    expect(normalizeRomanianDiacritics("")).toBe("");
    // French cedilla c is not a Romanian legacy form; must survive
    expect(normalizeRomanianDiacritics("garçon")).toBe("garçon");
  });
});

describe("foldDiacriticsToAscii (BIV-102)", () => {
  test("folds all Romanian diacritics to base letters", () => {
    expect(foldDiacriticsToAscii("ședință încă")).toBe(
      "sedinta inca",
    );
    expect(foldDiacriticsToAscii("ÂĂÎȘȚ")).toBe(
      "AAIST",
    );
  });

  test("folds legacy cedilla forms too", () => {
    expect(foldDiacriticsToAscii("şi ţară")).toBe("si tara");
  });

  test("leaves ASCII untouched", () => {
    expect(foldDiacriticsToAscii("plain ascii 123")).toBe("plain ascii 123");
  });
});

describe("ingestion text normalization applies diacritic fixes", () => {
  test("normalizeArticleTitle converts legacy cedilla forms", () => {
    expect(normalizeArticleTitle("Şedinţa Guvernului: decizii noi")).toBe(
      "Ședința Guvernului: decizii noi",
    );
  });

  test("normalizeArticleSnippet converts legacy cedilla forms inside HTML", () => {
    expect(
      normalizeArticleSnippet("<p>Coaliţia a decis <b>şi</b> restul.</p>"),
    ).toBe("Coaliția a decis și restul.");
  });
});
