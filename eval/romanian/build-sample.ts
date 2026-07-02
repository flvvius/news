// BIV-701 — Romanian eval sample builder (read-only).
//
// Input:  eval/romanian/data/{events,articles,sources,topics,eventTopics}.jsonl
//         (extracted from `npx convex export` of the deployment after a few
//         days of Romanian ingestion — same convention as eval/build-sample.cjs).
// Output: eval/romanian/out/sample.json — 50-100 Romanian articles grouped by
//         event across topics, with everything the production summary prompt
//         needs.
//
// Run: pnpm exec tsx eval/romanian/build-sample.ts [--events N]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sourceBiasLabel } from "../../packages/backend/convex/lib/sourceBias";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, "data");
const OUT = path.join(HERE, "out");

const args = process.argv.slice(2);
const argValue = (flag: string, fallback: string) => {
  const index = args.indexOf(flag);
  return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
};
const TARGET_EVENTS = Math.max(5, parseInt(argValue("--events", "25"), 10));

function load(file: string): any[] {
  const full = path.join(DATA, file);
  if (!fs.existsSync(full)) {
    console.error(
      `Missing ${full}.\nExport a snapshot first:\n` +
        `  npx convex export --path /tmp/snapshot.zip && unzip /tmp/snapshot.zip -d /tmp/snapshot\n` +
        `  mkdir -p eval/romanian/data && for t in events articles sources topics eventTopics; do\n` +
        `    cp /tmp/snapshot/$t/documents.jsonl eval/romanian/data/$t.jsonl; done`,
    );
    process.exit(1);
  }
  return fs
    .readFileSync(full, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const events = load("events.jsonl");
const articles = load("articles.jsonl");
const sources = load("sources.jsonl");
const topics = load("topics.jsonl");
const eventTopics = load("eventTopics.jsonl");

const sourcesById = new Map(sources.map((s) => [s._id, s]));
const topicsById = new Map(topics.map((t) => [t._id, t]));
const topicSlugsByEvent = new Map<string, string[]>();
for (const et of eventTopics) {
  const slug = topicsById.get(et.topicId)?.slug;
  if (!slug) continue;
  const list = topicSlugsByEvent.get(et.eventId) ?? [];
  list.push(slug);
  topicSlugsByEvent.set(et.eventId, list);
}

const articlesByEvent = new Map<string, any[]>();
for (const article of articles) {
  if (!article.eventId) continue;
  const list = articlesByEvent.get(article.eventId) ?? [];
  list.push(article);
  articlesByEvent.set(article.eventId, list);
}

// Eligible: published, 2+ articles from 2+ Romanian sources.
const eligible = events.filter((event) => {
  if (event.status !== "published") return false;
  const eventArticles = articlesByEvent.get(event._id) ?? [];
  if (eventArticles.length < 2) return false;
  const domains = new Set(
    eventArticles
      .map((a) => sourcesById.get(a.sourceId)?.domain)
      .filter(Boolean),
  );
  return domains.size >= 2;
});

// Spread across topics round-robin so the sample isn't one news cycle.
const byTopic = new Map<string, any[]>();
for (const event of eligible) {
  const slug = topicSlugsByEvent.get(event._id)?.[0] ?? "untagged";
  const list = byTopic.get(slug) ?? [];
  list.push(event);
  byTopic.set(slug, list);
}
for (const list of byTopic.values()) {
  list.sort((a, b) => b.firstPublishedAt - a.firstPublishedAt);
}

const selected: any[] = [];
const topicLists = [...byTopic.values()];
for (let round = 0; selected.length < TARGET_EVENTS; round++) {
  let took = 0;
  for (const list of topicLists) {
    if (selected.length >= TARGET_EVENTS) break;
    const event = list[round];
    if (event) {
      selected.push(event);
      took++;
    }
  }
  if (took === 0) break;
}

const sample = selected.map((event) => {
  const eventArticles = (articlesByEvent.get(event._id) ?? [])
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, 12);
  return {
    eventId: event._id,
    eventTitle: event.title,
    topicSlugs: topicSlugsByEvent.get(event._id) ?? [],
    articles: eventArticles.map((article) => {
      const source = sourcesById.get(article.sourceId);
      return {
        articleId: article._id,
        title: article.title,
        sourceName: source?.name ?? "Necunoscut",
        sourceDomain: source?.domain ?? "",
        sourceBiasLabel: sourceBiasLabel(source ?? null),
        sourceBiasScore: source?.bias?.score ?? source?.baseBias ?? 0,
        sourceReliability: source?.reliabilityScore ?? 5,
        publishedAt: new Date(article.publishedAt).toISOString(),
        summary: article.summary,
        rssSnippet: article.rssSnippet,
        atomicFacts: article.atomicFacts ?? [],
        canonicalUrl: article.canonicalUrl,
        aiBiasScore: article.aiBias?.score ?? article.aiBiasScore,
      };
    }),
  };
});

const totalArticles = sample.reduce((sum, e) => sum + e.articles.length, 0);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(
  path.join(OUT, "sample.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), sample }, null, 2),
);
console.log(
  `sample.json: ${sample.length} events, ${totalArticles} articles ` +
    `(target 50-100 articles; adjust --events if outside range)`,
);
