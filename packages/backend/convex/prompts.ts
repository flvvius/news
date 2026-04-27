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

function trimField(value: string | undefined, maxLength: number): string {
  return (value ?? "").trim().slice(0, maxLength);
}

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
        `Source: ${article.sourceName}`,
        `Source leaning: ${article.sourceBiasLabel}`,
        `Reliability score: ${article.sourceReliability}/10`,
        `Published: ${article.publishedAt}`,
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
      "Summarize clustered news coverage with strict factual discipline.",
      "Use only the supplied article material. Do not invent facts, numbers, motives, quotes, or outcomes.",
      "Separate what is broadly supported from how left-leaning and right-leaning sources frame or emphasize the story.",
      "If one side has limited coverage in the input, say so briefly without speculating.",
      "Write clear, neutral, source-grounded prose for news readers.",
      "Return only valid JSON with keys: center, left, right, globalImpact.",
    ].join(" "),
    user: [
      `Event title: ${input.eventTitle}`,
      "",
      "Write:",
      "- center: 2-4 sentences on the shared factual core.",
      "- left: 1-3 sentences on framing/emphasis from left or left-center sources.",
      "- right: 1-3 sentences on framing/emphasis from right or right-center sources.",
      "- globalImpact: 1-2 sentences explaining why this story matters generally, without personalizing.",
      "",
      "Keep each field concise. Avoid bullet points. Avoid unsupported certainty.",
      "",
      "Articles:",
      articleBlocks,
    ].join("\n"),
  };
}
