import { describe, expect, test } from "vitest";

import {
  LIMITED_COVERAGE_FALLBACK,
  SIDE_COVERAGE_FALLBACK,
  isPlaceholderPerspective,
  stripPlaceholderPerspective,
} from "./lib/perspectiveText";

describe("placeholder perspective detection (BIV-812)", () => {
  test("recognizes the retired fallbacks verbatim", () => {
    expect(isPlaceholderPerspective(LIMITED_COVERAGE_FALLBACK.reformist)).toBe(
      true,
    );
    expect(isPlaceholderPerspective(LIMITED_COVERAGE_FALLBACK.suveranist)).toBe(
      true,
    );
    expect(isPlaceholderPerspective(SIDE_COVERAGE_FALLBACK)).toBe(true);
  });

  test("recognizes the near-miss variants the model produced", () => {
    const variants = [
      "Acoperire limitată din partea surselor suveraniste.",
      "Acoperirea este limitată în această parte.",
      "Acoperire redusă din partea surselor reformiste.",
      "Nu există acoperire din partea surselor cu orientare suveranistă.",
      "Nicio sursă reformistă nu a relatat evenimentul.",
      // Missing diacritics must not defeat the match.
      "Acoperire limitata din partea surselor cu orientare reformista.",
    ];
    for (const variant of variants) {
      expect(isPlaceholderPerspective(variant)).toBe(true);
    }
  });

  test("keeps real perspective text, including long ones that mention coverage", () => {
    const real =
      "Acoperire limitată sau nu, G4Media este singura publicație care leagă " +
      "afișarea rezultatelor de întârzierea contestațiilor, notează că " +
      "ministerul nu a comunicat câți elevi au promovat la a doua încercare " +
      "și insistă pe diferența dintre rata de promovare din vară și cea din " +
      "toamnă, un unghi absent din restul relatărilor despre același anunț.";
    expect(isPlaceholderPerspective(real)).toBe(false);
    expect(stripPlaceholderPerspective(real)).toBe(real);
    expect(
      isPlaceholderPerspective(
        "Digi24 pune accent pe termenul de depunere a contestațiilor.",
      ),
    ).toBe(false);
  });

  test("empty and missing values are not placeholders", () => {
    expect(isPlaceholderPerspective("")).toBe(false);
    expect(isPlaceholderPerspective(undefined)).toBe(false);
    expect(isPlaceholderPerspective(null)).toBe(false);
  });

  test("stripping collapses a placeholder to the empty string", () => {
    expect(
      stripPlaceholderPerspective(LIMITED_COVERAGE_FALLBACK.reformist),
    ).toBe("");
  });
});
