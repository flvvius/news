"use node";

import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { callOpenAI } from "./lib/aiCall";
import { reorderChoicesForQuestion } from "./lib/quizHelpers";

const DEFAULT_ENABLED = true;
const DEFAULT_MODEL = "gpt-5-nano";
const DEFAULT_TARGET_QUESTIONS = 5;
const DEFAULT_MIN_QUESTIONS = 3;
const QUIZ_PROMPT_VERSION = "v2-quality-ux";

const QUIZ_JSON_SCHEMA = {
  name: "daily_news_quiz",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      questions: {
        type: "array",
        minItems: 0,
        maxItems: 5,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            type: {
              type: "string",
              enum: [
                "claim_attribution",
                "fact_check",
                "perspective_match",
                "coverage_gap",
              ],
            },
            eventSlug: { type: "string" },
            eventTitle: { type: "string" },
            sourceNames: {
              type: "array",
              items: { type: "string" },
            },
            sourceUrl: { type: "string" },
            groundingClaim: { type: "string" },
            question: {
              type: "object",
              additionalProperties: false,
              properties: {
                en: { type: "string" },
                ro: { type: "string" },
              },
              required: ["en", "ro"],
            },
            choices: {
              type: "array",
              minItems: 2,
              maxItems: 4,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  id: { type: "string" },
                  text: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      en: { type: "string" },
                      ro: { type: "string" },
                    },
                    required: ["en", "ro"],
                  },
                },
                required: ["id", "text"],
              },
            },
            correctChoiceId: { type: "string" },
            explanation: {
              type: "object",
              additionalProperties: false,
              properties: {
                en: { type: "string" },
                ro: { type: "string" },
              },
              required: ["en", "ro"],
            },
          },
          required: [
            "id",
            "type",
            "eventSlug",
            "eventTitle",
            "sourceNames",
            "sourceUrl",
            "groundingClaim",
            "question",
            "choices",
            "correctChoiceId",
            "explanation",
          ],
        },
      },
    },
    required: ["questions"],
  },
} as const;

type QuizGenerationInput = {
  dateKey: string;
  existing: {
    _id: Id<"dailyQuizzes">;
    status: "pending" | "ready" | "failed";
    inputSignature: string;
  } | null;
  events: Array<{
    event: {
      _id: Id<"events">;
      title: string;
      slug: string;
      perspectiveSummaries?: {
        center?: string;
        left?: string;
        right?: string;
      };
      globalImpact?: string;
      sourceBiasCounts: {
        left: number;
        center: number;
        right: number;
      };
      articleCount: number;
      sourceCount: number;
    };
    sources: Array<{
      _id: Id<"sources">;
      name: string;
      baseBias: number;
      reliabilityScore: number;
      mbfcCategory?: string;
    }>;
    claims: Array<{
      canonicalStatement: string;
      claimType: string;
      status: string;
      importance: number;
      confidence: number;
      variants: Array<{
        sourceId: Id<"sources">;
        sourceName: string;
        sourceLean: string;
        statement: string;
        value?: string;
      }>;
    }>;
    articles: Array<{
      title: string;
      canonicalUrl: string;
      sourceId: Id<"sources">;
      sourceName: string;
      atomicFacts: string[];
    }>;
  }>;
};

type RawQuizQuestion = {
  id: string;
  type:
    | "claim_attribution"
    | "fact_check"
    | "perspective_match"
    | "coverage_gap";
  eventSlug: string;
  eventTitle: string;
  sourceNames: string[];
  sourceUrl: string;
  groundingClaim: string;
  question: { en: string; ro: string };
  choices: Array<{ id: string; text: { en: string; ro: string } }>;
  correctChoiceId: string;
  explanation: { en: string; ro: string };
};

type RawQuizResponse = {
  questions: RawQuizQuestion[];
};

type QuizGenerationSettings = {
  enabled: boolean;
  model: string;
  targetQuestions: number;
  minQuestions: number;
};

type QuizGenerationResult =
  | {
      status: "skipped";
      reason: string;
      questionCount?: number;
      spentUsd?: number;
      dailyLimitUsd?: number;
    }
  | {
      status: "failed";
      reason: string;
      questionCount: number;
    }
  | {
      status: "ready";
      quizId: Id<"dailyQuizzes">;
      replaced: boolean;
      questionCount: number;
    };

function dateKeyForTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function safeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function safeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function safeInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

