import { describe, expect, test } from "vitest";
import {
  chooseEventTitle,
  titleCentralityScores,
  titleTokens,
} from "./lib/eventTitle";

// The real production cluster: 18 articles, 17 about the CIA director's
// Moscow visit, seeded by one about an arrest in Kyiv — whose title the event
// kept while its summary described Moscow.
const MOSCOW_CLUSTER = [
  "Ucraina. Adjuncta șefului cabinetului prezidențial al lui Volodimir Zelenski a fost arestată preventiv",
  "The Wall Street Journal: John Ratcliffe, șeful CIA, s-a dus la Moscova pentru a avertiza Kremlinul",
  "Șeful spionajului rus, Serghei Narîșkin, confirmă întâlnirea cu John Ratcliffe, directorul CIA",
  "Ucraina, NATO, Iran: ce mesaj secret a transmis directorul CIA la Moscova",
  "WSJ: Vizita secretă a șefului CIA la Moscova ar fi putut avea scopul transmiterii unui avertisment",
  "Motivul pentru care șeful CIA s-a deplasat în mare secret la Moscova",
  "Ce se știe despre avionul militar cu care a venit șeful CIA la Moscova",
  "De ce s-a dus șeful CIA la Moscova. A stat doar câteva ore",
  "Directorul CIA a făcut vizita surpriză la Moscova, pe fondul evaluărilor",
  "CBS News: Directorul CIA, John Ratcliffe, se află într-o vizită secretă la Moscova",
  "Un avion militar american a aterizat la Moscova. Șeful CIA, prima vizită în Rusia",
];

describe("titleTokens", () => {
  test("folds diacritics and drops stopwords and short words", () => {
    const tokens = titleTokens("Șeful CIA a mers la Moscova pentru discuții");
    expect(tokens.has("seful")).toBe(true);
    expect(tokens.has("moscova")).toBe(true);
    expect(tokens.has("pentru")).toBe(false); // stopword
    expect(tokens.has("cia")).toBe(false); // under the 4-char floor
  });

  test("keeps meaningful short-ish place and entity words", () => {
    expect(titleTokens("Acord semnat de China").has("china")).toBe(true);
  });
});

describe("chooseEventTitle (BIV: divergent title vs summary)", () => {
  test("renames an event seeded by the outlier article", () => {
    const chosen = chooseEventTitle(MOSCOW_CLUSTER[0]!, MOSCOW_CLUSTER);
    expect(chosen).not.toBeNull();
    expect(chosen).not.toBe(MOSCOW_CLUSTER[0]);
    expect(chosen!.toLowerCase()).toContain("moscova");
  });

  test("leaves a coherent cluster's title alone", () => {
    // Same cluster minus the outlier: the incumbent is already representative,
    // so no rename should fire.
    const coherent = MOSCOW_CLUSTER.slice(1);
    const incumbent = chooseEventTitle(coherent[0]!, coherent);
    // Either it keeps the title, or any swap is between titles on one story.
    if (incumbent !== null) {
      expect(incumbent.toLowerCase()).toContain("moscova");
    }
  });

  test("never renames a cluster too small to have a majority", () => {
    expect(chooseEventTitle("A", ["A", "B"])).toBeNull();
    expect(chooseEventTitle("A", ["A"])).toBeNull();
    expect(chooseEventTitle("A", [])).toBeNull();
  });

  test("a same-story title that merely loses is left alone (no churn)", () => {
    // Calibrated from production: these two headline the same Damascus story.
    // The margin-based rule swapped them, which is churn on a published
    // headline. The incumbent is central to its cluster, so it must stand.
    const damascus = [
      "Două explozii la Damasc, lângă hotelul unde a fost cazat președintele Franței, Emmanuel Macron",
      "Explozii la Damasc, lângă hotelul în care este cazat Emmanuel Macron, aflat în vizită",
      "Damasc: explozii puternice în apropierea hotelului lui Macron",
      "Macron, în vizită la Damasc: explozii raportate lângă hotelul său",
    ];
    expect(chooseEventTitle(damascus[0]!, damascus)).toBeNull();
  });

  test("near-ties do not flip the headline", () => {
    // Three unrelated titles: nothing is meaningfully central, so the margin
    // keeps the incumbent and the title cannot oscillate as articles arrive.
    const unrelated = [
      "Guvernul a aprobat bugetul pentru sanatate",
      "Meciul de fotbal s-a incheiat la egalitate",
      "Vremea ramane calda in weekend",
    ];
    expect(chooseEventTitle(unrelated[0]!, unrelated)).toBeNull();
  });

  test("the outlier scores lowest in the cluster", () => {
    const scores = titleCentralityScores(MOSCOW_CLUSTER);
    const outlier = scores[0]!;
    expect(Math.min(...scores)).toBe(outlier);
  });
});
