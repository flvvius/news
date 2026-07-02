import { describe, expect, test } from "vitest";

import { extractEntityCandidates } from "./lib/articleExtraction";

describe("entity extraction without wink-nlp (BIV-601)", () => {
  test("extracts Romanian proper-noun sequences from titles", () => {
    const entities = extractEntityCandidates(
      "Klaus Iohannis a promulgat legea bugetului",
      "Președintele Klaus Iohannis a promulgat marți legea. Klaus Iohannis a declarat că bugetul respectă țintele.",
    );
    expect(entities).toContain("klaus iohannis");
  });

  test("keeps connector-joined institutions like Curtea de Apel București", () => {
    const entities = extractEntityCandidates(
      "Curtea de Apel București a decis eliberarea",
      "Decizia Curtea de Apel București este definitivă.",
    );
    expect(
      entities.some((entity) => entity.includes("curtea de apel bucure")),
    ).toBe(true);
  });

  test("strips Romanian role prefixes", () => {
    const entities = extractEntityCandidates(
      "Premierul Marcel Ciolacu anunță noi măsuri fiscale",
      "Premierul Marcel Ciolacu a spus că măsurile se aplică imediat. Marcel Ciolacu a adăugat detalii.",
    );
    expect(entities).toContain("marcel ciolacu");
    expect(entities.some((entity) => entity.startsWith("premierul "))).toBe(
      false,
    );
  });

  test("keeps digit-bearing outlet and org names intact", () => {
    expect(
      extractEntityCandidates(
        "Digi24 anunță o dezbatere electorală",
        "Postul Digi24 a difuzat emisiunea aseară.",
      ),
    ).toContain("digi24");
    expect(
      extractEntityCandidates(
        "Antena 3 comentează protestul",
        "Postul Antena 3 a transmis imagini de la protest.",
      ),
    ).toContain("antena 3");
    expect(
      extractEntityCandidates(
        "Ancheta despre achiziții publice continuă",
        "G4Media a scris despre subiect. G4Media a revenit cu detalii.",
      ),
    ).toContain("g4media");
  });

  test("keeps numeric entities and acronyms", () => {
    const entities = extractEntityCandidates(
      "PSD propune un buget de $5 billion pentru 2026",
      "PSD a anunțat planul. Bugetul crește cu 12%.",
    );
    expect(entities).toContain("psd");
    expect(entities).toContain("12%");
  });

  test("filters weekday noise in both languages", () => {
    const entities = extractEntityCandidates(
      "Vineri se anunță proteste",
      "Protestele de Vineri au fost anunțate Monday.",
    );
    expect(entities).not.toContain("vineri");
    expect(entities).not.toContain("monday");
  });

  test("diacritics are preserved in extracted entities", () => {
    const entities = extractEntityCandidates(
      "Diana Șoșoacă cere ieșirea din UE",
      "Senatoarea Diana Șoșoacă a repetat cererea. Diana Șoșoacă a protestat.",
    );
    expect(entities).toContain("diana șoșoacă");
  });
});