// Heuristic threshold for matching paraphrased claims without over-matching.
const TOKEN_OVERLAP_THRESHOLD = 0.45;
const SENSITIVE_QUIZ_PATTERN =
  /\b(accused|arrest|arrested|assault|attack|attacked|casualties|casualty|charged|charges|conflict|court|criminal|dead|death|deaths|died|indictment|killed|lawsuit|legal|murder|suspect|trial|victim|victims|war|wounded)\b/i;

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenOverlap(left: string, right: string): number {
  const leftTokens = new Set(
    normalizeText(left)
      .split(" ")
      .filter((token) => token.length >= 4),
  );
  const rightTokens = new Set(
    normalizeText(right)
      .split(" ")
      .filter((token) => token.length >= 4),
  );
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared++;
  }
  return shared / Math.min(leftTokens.size, rightTokens.size);
}

function ensureQuestionMentionsEvent(
  question: { en: string; ro: string },
  eventTitle: string,
) {
  const normalizedTitle = normalizeText(eventTitle);
  const titleMentioned =
    normalizeText(question.en).includes(normalizedTitle) ||
    normalizeText(question.ro).includes(normalizedTitle);
  if (titleMentioned) {
    return {
      en: question.en.trim(),
      ro: question.ro.trim(),
    };
  }

  return {
    en: `About "${eventTitle}": ${question.en.trim()}`,
    ro: `Despre „${eventTitle}”: ${question.ro.trim()}`,
  };
}

function addExplanationContext(args: {
  explanation: { en: string; ro: string };
  eventTitle: string;
  sourceName?: string;
}) {
  const sourceClauseEn = args.sourceName
    ? ` and reporting from ${args.sourceName}`
    : "";
  const sourceClauseRo = args.sourceName
    ? ` și relatările de la ${args.sourceName}`
    : "";

  return {
    en: `${args.explanation.en.trim()} This refers to the event "${args.eventTitle}"${sourceClauseEn}.`,
    ro: `${args.explanation.ro.trim()} Se referă la evenimentul „${args.eventTitle}”${sourceClauseRo}.`,
  };
}

function hasSensitiveQuizMaterial(event: QuizGenerationInput["events"][number]) {
  const text = [
    event.event.title,
    event.event.globalImpact ?? "",
    event.claims.map((claim) => claim.canonicalStatement).join(" "),
    event.claims
      .flatMap((claim) => claim.variants.map((variant) => variant.statement))
      .join(" "),
    event.articles
      .flatMap((article) => [article.title, ...article.atomicFacts])
      .join(" "),
  ].join(" ");
  return SENSITIVE_QUIZ_PATTERN.test(text);
}

function hasGrounding(
  event: QuizGenerationInput["events"][number],
  claim: string,
) {
  const normalizedClaim = normalizeText(claim);
  if (normalizedClaim.length < 12) return false;

  const groundedTexts = [
    ...event.claims.flatMap((row) => [
      row.canonicalStatement,
      ...row.variants.map((variant) => variant.statement),
    ]),
    ...event.articles.flatMap((article) => article.atomicFacts),
  ];

  return groundedTexts.some((text) => {
    const normalizedText = normalizeText(text);
    return (
      normalizedText.includes(normalizedClaim) ||
      normalizedClaim.includes(normalizedText) ||
      tokenOverlap(normalizedClaim, normalizedText) >= TOKEN_OVERLAP_THRESHOLD
    );
  });
}

