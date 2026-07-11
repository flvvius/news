// BIV-701 — Romanian output eval harness.
//
// Generates event summaries with the PRODUCTION prompt + configured model,
// then scores four things:
//   1. language + schema (deterministic): 100% Romanian, schema-valid;
//   2. summary faithfulness (judge model): no invented facts;
//   3. named-entity accuracy (judge model) + bias-score sanity
//      (deterministic direction check vs the source reputation seed);
//   4. perspective distinctiveness (deterministic, prompt v7): the banned
//      "nucleul factual comun" boilerplate never appears, non-empty side
//      summaries diverge from neutral (low word overlap), and how often both
//      sides collapse to empty (neutral-only view).
//
// Run small batches by default (live API spend):
//   pnpm exec tsx eval/romanian/run-eval.ts --limit 10
//   pnpm exec tsx eval/romanian/run-eval.ts --limit 10 --offset 10   # next batch
//   flags: --limit N (default 10) --offset N --model <id> --judge <id> --dry-run
//
// Requires GEMINI_API_KEY (gemini-* models) / OPENAI_API_KEY (gpt-*) in env
// or eval/romanian/.env.local. Baseline + pass/fail bars: see README.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import OpenAI from "openai";

import {
  buildEventSummaryPrompt,
  LIMITED_COVERAGE_FALLBACK,
  type EventSummaryOutput,
} from "../../packages/backend/convex/prompts";
import {
  DEFAULT_CHAT_MODEL,
  GEMINI_OPENAI_BASE_URL,
  buildChatTuningParams,
  providerForModel,
} from "../../packages/backend/convex/lib/modelRouting";
import { looksRomanian } from "../../packages/backend/convex/lib/romanian";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "out");

// Load API keys from a gitignored local file if not already in env.
const envFile = path.join(HERE, ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (match && !process.env[match[1]!]) {
      process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
    }
  }
}

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const argValue = (flag: string, fallback: string) => {
  const index = args.indexOf(flag);
  return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
};

const LIMIT = Math.max(1, parseInt(argValue("--limit", "10"), 10));
const OFFSET = Math.max(0, parseInt(argValue("--offset", "0"), 10));
const MODEL = argValue("--model", DEFAULT_CHAT_MODEL);
const JUDGE_MODEL = argValue("--judge", "gemini-3.5-flash");
const DRY_RUN = has("--dry-run");

function clientFor(model: string): OpenAI {
  const provider = providerForModel(model);
  if (provider === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY required for gemini models");
    return new OpenAI({ apiKey, baseURL: GEMINI_OPENAI_BASE_URL });
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY required for gpt models");
  return new OpenAI({ apiKey });
}

const SUMMARY_SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "EventSummary",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        neutral: { type: "string" },
        reformist: { type: "string" },
        suveranist: { type: "string" },
        globalImpact: { type: "string" },
      },
      required: ["neutral", "reformist", "suveranist", "globalImpact"],
    },
  },
};

const JUDGE_SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "RomanianSummaryJudgement",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        unsupportedClaims: {
          type: "array",
          items: { type: "string" },
          description:
            "Claims in the summary NOT supported by any supplied article (invented facts).",
        },
        totalClaimsChecked: { type: "integer" },
        entityErrors: {
          type: "array",
          items: { type: "string" },
          description:
            "Named entities (persons, parties, institutions, counties) rendered incorrectly vs the articles.",
        },
        totalEntitiesChecked: { type: "integer" },
        notes: { type: "string" },
      },
      required: [
        "unsupportedClaims",
        "totalClaimsChecked",
        "entityErrors",
        "totalEntitiesChecked",
        "notes",
      ],
    },
  },
};

