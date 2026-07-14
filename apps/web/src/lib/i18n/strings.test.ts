// BIV-805: Romanian i18n audit — banned calques must never reappear in the
// catalog, and the corrected keys must carry the reviewed wording.
import { describe, expect, test } from "vitest";
import { STRINGS, getString } from "@news-app/i18n";

// Known-bad terms (literal machine-translation calques) in Romanian UI copy.
// "cadrare"/"încadrare" were literal renderings of "framing" — the correct
// term is "formulare" (or "orientare" when describing a source's leaning).
// The left/right vocabulary is banned in RO values because the product axis
// is reformist↔suveranist (docs/bias-axis-spec.md).
const BANNED_RO_TERMS = [
  /cadrare/i,
  /cadrăr/i, // declensions: cadrării, cadrărilor
  /încadrare/i,
  /încadrăr/i, // declensions: încadrări, încadrărilor
  /încadrează/i,
  /exclusiv(e)? din (stânga|dreapta|centru)/i,
  /rolling/i,
  /\bfeed-ul/i, // DOOM-style attached article: "feedul"
  /\bstreak-ur/i,
  /\btopicur/i, // anglicism "topic": use "categorie/categorii" (topicuri, topicurile, topicurilor)
];

describe("Romanian i18n catalog (BIV-805)", () => {
  test('no banned term appears in any RO value (regression: "cadrare")', () => {
    const offenders: string[] = [];
    for (const [key, value] of Object.entries(STRINGS.ro)) {
      for (const banned of BANNED_RO_TERMS) {
        if (banned.test(value)) {
          offenders.push(`${key}: "${value}" matches ${banned}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the framing term is corrected on the perspective labels", () => {
    // Single words (BIV-811): the two-word labels overflowed the tab row on
    // 360px viewports.
    expect(getString("ro", "event.left")).toBe("Reformistă");
    expect(getString("ro", "event.right")).toBe("Suveranistă");
    expect(getString("ro", "event.centerTab")).toBe("Neutră");
    expect(getString("ro", "claim.framing")).toBe("Formulare");
    expect(getString("ro", "claim.framings")).toBe("Diferențe de formulare");
  });

  test("claim exclusives use the reformist/suveranist axis vocabulary", () => {
    expect(getString("ro", "claim.leftExclusive")).toBe("Exclusiv reformist");
    expect(getString("ro", "claim.rightExclusive")).toBe(
      "Exclusiv suveranist",
    );
    expect(getString("ro", "claim.centerExclusive")).toBe("Exclusiv neutru");
  });

  test("the topic filter uses the Romanian 'categorie' vocabulary", () => {
    expect(getString("ro", "feed.topic.single")).toBe("Categorie");
    expect(getString("ro", "feed.topic.all")).toBe("Toate categoriile");
    expect(getString("ro", "feed.topic.filter")).toBe(
      "Filtrează după categorie",
    );
  });

  test("every RO key has a value and every EN key mirrors the RO key set", () => {
    const roKeys = Object.keys(STRINGS.ro).sort();
    const enKeys = Object.keys(STRINGS.en).sort();
    expect(enKeys).toEqual(roKeys);
    for (const [key, value] of Object.entries(STRINGS.ro)) {
      expect(value.trim(), `empty RO value for ${key}`).not.toBe("");
    }
  });
});