function buildInputSignature(input: QuizGenerationInput): string {
  const payload = {
    promptVersion: QUIZ_PROMPT_VERSION,
    events: input.events.map((event) => ({
      eventId: event.event._id,
      title: event.event.title,
      sourceCount: event.event.sourceCount,
      articleCount: event.event.articleCount,
      claims: event.claims.map((claim) => ({
        canonicalStatement: claim.canonicalStatement,
        status: claim.status,
        variants: claim.variants.map((variant) => [
          variant.sourceName,
          variant.statement,
        ]),
      })),
      facts: event.articles.map((article) => [
        article.sourceName,
        article.atomicFacts,
      ]),
    })),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function buildPrompt(input: QuizGenerationInput, targetQuestions: number) {
  const compactEvents = input.events.map((event, index) => ({
    index,
    slug: event.event.slug,
    title: event.event.title,
    summaries: event.event.perspectiveSummaries,
    sourceBiasCounts: event.event.sourceBiasCounts,
    sources: event.sources.map((source) => ({
      name: source.name,
      lean: source.mbfcCategory ?? source.baseBias,
      reliability: source.reliabilityScore,
    })),
    claims: event.claims.map((claim) => ({
      statement: claim.canonicalStatement,
      type: claim.claimType,
      status: claim.status,
      importance: claim.importance,
      variants: claim.variants.map((variant) => ({
        source: variant.sourceName,
        lean: variant.sourceLean,
        statement: variant.statement,
        value: variant.value,
      })),
    })),
    articles: event.articles.map((article) => ({
      source: article.sourceName,
      title: article.title,
      url: article.canonicalUrl,
      facts: article.atomicFacts,
    })),
  }));

  return {
    system: [
      "You create Biviant's Daily News Quiz from structured, source-attributed news facts.",
      "Every question must be grounded in the provided claims or atomic facts. Do not invent facts, sources, events, or URLs.",
      "Write calm, neutral, media-literacy questions. Avoid loaded language, sensational framing, and color-coded political labels.",
      "Produce both English and Romanian for every question. They must be semantic translations of the same stem, choices, explanation, and correct answer.",
      "Avoid sensitive content: no death tolls, named victims, specific criminal accusations against individuals, ongoing legal cases, or casualty-focused questions.",
      "Prefer source-attributed facts and claim divergences over trivia.",
      "Return JSON only, matching the provided schema exactly.",
    ].join("\n"),
    user: [
      `Create up to ${targetQuestions} quiz questions for UTC date ${input.dateKey}.`,
      "Question types, use a mix only when supported by the data:",
      "- claim_attribution: ask which source reported or emphasized a supplied claim, framed neutrally.",
      "- fact_check: ask whether the supplied source confirms, denies, partially addresses, or does not address a claim. Avoid vague true/false unless the fact is unambiguous.",
      "- perspective_match: test source framing or source-lean awareness without shaming the reader.",
      "- coverage_gap: only ask about a fact or claim that is clearly present in one coverage group and absent from others in the supplied data.",
      "Source selection rules:",
      "- Prefer atomic facts repeated or confirmed across multiple sources for fact_check.",
      "- Prefer recent, concrete, source-attributed material from the supplied event data.",
      "- Skip sensitive events or claims involving conflict, casualties, named victims, specific criminal accusations, or ongoing legal cases.",
      "Content rules:",
      "- Each question must clearly name the event title in the stem. No vague pronouns like 'this event'.",
      "- Each question must include: exact eventSlug, exact eventTitle, at least one sourceName from the event, best sourceUrl from an article, and a groundingClaim copied or tightly paraphrased from the supplied claims/facts.",
      "- No two questions may reference the same event.",
      "- Use stable choice ids a, b, c, d. Use 2 choices only for binary fact checks; use 3-4 choices otherwise.",
      "- Distribute correct answers across choice positions. Do not put the correct answer first by habit.",
      "- Stems should be 8 to 30 words. Choices should be 2 to 12 words. Explanations should be 1 to 3 sentences.",
      "- Explanations must reference the supplied source and explain why the correct choice follows from the supplied fact.",
      "- If the data does not support the requested number of high-quality questions, return fewer. Do not stretch.",
      JSON.stringify({ events: compactEvents }),
    ].join("\n\n"),
  };
}

function sanitizeQuizQuestions(
  rawQuestions: RawQuizQuestion[],
  input: QuizGenerationInput,
  targetQuestions: number,
) {
  const eventsBySlug = new Map(
    input.events.map((event) => [event.event.slug, event]),
  );
  const usedQuestionText = new Set<string>();
  const usedEventSlugs = new Set<string>();
  const questionIds = new Set<string>();
  const sanitized = [];

  for (const raw of rawQuestions) {
    const event = eventsBySlug.get(raw.eventSlug);
    if (!event) continue;
    if (usedEventSlugs.has(event.event.slug)) continue;
    const rawEventTitle = normalizeText(raw.eventTitle);
    const expectedEventTitle = normalizeText(event.event.title);
    if (
      rawEventTitle !== expectedEventTitle &&
      !rawEventTitle.includes(expectedEventTitle) &&
      !expectedEventTitle.includes(rawEventTitle)
    ) {
      continue;
    }
    if (hasSensitiveQuizMaterial(event)) continue;

    const questionKey = normalizeText(raw.question.en);
    if (questionKey.length < 12 || usedQuestionText.has(questionKey)) continue;
    usedQuestionText.add(questionKey);

    const candidateId = raw.id?.trim() || undefined;
    if (candidateId && questionIds.has(candidateId)) continue;

    const choiceIds = new Set(raw.choices.map((choice) => choice.id));
    const choiceTextKeys = raw.choices.map((choice) =>
      normalizeText(choice.text.en),
    );
    if (
      raw.choices.length < 2 ||
      raw.choices.length > 4 ||
      choiceIds.size !== raw.choices.length ||
      !choiceIds.has(raw.correctChoiceId) ||
      new Set(choiceTextKeys).size !== choiceTextKeys.length
    ) {
      continue;
    }

    if (!hasGrounding(event, raw.groundingClaim)) continue;

    const eventSourceNames = new Map(
      event.sources.map((source) => [normalizeText(source.name), source]),
    );
    const sourceIds = raw.sourceNames
      .map((name) => eventSourceNames.get(normalizeText(name))?._id)
      .filter((sourceId): sourceId is Id<"sources"> => Boolean(sourceId));
    if (sourceIds.length === 0) continue;

    const sourcesById = new Map(
      event.sources.map((source) => [String(source._id), source]),
    );
    const primarySource = sourcesById.get(String(sourceIds[0]));
    const primaryArticle =
      event.articles.find((article) => article.sourceId === sourceIds[0]) ??
      event.articles[0];
    const choices: RawQuizQuestion["choices"] = reorderChoicesForQuestion(
      raw.choices,
      raw.correctChoiceId,
      sanitized.length,
    );
    const question = ensureQuestionMentionsEvent(
      raw.question,
      event.event.title,
    );
    const explanation = addExplanationContext({
      explanation: raw.explanation,
      eventTitle: event.event.title,
      sourceName: primarySource?.name?.trim() || undefined,
    });

    const fallbackId: string = `q${sanitized.length + 1}`;
    let questionId: string = candidateId ?? fallbackId;
    if (!candidateId && questionIds.has(questionId)) {
      let counter = sanitized.length + 1;
      while (questionIds.has(`q${counter}`)) counter += 1;
      questionId = `q${counter}`;
    }
    if (questionIds.has(questionId)) continue;

    sanitized.push({
      id: questionId,
      type: raw.type,
      question,
      choices: choices.map((choice: RawQuizQuestion["choices"][number]) => ({
        id: choice.id,
        text: {
          en: choice.text.en.trim(),
          ro: choice.text.ro.trim(),
        },
      })),
      correctChoiceId: raw.correctChoiceId,
      explanation,
      attribution: {
        eventTitle: event.event.title,
        eventSlug: event.event.slug,
        sourceName: primarySource?.name?.trim() || undefined,
        sourceUrl: primaryArticle?.canonicalUrl?.trim() || undefined,
        claim: raw.groundingClaim.trim(),
      },
      eventId: event.event._id,
      sourceIds,
    });

    questionIds.add(questionId);
    usedEventSlugs.add(event.event.slug);

    if (sanitized.length >= targetQuestions) break;
  }

  return sanitized;
}

async function generateDailyQuizForDate(
  ctx: ActionCtx,
  dateKey: string,
  settings: QuizGenerationSettings,
): Promise<QuizGenerationResult> {
  const input = (await ctx.runQuery(internal.quiz.getQuizGenerationInput, {
    dateKey,
  })) as QuizGenerationInput;
  const inputSignature = buildInputSignature(input);

  if (
    input.existing?.status === "ready" &&
    input.existing.inputSignature === inputSignature
  ) {
    return {
      status: "skipped" as const,
      reason: "no_change_since_last_run",
      questionCount: 0,
    };
  }

  const sourceEventIds = input.events.map((event) => event.event._id);
  const usableEvents = input.events.filter(
    (event) =>
      !hasSensitiveQuizMaterial(event) &&
      (event.claims.length > 0 ||
        event.articles.some((article) => article.atomicFacts.length > 0)),
  );

  if (usableEvents.length < 2) {
    await ctx.runMutation(internal.quiz.replaceDailyQuiz, {
      dateKey,
      status: "failed",
      questions: [],
      sourceEventIds,
      inputSignature,
      model: settings.model,
      lastError: "not_enough_source_material",
    });
    return {
      status: "failed" as const,
      reason: "not_enough_source_material",
      questionCount: 0,
    };
  }

  const prompt = buildPrompt(
    { ...input, events: usableEvents },
    settings.targetQuestions,
  );
  let response: Awaited<ReturnType<typeof callOpenAI<RawQuizResponse>>>;
  try {
    response = await callOpenAI<RawQuizResponse>({
      kind: "chat",
      model: settings.model,
      temperature: 0.2,
      maxTokens: 2800,
      responseFormat: {
        type: "json_schema",
        json_schema: QUIZ_JSON_SCHEMA,
      },
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      context: {
        callType: "quiz_generation",
      },
      runtime: ctx,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await ctx.runMutation(internal.quiz.replaceDailyQuiz, {
      dateKey,
      status: "failed",
      questions: [],
      sourceEventIds,
      inputSignature,
      model: settings.model,
      lastError: errorMessage,
    });
    return { status: "failed" as const, reason: errorMessage, questionCount: 0 };
  }

  if (!response.result) {
    const error = response.error ?? "empty_quiz_generation_response";
    await ctx.runMutation(internal.quiz.replaceDailyQuiz, {
      dateKey,
      status: "failed",
      questions: [],
      sourceEventIds,
      inputSignature,
      model: settings.model,
      lastError: error,
    });
    return { status: "failed" as const, reason: error, questionCount: 0 };
  }

  const questions = sanitizeQuizQuestions(
    response.result.questions,
    { ...input, events: usableEvents },
    settings.targetQuestions,
  );

  if (questions.length < settings.minQuestions) {
    await ctx.runMutation(internal.quiz.replaceDailyQuiz, {
      dateKey,
      status: "failed",
      questions: [],
      sourceEventIds,
      inputSignature,
      model: settings.model,
      lastError: `post_validation_too_few_questions:${questions.length}`,
    });
    return {
      status: "failed" as const,
      reason: "post_validation_too_few_questions",
      questionCount: questions.length,
    };
  }

  const result: { quizId: Id<"dailyQuizzes">; replaced: boolean } =
    await ctx.runMutation(internal.quiz.replaceDailyQuiz, {
      dateKey,
      status: "ready",
      questions,
      sourceEventIds: Array.from(
        new Set(questions.map((question) => question.eventId)),
      ),
      inputSignature,
      model: settings.model,
    });

  return {
    status: "ready" as const,
    quizId: result.quizId,
    replaced: result.replaced,
    questionCount: questions.length,
  };
}

export const generateDailyQuiz = internalAction({
  args: {
    dateKey: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<QuizGenerationResult> => {
    const paused = await ctx.runQuery(internal.config.isPipelinePaused, {});
    if (paused) {
      return { status: "skipped" as const, reason: "pipeline_paused" };
    }

    const cfg: Record<string, unknown> = await ctx.runQuery(
      internal.config.getBatch,
      {
        keys: [
          "quiz_generation_enabled",
          "quiz_generation_model",
          "quiz_generation_target_questions",
          "quiz_generation_min_questions",
        ],
      },
    );
    const targetQuestions = safeInteger(
      cfg.quiz_generation_target_questions,
      DEFAULT_TARGET_QUESTIONS,
      3,
      5,
    );
    const settings: QuizGenerationSettings = {
      enabled: safeBoolean(cfg.quiz_generation_enabled, DEFAULT_ENABLED),
      model: safeString(cfg.quiz_generation_model, DEFAULT_MODEL),
      targetQuestions,
      minQuestions: safeInteger(
        cfg.quiz_generation_min_questions,
        DEFAULT_MIN_QUESTIONS,
        3,
        targetQuestions,
      ),
    };

    if (!settings.enabled) {
      return { status: "skipped" as const, reason: "disabled" };
    }

    const budget: {
      allowed: boolean;
      spentUsd: number;
      dailyLimitUsd: number;
    } = await ctx.runQuery(internal.aiBudget.checkBudget, {});
    if (!budget.allowed) {
      return {
        status: "skipped" as const,
        reason: "budget_exhausted",
        spentUsd: budget.spentUsd,
        dailyLimitUsd: budget.dailyLimitUsd,
      };
    }

    return generateDailyQuizForDate(
      ctx,
      args.dateKey ?? dateKeyForTimestamp(Date.now()),
      settings,
    );
  },
});
