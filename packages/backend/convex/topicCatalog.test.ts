import { describe, expect, test } from "vitest";

import {
  inferTopicSlugs,
  type TopicArticleContext,
  type TopicInferenceSettings,
  type TopicInferenceTopic,
} from "./clustering";
import { TOPIC_CATALOG, TOPIC_CATALOG_SLUGS } from "./topicCatalog";
import type { Id } from "./_generated/dataModel";

const TOPICS_FOR_TEST = TOPIC_CATALOG.map((topic, index) => ({
  _id: `topic-${index}` as Id<"topics">,
  ...topic,
})) satisfies TopicInferenceTopic[];

const SETTINGS: TopicInferenceSettings = {
  minScore: 4.5,
  confidenceRatio: 0.55,
  maxTopics: 3,
};

function inferSampleTopic(article: TopicArticleContext): string | undefined {
  return inferTopicSlugs(article, TOPICS_FOR_TEST, SETTINGS)[0];
}

describe("Romanian topic taxonomy (BIV-816)", () => {
  test("seeded topic display names are the finalized Romanian taxonomy", () => {
    expect(TOPIC_CATALOG.map((topic) => topic.displayName)).toEqual([
      "Politică",
      "Economie",
      "Externe",
      "Justiție",
      "Sănătate",
      "Educație",
      "Tehnologie",
      "Sport",
      "Cultură",
      "Social",
      "Mediu",
    ]);
    expect(TOPIC_CATALOG.map((topic) => topic.slug)).toEqual([
      "politica",
      "economie",
      "externe",
      "justitie",
      "sanatate",
      "educatie",
      "tehnologie",
      "sport",
      "cultura",
      "social",
      "mediu",
    ]);
    expect(TOPIC_CATALOG.map((topic) => topic.slug)).not.toContain("general");
    expect(TOPIC_CATALOG.map((topic) => topic.slug)).not.toContain("ai");
  });

  test("current catalog slug set excludes legacy English topics during backfill", () => {
    expect(TOPIC_CATALOG_SLUGS.has("economie")).toBe(true);
    expect(TOPIC_CATALOG_SLUGS.has("tehnologie")).toBe(true);
    expect(TOPIC_CATALOG_SLUGS.has("economy")).toBe(false);
    expect(TOPIC_CATALOG_SLUGS.has("tech")).toBe(false);
    expect(TOPIC_CATALOG_SLUGS.has("ai")).toBe(false);
  });

  test("Romanian sample articles map to correct, varied topics", () => {
    const samples: Array<{
      expected: string;
      article: TopicArticleContext;
    }> = [
      {
        expected: "politica",
        article: {
          title:
            "Guvernul negociază în coaliție noul calendar pentru alegerile prezidențiale",
          rssSnippet:
            "Premierul și liderii de partid au discutat în Parlament despre vot și campanie.",
          summary:
            "Coaliția de guvernare urmează să stabilească data alegerilor și mandatul noilor miniștri.",
          atomicFacts: ["Guvernul a discutat calendarul alegerilor."],
        },
      },
      {
        expected: "economie",
        article: {
          title:
            "BNR avertizează că inflația și deficitul bugetar pot ține prețurile ridicate",
          rssSnippet:
            "Economiștii discută despre taxe, salarii și piața muncii.",
          summary:
            "Banca Națională estimează presiuni pe buget, investiții și creștere economică.",
          atomicFacts: ["BNR a publicat o prognoză economică despre inflație."],
        },
      },
      {
        expected: "externe",
        article: {
          title:
            "NATO discută la Bruxelles noi sancțiuni legate de războiul din Ucraina",
          rssSnippet:
            "Miniștrii de externe ai statelor UE au participat la summit.",
          summary:
            "Diplomații au analizat sprijinul internațional și relațiile cu Rusia.",
          atomicFacts: ["Summitul NATO a vizat conflictul din Ucraina."],
        },
      },
      {
        expected: "justitie",
        article: {
          title:
            "DNA trimite în judecată un fost ministru într-un dosar de corupție",
          rssSnippet:
            "Procurorii au anunțat rechizitoriul, iar instanța va stabili primul termen.",
          summary:
            "Dosarul penal include acuzații de abuz în serviciu și control judiciar.",
          atomicFacts: ["DNA a trimis dosarul penal la instanță."],
        },
      },
      {
        expected: "sanatate",
        article: {
          title:
            "Ministerul Sănătății anunță noi reguli pentru spitale și pacienți",
          rssSnippet:
            "Medicii spun că tratamentul și medicamentele vor fi decontate mai rapid.",
          summary:
            "Sistemul medical primește fonduri pentru ambulanțe și secții de urgență.",
          atomicFacts: ["Ministerul Sănătății a anunțat reguli pentru spitale."],
        },
      },
      {
        expected: "educatie",
        article: {
          title:
            "Ministerul Educației schimbă calendarul pentru Bacalaureat și Evaluarea Națională",
          rssSnippet:
            "Elevii, profesorii și școlile vor primi metodologia pentru anul școlar.",
          summary:
            "Universitățile au cerut clarificări despre burse, examene și admitere.",
          atomicFacts: ["Ministerul Educației a modificat calendarul examenelor."],
        },
      },
      {
        expected: "tehnologie",
        article: {
          title:
            "O platformă de inteligență artificială raportează un atac cibernetic",
          rssSnippet:
            "Compania a blocat accesul hackerilor și investighează datele personale expuse.",
          summary:
            "Specialiștii în securitate cibernetică verifică algoritmii și aplicația online.",
          atomicFacts: ["Platforma digitală a raportat un atac cibernetic."],
        },
      },
      {
        expected: "sport",
        article: {
          title:
            "Echipa națională câștigă meciul decisiv din campionatul european",
          rssSnippet:
            "Antrenorul a lăudat fotbaliștii după golul marcat pe stadion.",
          summary:
            "Cluburile din Superliga urmăresc evoluția sportivilor convocați.",
          atomicFacts: ["Echipa națională a câștigat un meci de fotbal."],
        },
      },
      {
        expected: "cultura",
        article: {
          title:
            "Festivalul internațional de film aduce concerte și expoziții la București",
          rssSnippet:
            "Artiștii, muzeele și teatrele pregătesc evenimente culturale în weekend.",
          summary:
            "Ministerul Culturii susține proiecte de patrimoniu, literatură și cinema.",
          atomicFacts: ["Festivalul de film include concerte și expoziții."],
        },
      },
      {
        expected: "social",
        article: {
          title:
            "Protest în București după creșterea chiriilor și lipsa locuințelor sociale",
          rssSnippet:
            "Comunitățile cer ajutor pentru familii, copii și siguranță publică.",
          summary:
            "Participanții au vorbit despre sărăcie, drepturi sociale și protecția copilului.",
          atomicFacts: ["Protestul a vizat locuințele sociale și chiriile."],
        },
      },
      {
        expected: "mediu",
        article: {
          title:
            "Garda de Mediu investighează poluarea și tăierile ilegale de păduri",
          rssSnippet:
            "Autoritățile avertizează asupra inundațiilor, secetei și emisiilor.",
          summary:
            "Raportul despre schimbări climatice cere reciclare și energie regenerabilă.",
          atomicFacts: ["Garda de Mediu investighează poluarea unei păduri."],
        },
      },
    ];

    for (const sample of samples) {
      expect(inferSampleTopic(sample.article), sample.article.title).toBe(
        sample.expected,
      );
    }
  });

  test("Romanian sample distribution does not collapse into one or two topics", () => {
    const inferred = [
      "Guvernul și Parlamentul discută calendarul alegerilor în coaliție.",
      "BNR publică date despre inflație, deficit, taxe și salarii.",
      "NATO și UE discută sancțiuni după războiul din Ucraina.",
      "DNA trimite la instanță un dosar penal de corupție.",
      "Spitalele primesc medicamente și reguli noi pentru pacienți.",
      "Elevii susțin Bacalaureatul după noul calendar al Ministerului Educației.",
      "O aplicație de inteligență artificială investighează un atac cibernetic.",
      "Echipa națională câștigă meciul de fotbal pe stadion.",
      "Festivalul de film include concerte, teatru și expoziții.",
      "Garda de Mediu avertizează asupra poluării și schimbărilor climatice.",
    ]
      .map((title) =>
        inferSampleTopic({
          title,
          rssSnippet: title,
          summary: title,
          atomicFacts: [title],
        }),
      )
      .filter((slug): slug is string => slug !== undefined);

    expect(new Set(inferred).size).toBeGreaterThan(2);
    expect(inferred).not.toContain("general");
  });
});
