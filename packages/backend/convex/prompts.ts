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

function trimField(value: string | undefined, maxLength: number): string {
  return (value ?? "").trim().slice(0, maxLength);
}

const GLOBAL_IMPACT_FALLBACK =
  "Concrete downstream impact not stated in the supplied coverage.";

export function buildEventSummaryPrompt(input: EventSummaryPromptInput): {
  system: string;
  user: string;
} {
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
      '- If left or right has 0-1 articles in the input, set that side field to exactly "Limited left-leaning coverage in the input." or "Limited right-leaning coverage in the input." Do not speculate.',
      "- When articles conflict, use the most recent publishedAt as the current state only if it directly addresses the conflict.",
      "- Write neutral, source-grounded prose. No bullet points. No marketing language. No editorializing.",
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
    ].join("\n"),
    user: [
      `Event: ${input.eventTitle}`,
      "",
      "Write:",
      "- center (60-110 words): shared factual core, preferring facts confirmed across multiple sources. Note disagreements with attribution.",
      "- left (25-70 words): framing or emphasis from left/left-center sources, including atomic facts only they reported. Use the exact limited-coverage fallback if absent or thin.",
      "- right (25-70 words): framing or emphasis from right/right-center sources, including atomic facts only they reported. Use the exact limited-coverage fallback if absent or thin.",
      `- globalImpact (25-50 words): one concrete, source-supported downstream consequence: what changes, for whom, and on what timeline. If no article supports a concrete impact, write exactly "${GLOBAL_IMPACT_FALLBACK}"`,
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
      "- Use detectedEntities as grounding hints for names, organizations, and places, but do not output an entity unless the article text supports a factual claim about it.",
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
      `Extract up to ${input.maxFactsPerArticle} atomic facts per article.`,
      "Prefer 3-8 facts when the article has enough concrete information.",
      "Facts should be understandable without reading the original article.",
      "",
      "Articles:",
      articleBlocks,
    ].join("\n"),
  };
}
