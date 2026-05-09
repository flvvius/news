export type EventSummaryArticleInput = {
  title: string;
  sourceName: string;
  sourceBiasLabel: string;
  sourceReliability: number;
  publishedAt: string;
  summary?: string;
  rssSnippet?: string;
  atomicFacts: string[];
  canonicalUrl: string;
};

export type EventSummaryPromptInput = {
  eventTitle: string;
  articles: EventSummaryArticleInput[];
};

export type EventSummaryOutput = {
  center: string;
  left: string;
  right: string;
  globalImpact: string;
};

export type ArticleFactExtractionInput = {
  id: string;
  title: string;
  sourceName?: string;
  publishedAt?: string;
  entities?: string[];
  summary?: string;
  rssSnippet?: string;
  bodyText?: string;
};

export type ArticleFactExtractionPromptInput = {
  maxFactsPerArticle: number;
  articles: ArticleFactExtractionInput[];
};

export type ArticleBiasScoringInput = {
  id: string;
  title: string;
  sourceName?: string;
  sourceLean: string;
  sourceReliability: number;
  publishedAt?: string;
  summary?: string;
  rssSnippet?: string;
  bodyText?: string;
};

export type ArticleBiasScoringPromptInput = {
  maxInputChars: number;
  articles: ArticleBiasScoringInput[];
};

export type ClaimDivergenceStatus =
  | "agreement"
  | "divergence"
  | "framing"
  | "exclusive_left"
  | "exclusive_right"
  | "exclusive_center";

export type ClaimType =
  | "quantitative"
  | "event"
  | "attribution"
  | "policy"
  | "characterization";

export type ClaimAnalysisArticleInput = {
  title: string;
  sourceName: string;
  sourceLean: string;
  sourceReliability: number;
  publishedAt: string;
  atomicFacts: string[];
};

export type ClaimAnalysisPromptInput = {
  eventTitle: string;
  articles: ClaimAnalysisArticleInput[];
};

function trimField(value: string | undefined, maxLength: number): string {
  return (value ?? "").trim().slice(0, maxLength);
}

const GLOBAL_IMPACT_FALLBACK =
  "Concrete downstream impact not stated in the supplied coverage.";

function perspectiveCaseFor(count: number, side: "left" | "right"): string {
  const sideGroup = side === "left" ? "left/left-center" : "right/right-center";
  const fallback = `Limited ${side}-leaning coverage in the input.`;
  if (count <= 1) {
    return `CASE A - ${count} ${sideGroup} articles in input; write exactly "${fallback}"`;
  }
  return `CASE B or C - ${count} ${sideGroup} articles in input; choose CASE B if they mirror the shared factual core. Choose CASE C if they have distinct framing, emphasis, or exclusive facts.`;
}