function buildJudgePrompt(
  eventTitle: string,
  articles: Array<{ sourceName: string; title: string; summary?: string; rssSnippet?: string; atomicFacts: string[] }>,
  output: EventSummaryOutput,
): { system: string; user: string } {
  const evidence = articles
    .map((article, index) =>
      [
        `Sursa ${index + 1}: ${article.sourceName}`,
        `Titlu: ${article.title}`,
        article.summary ? `Rezumat: ${article.summary}` : "",
        article.rssSnippet ? `Fragment: ${article.rssSnippet}` : "",
        article.atomicFacts.length
          ? `Fapte: ${article.atomicFacts.join(" | ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n---\n\n");

  return {
    system: [
      "Ești evaluator de fidelitate pentru rezumate de știri în limba română.",
      "Compari un rezumat generat cu articolele-sursă și identifici:",
      "1. Afirmații nesusținute: afirmații factuale din rezumat care NU apar în niciun material sursă (fapte inventate). Reformulările fidele NU sunt erori.",
      "2. Erori de entități: nume de persoane, partide, instituții sau județe redate greșit față de surse (nume distorsionate, funcții greșite, atribuiri către altă persoană).",
      "Numără fiecare afirmație factuală verificată (totalClaimsChecked) și fiecare entitate verificată (totalEntitiesChecked).",
      "Textele de rezervă standard (acoperire limitată / impact neprecizat) nu sunt afirmații factuale.",
      "Returnează doar JSON conform schemei.",
    ].join("\n"),
    user: [
      `Eveniment: ${eventTitle}`,
      "",
      "REZUMAT GENERAT:",
      `neutral: ${output.neutral}`,
      `reformist: ${output.reformist}`,
      `suveranist: ${output.suveranist}`,
      `globalImpact: ${output.globalImpact}`,
      "",
      "ARTICOLE-SURSĂ:",
      evidence,
    ].join("\n"),
  };
}

type SampleEvent = {
  eventId: string;
  eventTitle: string;
  topicSlugs: string[];
  articles: Array<{
    title: string;
    sourceName: string;
    sourceBiasLabel: string;
    sourceBiasScore: number;
    sourceReliability: number;
    publishedAt: string;
    summary?: string;
    rssSnippet?: string;
    atomicFacts: string[];
    canonicalUrl: string;
  }>;
};

function isFallback(field: string): boolean {
  return (
    field === LIMITED_COVERAGE_FALLBACK.reformist ||
    field === LIMITED_COVERAGE_FALLBACK.suveranist
  );
}

// v7: the "reflected the shared factual core" boilerplate is banned from
// perspective text. A non-diverging side must be empty, not filler.
const BANNED_PERSPECTIVE_PATTERNS = [
  /nucleul factual comun/i,
  /au reflectat (?:în mare |în esență )?(?:nucleul|faptele comune|acelea[șs]i fapte)/i,
  /au (?:preluat|oglindit) (?:în mare )?(?:nucleul|faptele comune)/i,
];

function bannedPhraseHits(output: EventSummaryOutput): string[] {
  const hits: string[] = [];
  for (const [side, text] of [
    ["reformist", output.reformist],
    ["suveranist", output.suveranist],
  ] as const) {
    if (!text.trim()) continue;
    const match = BANNED_PERSPECTIVE_PATTERNS.map((re) => text.match(re)).find(
      Boolean,
    );
    if (match) hits.push(`${side}: "${match[0]}"`);
  }
  return hits;
}

// Word-set Jaccard overlap of a side summary vs neutral. High overlap means
// the side just restates neutral and should have been left empty; low overlap
// means a genuinely distinct angle (the goal).
function contentTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-zăâîșț0-9\s]/gi, " ")
      .split(/\s+/)
      .filter((word) => word.length > 3),
  );
}

function overlapWithNeutral(side: string, neutral: string): number {
  const a = contentTokens(side);
  const b = contentTokens(neutral);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const word of a) if (b.has(word)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

// A shown side that restates neutral almost verbatim defeats the point of the
// split; flag it so we can see near-duplicate boxes even without the banned
// phrase.
const HIGH_OVERLAP_THRESHOLD = 0.5;

function perspectiveDistinctiveness(output: EventSummaryOutput) {
  const reformistShown = Boolean(output.reformist.trim());
  const suveranistShown = Boolean(output.suveranist.trim());
  const reformistSim = reformistShown
    ? overlapWithNeutral(output.reformist, output.neutral)
    : null;
  const suveranistSim = suveranistShown
    ? overlapWithNeutral(output.suveranist, output.neutral)
    : null;
  return {
    reformistShown,
    suveranistShown,
    reformistSim,
    suveranistSim,
    bannedHits: bannedPhraseHits(output),
    // Empty on both sides → the reader gets a clean neutral-only view.
    neutralOnly: !reformistShown && !suveranistShown,
    highOverlapSides: [
      reformistSim !== null && reformistSim > HIGH_OVERLAP_THRESHOLD,
      suveranistSim !== null && suveranistSim > HIGH_OVERLAP_THRESHOLD,
    ].filter(Boolean).length,
  };
}

/**
 * Bias sanity (deterministic): when a side summary is real (not the
 * limited-coverage fallback), the input must actually contain articles from
 * sources on that side of the axis, per the reputation seed. A side summary
 * synthesized with zero sources on that pole is a sanity failure.
 */
function biasSanityIssues(event: SampleEvent, output: EventSummaryOutput): string[] {
  const issues: string[] = [];
  const reformistSources = event.articles.filter(
    (a) => a.sourceBiasScore < 0,
  ).length;
  const suveranistSources = event.articles.filter(
    (a) => a.sourceBiasScore > 0,
  ).length;

  if (!isFallback(output.reformist) && reformistSources === 0) {
    issues.push("reformist summary produced with zero reformist-pole sources");
  }
  if (!isFallback(output.suveranist) && suveranistSources === 0) {
    issues.push(
      "suveranist summary produced with zero suveranist-pole sources",
    );
  }
  if (isFallback(output.reformist) && reformistSources >= 2) {
    issues.push(
      `reformist fallback used despite ${reformistSources} reformist-pole articles`,
    );
  }
  if (isFallback(output.suveranist) && suveranistSources >= 2) {
    issues.push(
      `suveranist fallback used despite ${suveranistSources} suveranist-pole articles`,
    );
  }
  return issues;
}

async function main() {
  const samplePath = path.join(OUT, "sample.json");
  if (!fs.existsSync(samplePath)) {
    console.error(
      "Missing out/sample.json — run `pnpm exec tsx eval/romanian/build-sample.ts` first.",
    );
    process.exit(1);
  }
  const { sample } = JSON.parse(fs.readFileSync(samplePath, "utf8")) as {
    sample: SampleEvent[];
  };
  const batch = sample.slice(OFFSET, OFFSET + LIMIT);
  console.log(
    `Evaluating events ${OFFSET + 1}-${OFFSET + batch.length} of ${sample.length} — model=${MODEL} judge=${JUDGE_MODEL}${DRY_RUN ? " (dry run)" : ""}`,
  );
  if (DRY_RUN) {
    for (const event of batch) {
      const prompt = buildEventSummaryPrompt({
        eventTitle: event.eventTitle,
        articles: event.articles,
      });
      console.log(
        `- ${event.eventTitle}: prompt ~${Math.round((prompt.system.length + prompt.user.length) / 4)} tokens, ${event.articles.length} articles`,
      );
    }
    return;
  }

  const generator = clientFor(MODEL);
  const judge = clientFor(JUDGE_MODEL);

  const results: any[] = [];
  for (const event of batch) {
    const prompt = buildEventSummaryPrompt({
      eventTitle: event.eventTitle,
      articles: event.articles,
    });

    const generation = await generator.chat.completions.create({
      model: MODEL,
      ...buildChatTuningParams(MODEL, { maxTokens: 1500 }),
      response_format: SUMMARY_SCHEMA,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
    } as never);
    const rawContent = generation.choices[0]?.message?.content ?? "";

    let output: EventSummaryOutput | null = null;
    let schemaValid = false;
    try {
      const parsed = JSON.parse(rawContent);
      if (
        typeof parsed.neutral === "string" &&
        typeof parsed.reformist === "string" &&
        typeof parsed.suveranist === "string" &&
        typeof parsed.globalImpact === "string"
      ) {
        output = parsed;
        schemaValid = true;
      }
    } catch {
      // schemaValid stays false
    }

    if (!output) {
      results.push({
        eventId: event.eventId,
        eventTitle: event.eventTitle,
        schemaValid: false,
        romanian: false,
        error: "invalid_output",
      });
      console.log(`✗ ${event.eventTitle}: schema-invalid output`);
      continue;
    }

    const fields = [
      output.neutral,
      output.reformist,
      output.suveranist,
      output.globalImpact,
    ];
    const romanian = fields.every((field) => looksRomanian(field));

    const judgePrompt = buildJudgePrompt(
      event.eventTitle,
      event.articles,
      output,
    );
    const judgement = await judge.chat.completions.create({
      model: JUDGE_MODEL,
      ...buildChatTuningParams(JUDGE_MODEL, { maxTokens: 1200 }),
      response_format: JUDGE_SCHEMA,
      messages: [
        { role: "system", content: judgePrompt.system },
        { role: "user", content: judgePrompt.user },
      ],
    } as never);
    const verdict = JSON.parse(
      judgement.choices[0]?.message?.content ?? "{}",
    ) as {
      unsupportedClaims: string[];
      totalClaimsChecked: number;
      entityErrors: string[];
      totalEntitiesChecked: number;
      notes: string;
    };

    const sanity = biasSanityIssues(event, output);
    const perspective = perspectiveDistinctiveness(output);
    results.push({
      eventId: event.eventId,
      eventTitle: event.eventTitle,
      schemaValid,
      romanian,
      output,
      unsupportedClaims: verdict.unsupportedClaims ?? [],
      totalClaimsChecked: verdict.totalClaimsChecked ?? 0,
      entityErrors: verdict.entityErrors ?? [],
      totalEntitiesChecked: verdict.totalEntitiesChecked ?? 0,
      biasSanityIssues: sanity,
      perspective,
      judgeNotes: verdict.notes ?? "",
    });
    const sideState = `${perspective.reformistShown ? "R" : "-"}${perspective.suveranistShown ? "S" : "-"}`;
    console.log(
      `${romanian && schemaValid && perspective.bannedHits.length === 0 ? "✓" : "✗"} ${event.eventTitle}: ro=${romanian} unsupported=${verdict.unsupportedClaims?.length ?? 0}/${verdict.totalClaimsChecked ?? 0} entityErr=${verdict.entityErrors?.length ?? 0}/${verdict.totalEntitiesChecked ?? 0} sanity=${sanity.length} sides=${sideState} banned=${perspective.bannedHits.length} highOverlap=${perspective.highOverlapSides}`,
    );
  }

  const scored = results.filter((r) => r.schemaValid);
  const totalClaims = scored.reduce((s, r) => s + (r.totalClaimsChecked ?? 0), 0);
  const unsupported = scored.reduce(
    (s, r) => s + (r.unsupportedClaims?.length ?? 0),
    0,
  );
  const totalEntities = scored.reduce(
    (s, r) => s + (r.totalEntitiesChecked ?? 0),
    0,
  );
  const entityErrors = scored.reduce(
    (s, r) => s + (r.entityErrors?.length ?? 0),
    0,
  );
  const sanityFailures = scored.filter(
    (r) => (r.biasSanityIssues?.length ?? 0) > 0,
  ).length;

  // Perspective distinctiveness (v7). bannedPhraseRate is the headline
  // regression guard — it must stay 0.
  const bannedPhraseEvents = scored.filter(
    (r) => (r.perspective?.bannedHits?.length ?? 0) > 0,
  ).length;
  const neutralOnlyEvents = scored.filter(
    (r) => r.perspective?.neutralOnly,
  ).length;
  const highOverlapEvents = scored.filter(
    (r) => (r.perspective?.highOverlapSides ?? 0) > 0,
  ).length;
  const shownSideSims = scored.flatMap((r) =>
    [r.perspective?.reformistSim, r.perspective?.suveranistSim].filter(
      (sim): sim is number => typeof sim === "number",
    ),
  );
  const meanShownSideOverlap = shownSideSims.length
    ? shownSideSims.reduce((s, v) => s + v, 0) / shownSideSims.length
    : null;
  const bothSidesGenuineEvents = scored.filter(
    (r) => r.perspective?.reformistShown && r.perspective?.suveranistShown,
  ).length;

  const summary = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    judgeModel: JUDGE_MODEL,
    offset: OFFSET,
    events: results.length,
    metrics: {
      schemaValidRate: results.length
        ? scored.length / results.length
        : 0,
      romanianRate: results.length
        ? results.filter((r) => r.romanian).length / results.length
        : 0,
      faithfulness: totalClaims > 0 ? 1 - unsupported / totalClaims : null,
      entityAccuracy:
        totalEntities > 0 ? 1 - entityErrors / totalEntities : null,
      biasSanityPassRate: scored.length
        ? 1 - sanityFailures / scored.length
        : null,
      // Perspective distinctiveness (v7):
      bannedPhraseRate: scored.length
        ? bannedPhraseEvents / scored.length
        : null,
      neutralOnlyRate: scored.length
        ? neutralOnlyEvents / scored.length
        : null,
      bothSidesShownRate: scored.length
        ? bothSidesGenuineEvents / scored.length
        : null,
      highOverlapRate: scored.length
        ? highOverlapEvents / scored.length
        : null,
      meanShownSideOverlap,
    },
    results,
  };

  fs.mkdirSync(OUT, { recursive: true });
  const outFile = path.join(
    OUT,
    `results-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));
  console.log("\nMetrics:", JSON.stringify(summary.metrics, null, 2));
  console.log(`Saved ${outFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