export function buildEventSummaryPrompt(input: EventSummaryPromptInput): {
  system: string;
  user: string;
} {
  const leftArticleCount = input.articles.filter((article) => {
    const label = article.sourceBiasLabel.toLowerCase();
    return label === "left" || label === "left-center";
  }).length;
  const rightArticleCount = input.articles.filter((article) => {
    const label = article.sourceBiasLabel.toLowerCase();
    return label === "right" || label === "right-center";
  }).length;
  const leftCase = perspectiveCaseFor(leftArticleCount, "left");
  const rightCase = perspectiveCaseFor(rightArticleCount, "right");
  const articleBlocks = input.articles
    .map((article, index) => {
      const facts = article.atomicFacts
        .slice(0, 6)
        .map((fact) => `- ${trimField(fact, 220)}`)
        .join("\n");

      return [
        `Article ${index + 1}`,
        `sourceName: ${article.sourceName}`,
        `sourceBiasLabel: ${article.sourceBiasLabel}`,
        `sourceReliability: ${article.sourceReliability}/10`,
        `publishedAt: ${article.publishedAt}`,
        `Title: ${trimField(article.title, 220)}`,
        article.summary ? `Extracted summary: ${trimField(article.summary, 900)}` : "",
        article.rssSnippet ? `RSS snippet: ${trimField(article.rssSnippet, 700)}` : "",
        facts ? `Atomic facts:\n${facts}` : "",
        `Canonical URL: ${article.canonicalUrl}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");

  return {
    system: [
      "You are Biviant's event synthesis engine.",
      "You read clustered news coverage and write a strictly factual, multi-perspective summary.",
      "",
      "CORE RULES:",
      "- Use ONLY the supplied article material. Never invent facts, figures, quotes, motives, outcomes, or downstream effects.",
      "- Prefer facts confirmed by 2 or more sources. If a key fact appears in only one article, attribute it by source name.",
      "- Treat the atomicFacts fields as pre-extracted verifiable claims. Use them to identify shared facts, disagreements, and facts only one side reports.",
      "- If sources contradict on a fact, call out the disagreement with attribution. Do not silently pick one.",
      '- Group articles by sourceBiasLabel: "left" and "left-center" inform the left field; "right" and "right-center" inform the right field; all reliable sources can inform center.',
      "- Prefer sources with sourceReliability >= 7 when describing the current factual core. Attribute claims from sources with sourceReliability < 5.",
      "- When articles conflict, use the most recent publishedAt as the current state only if it directly addresses the conflict.",
      "- Write neutral, source-grounded prose. No bullet points. No marketing language. No editorializing.",
      "",
      "PERSPECTIVE FIELD COUNTS (precomputed; treat as ground truth):",
      `- left/left-center article count: ${leftArticleCount}`,
      `- right/right-center article count: ${rightArticleCount}`,
      "- Count by article sourceBiasLabel, not by distinct source name.",
      `LEFT CASE: ${leftCase}`,
      `RIGHT CASE: ${rightCase}`,
      "",
      "PERSPECTIVE CASE DEFINITIONS:",
      "- CASE A: use the exact limited-coverage fallback supplied in LEFT CASE or RIGHT CASE. Do not add explanation.",
      "- CASE B: write 50-100 words noting that the relevant side's sources largely mirrored the shared factual account. Name 1-2 sources and cite one or two specific shared elements they emphasized. Do not invent unique framing.",
      "- CASE C: write 50-100 words describing distinct framing, emphasis, or exclusive facts from that side, with source names.",
      '- Never use a "Limited..." fallback for a side whose article count is 2 or more.',
      "",
      "GLOBAL IMPACT RULES:",
      "- globalImpact must state one concrete, source-supported significance of the event.",
      "- Valid impact forms, in priority order: a specific downstream consequence; an already-stated effect such as market reactions, casualties, diplomacy, ceasefire status, sanctions, or commodity price moves; or direct stakes named by an article.",
      "- A stake exists when any article mentions specific risk to a person, group, market, region, treaty, election, ceasefire, supply, price, position, or institution.",
      "- If unsure whether a mention qualifies as a concrete stake, treat it as valid and write the impact.",
      "- Cite the source name when stating the impact.",
      `- Use exactly "${GLOBAL_IMPACT_FALLBACK}" only when the supplied articles are purely procedural or informational and contain no risk, effect, consequence, or stake language.`,
      "",
      "OUTPUT:",
      "- Return ONLY JSON with exactly these keys: center, left, right, globalImpact.",
      "- No prose, markdown, or code fences outside the JSON.",
      "",
      "DO NOT:",
      "- Reference articles by index. Use source names.",
      "- Mention URLs in prose.",
      '- Use evaluative language about source motives or the word "spin".',
      '- Use words like "could", "may", or "might" unless a supplied article uses that uncertainty.',
      '- Use marketing or vague hype words such as "transformative", "unprecedented", "historic", "crucial", or "critical" unless quoted by a source or tied to literal safety, medical, or emergency stakes.',
    ].join("\n"),
    user: [
      `Event: ${input.eventTitle}`,
      "",
      "Write:",
      "- center (70-120 words): shared factual core, preferring facts confirmed across multiple sources. Note disagreements with attribution.",
      "- left (50-100 words for CASE C; 50-100 words for CASE B): execute the LEFT CASE you were told above.",
      "- right (50-100 words for CASE C; 50-100 words for CASE B): execute the RIGHT CASE you were told above.",
      "- globalImpact (50-100 words): apply the GLOBAL IMPACT RULES. Prefer concrete stated effects or stakes over the fallback.",
      "",
      "Keep each field within its word limit. Avoid bullet points. Avoid unsupported certainty.",
      "",
      "Articles:",
      articleBlocks,
    ].join("\n"),
  };
}

export function buildArticleFactExtractionPrompt(
  input: ArticleFactExtractionPromptInput,
): {
  system: string;
  user: string;
} {
  const articleBlocks = input.articles
    .map((article) =>
      [
        `id: ${article.id}`,
        article.sourceName ? `sourceName: ${article.sourceName}` : "",
        article.publishedAt ? `publishedAt: ${article.publishedAt}` : "",
        `title: ${trimField(article.title, 240)}`,
        article.entities?.length
          ? `detectedEntities: ${article.entities.slice(0, 16).join(", ")}`
          : "",
        article.summary ? `summary: ${trimField(article.summary, 900)}` : "",
        article.rssSnippet
          ? `rssSnippet: ${trimField(article.rssSnippet, 700)}`
          : "",
        article.bodyText ? `bodyText: ${trimField(article.bodyText, 2600)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n---\n\n");

  return {
    system: [
      "You are Biviant's atomic fact extraction engine.",
      "You extract short, standalone factual claims from individual news articles.",
      "",
      "CORE RULES:",
      "- Use ONLY the supplied article material. Never infer, complete, or add facts from outside knowledge.",
      "- Each fact must be a single verifiable claim with a clear subject, action/state, and object or consequence.",
      "- Preserve specific numbers, dates, places, named actors, votes, charges, amounts, and deadlines when supplied.",
      "- Use detectedEntities to normalize entity names. When extracting a fact about an entity, prefer the most specific supported form found in detectedEntities or the article text.",
      "- If the article attributes a claim to an official, company, filing, court, witness, or other source, keep that attribution in the fact.",
      "- Exclude opinions, predictions, vague context, rhetoric, duplicate facts, and generic background that is not central to the article.",
      "- Do not mention article IDs, URLs, or source indexes in facts.",
      "",
      "OUTPUT:",
      '- Return ONLY JSON with exactly one key: "articles".',
      '- Each item must contain "id" and "facts".',
      "- facts must contain concise strings only.",
      "- If an article has no extractable factual claims, return an empty facts array for that id.",
    ].join("\n"),
    user: [
      `Cap at ${input.maxFactsPerArticle} atomic facts per article.`,
      "Output only facts the article actually supports. Do not pad to a target count.",
      "Facts should be understandable without reading the original article.",
      "",
      "Articles:",
      articleBlocks,
    ].join("\n"),
  };
}

export function buildArticleBiasScoringPrompt(
  input: ArticleBiasScoringPromptInput,
): {
  system: string;
  user: string;
} {
  const articleBlocks = input.articles
    .map((article) =>
      [
        `id: ${article.id}`,
        `sourceName: ${article.sourceName ?? "Unknown"}`,
        article.publishedAt ? `publishedAt: ${article.publishedAt}` : "",
        `title: ${trimField(article.title, 240)}`,
        article.summary ? `summary: ${trimField(article.summary, 900)}` : "",
        article.rssSnippet
          ? `rssSnippet: ${trimField(article.rssSnippet, 700)}`
          : "",
        article.bodyText
          ? `bodyText: ${trimField(article.bodyText, input.maxInputChars)}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n---\n\n");

  return {
    system: [
      "You are Biviant's per-article bias scoring engine.",
      "Score each article on four sub-dimensions. Return only JSON matching the schema.",
      "",
      "CORE RULES:",
      "- Score the article text, not the outlet's reputation. Source name is attribution metadata only; do not use it as a proxy for political lean.",
      "- Use only supplied article material. Do not infer author intent or facts beyond the text.",
      "- Treat straight-news attribution as lower opinion, even when quoted sources use partisan language.",
      "- Rationale must cite specific wording, sourcing, or structure from the article.",
      "",
      "POLITICAL LEAN ANCHORS (-5 to +5):",
      "-5: Strongly left. Frames events through a left-progressive lens, uses left-coded terms such as working class, corporate greed, undocumented immigrants, or highlights mostly left-aligned voices.",
      "-2: Left-center. Subtle left framing in word choice; often quotes left and center sources.",
      " 0: Neutral wire-style. Reuters, AP, or BBC straight-news templates. Symmetric attribution and descriptive language.",
      "+2: Right-center. Subtle right framing in word choice; often quotes right and center sources.",
      "+5: Strongly right. Frames events through a right-conservative lens, uses right-coded terms such as illegal aliens, elites, radical left, or highlights mostly right-aligned voices.",
      "",
      "EMOTIONAL LANGUAGE ANCHORS (0 to 5):",
      "0: Pure neutral language, such as 'The bill passed 60 to 40.'",
      "2: Mild evaluative language, such as 'The contentious bill narrowly passed.'",
      "5: Heavy loaded language, such as 'The disastrous bill was rammed through despite fierce opposition.'",
      "",
      "SOURCE DIVERSITY ANCHORS (0 to 5):",
      "0: Anonymous sources only, or a single named voice.",
      "2: Two or three sources from one perspective.",
      "5: Four or more sources spanning multiple political or expert perspectives, with direct quotes.",
      "",
      "FACT/OPINION ANCHORS (0 to 5):",
      "0: Pure reporting: who, what, when, where, and how. Attributed claims only.",
      "3: Reported with mild interpretive framing.",
      "5: Op-ed, editorial, analysis, or explicit author judgment.",
      "",
      "OUTPUT:",
      '- Return only JSON with exactly one key: "articles".',
      "- Each item must include the original id and all four scores.",
      "- No prose, markdown, or code fences outside the JSON.",
    ].join("\n"),
    user: [
      "Score these articles for per-article bias components.",
      "Keep each rationale to 1-2 concise sentences and cite article phrasing, sourcing, or structure.",
      "",
      "Articles:",
      articleBlocks,
    ].join("\n"),
  };
}

export function buildClaimAnalysisPrompt(input: ClaimAnalysisPromptInput): {
  system: string;
  user: string;
} {
  const articleBlocks = input.articles
    .map((article, index) => {
      const facts = article.atomicFacts
        .slice(0, 10)
        .map((fact, factIndex) => `  [${factIndex}] ${trimField(fact, 260)}`)
        .join("\n");

      return [
        `Article ${index}`,
        `Source: ${article.sourceName}`,
        `Lean: ${article.sourceLean}`,
        `Reliability: ${article.sourceReliability}/10`,
        `PublishedAt: ${article.publishedAt}`,
        `Title: ${trimField(article.title, 220)}`,
        `Facts:\n${facts || "  - No atomic facts supplied."}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");

  return {
    system: [
      "You are Biviant's claim divergence engine.",
      "",
      "Given atomic facts extracted from multiple articles covering the same news event, group facts that refer to the same underlying claim and classify how sources relate.",
      "",
      "STATUS DEFINITIONS:",
      "- agreement: 2 or more sources from 2 or more different lean groups state the same fact with the same values/details.",
      "- divergence: 2 or more sources state the same underlying claim with materially different values, numbers, dates, attributions, outcomes, or current status.",
      "- framing: 2 or more sources state the same fact but use materially different language that changes perspective, emphasis, or characterization.",
      "- exclusive_left: only left or left-center sources report a substantive fact.",
      "- exclusive_right: only right or right-center sources report a substantive fact.",
      "- exclusive_center: only center sources report a substantive fact.",
      "",
      "CLAIM TYPE DEFINITIONS:",
      "- quantitative: numbers, money, dates, vote counts, percentages, timelines, casualty counts, or other measurable values.",
      "- event: concrete occurrence, action, decision, filing, vote, arrest, appointment, meeting, statement release, or outcome.",
      "- attribution: who said, alleged, accused, reported, confirmed, denied, ordered, or promised something.",
      "- policy: laws, regulations, executive actions, court orders, program rules, institutional policies, or implementation effects.",
      "- characterization: descriptive labels or assessments such as peaceful/violent, legal/illegal, historic/routine, or success/failure.",
      "",
      "RULES:",
      "- A claim must be supported by at least one atomic fact from the input. Do not invent claims.",
      "- Each variant must reference the exact articleIndex and factIndex of an input atomic fact that supports it.",
      "- Cluster facts by their underlying assertion, not by surface wording.",
      "- Quantitative claims with different values are divergence, not framing.",
      "- Different dates, attributions, outcomes, or current status are divergence, not framing.",
      "- If variants describe the same outcome and differ only in precision versus vagueness, classify as framing, not divergence.",
      "- Trivial wording differences, synonyms, and sentence structure differences are agreement, not framing.",
      "- Do not classify a claim as agreement unless it has support from at least 2 distinct sources.",
      "- Do not classify a claim as divergence or framing unless it has at least 2 variants from distinct sources.",
      "- Do not reference a factIndex unless that atomic fact directly supports the canonical claim.",
      "- Do not mention URLs or article indexes in the canonical statement.",
      "- Importance rates how central the claim is to the news event, 1-5. Cap output at 12 claims total. If an event has fewer than 5 importance-3-or-higher claims, that is fine; quality over quantity.",
      "- Confidence is your certainty in the grouping and classification, 0-1. Lower it when facts are sparse or ambiguous.",
      "",
      "OUTPUT:",
      "- Return only JSON matching the schema. No prose, markdown, or code fences.",
    ].join("\n"),
    user: [
      `Event: ${input.eventTitle}`,
      "",
      `Articles (${input.articles.length}):`,
      articleBlocks,
      "",
      "Analyze claims across all articles and return the most important grouped claims per the schema.",
    ].join("\n"),
  };
}
