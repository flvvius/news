import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { authComponent } from "./auth";
import { computeStreakUpdate } from "./lib/streaks";
import {
  ensureUserProfileForAuthUser,
  getUserProfileByAuthUserId,
} from "./lib/userProfile";
const SOURCE_EVENT_LIMIT = 16;
const SOURCE_CLAIM_LIMIT = 8;
const SOURCE_ARTICLE_LIMIT = 8;
const SOURCE_FACT_LIMIT = 6;

const ANSWER_VALIDATOR = v.object({
  questionId: v.string(),
  choiceId: v.string(),
});

const QUESTION_TYPE_VALIDATOR = v.union(
  v.literal("claim_attribution"),
  v.literal("fact_check"),
  v.literal("perspective_match"),
  v.literal("coverage_gap"),
);

const LOCALIZED_TEXT_VALIDATOR = v.object({
  en: v.string(),
  ro: v.string(),
});

const QUIZ_QUESTION_VALIDATOR = v.object({
  id: v.string(),
  type: QUESTION_TYPE_VALIDATOR,
  question: LOCALIZED_TEXT_VALIDATOR,
  choices: v.array(
    v.object({
      id: v.string(),
      text: LOCALIZED_TEXT_VALIDATOR,
    }),
  ),
  correctChoiceId: v.string(),
  explanation: LOCALIZED_TEXT_VALIDATOR,
  attribution: v.object({
    eventTitle: v.string(),
    eventSlug: v.string(),
    sourceName: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    claim: v.optional(v.string()),
  }),
  eventId: v.id("events"),
  sourceIds: v.array(v.id("sources")),
});

function dateKeyForTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function stripCorrectAnswers(quiz: Doc<"dailyQuizzes">) {
  return {
    _id: quiz._id,
    dateKey: quiz.dateKey,
    status: quiz.status,
    questionCount: quiz.questions.length,
    sourceEventIds: quiz.sourceEventIds,
    publishedAt: quiz.publishedAt,
    questions: quiz.questions.map((question) => ({
      id: question.id,
      type: question.type,
      question: question.question,
      choices: question.choices,
      attribution: question.attribution,
      eventId: question.eventId,
      sourceIds: question.sourceIds,
    })),
  };
}

function buildReview(
  quiz: Doc<"dailyQuizzes">,
  answers: Array<{ questionId: string; choiceId: string }>,
) {
  const answersByQuestion = new Map(
    answers.map((answer) => [answer.questionId, answer.choiceId]),
  );
  const review = quiz.questions.map((question) => {
    const selectedChoiceId = answersByQuestion.get(question.id);
    return {
      questionId: question.id,
      type: question.type,
      question: question.question,
      choices: question.choices,
      selectedChoiceId,
      correctChoiceId: question.correctChoiceId,
      isCorrect: selectedChoiceId === question.correctChoiceId,
      explanation: question.explanation,
      attribution: question.attribution,
      eventId: question.eventId,
    };
  });

  return {
    score: review.filter((row) => row.isCorrect).length,
    maxScore: quiz.questions.length,
    review,
  };
}


async function updateUserStatsForDailyQuiz(
  ctx: MutationCtx,
  userId: Id<"users">,
  completedAt: number,
) {
  let stats = await ctx.db
    .query("userStats")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();

  if (!stats) {
    const statsId = await ctx.db.insert("userStats", {
      userId,
      currentStreak: 0,
      longestStreak: 0,
      articlesRead: 0,
      biasBalance: 0,
    });
    stats = await ctx.db.get(statsId);
    if (!stats) return;
  }

  const streakUpdate = computeStreakUpdate(stats, completedAt);

  await ctx.db.patch(stats._id, {
    currentStreak: streakUpdate.currentStreak,
    longestStreak: streakUpdate.longestStreak,
    lastActiveAt: streakUpdate.lastActiveAt,
  });
}

export const getTodayQuiz = query({
  args: {
    dateKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const dateKey = args.dateKey ?? dateKeyForTimestamp(Date.now());
    const quiz = await ctx.db
      .query("dailyQuizzes")
      .withIndex("by_date", (q) => q.eq("dateKey", dateKey))
      .unique();

    if (!quiz || quiz.status !== "ready") {
      return null;
    }

    return stripCorrectAnswers(quiz);
  },
});

export const getMyTodayAttempt = query({
  args: {
    dateKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return null;
    const user = await getUserProfileByAuthUserId(ctx, authUser._id);
    if (!user) return null;

    const dateKey = args.dateKey ?? dateKeyForTimestamp(Date.now());
    const attempt = await ctx.db
      .query("quizAttempts")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", user._id).eq("dateKey", dateKey),
      )
      .order("desc")
      .first();
    if (!attempt) return null;

    const quiz = await ctx.db.get(attempt.quizId);
    if (!quiz) return null;

    return {
      attemptId: attempt._id,
      quizId: attempt.quizId,
      dateKey: attempt.dateKey,
      completedAt: attempt.completedAt,
      ...buildReview(quiz, attempt.answers),
    };
  },
});

export const submitQuizAttempt = mutation({
  args: {
    quizId: v.id("dailyQuizzes"),
    answers: v.array(ANSWER_VALIDATOR),
  },
  handler: async (ctx, args) => {
    const quiz = await ctx.db.get(args.quizId);
    if (!quiz || quiz.status !== "ready") {
      throw new ConvexError("Quiz is not available");
    }

    const validQuestionIds = new Set(quiz.questions.map((q) => q.id));
    const validChoiceIdsByQuestion = new Map(
      quiz.questions.map((question) => [
        question.id,
        new Set(question.choices.map((choice) => choice.id)),
      ]),
    );
    const normalizedAnswers = args.answers.filter((answer, index, all) => {
      if (!validQuestionIds.has(answer.questionId)) return false;
      const validChoices = validChoiceIdsByQuestion.get(answer.questionId);
      if (!validChoices?.has(answer.choiceId)) return false;
      return all.findIndex((row) => row.questionId === answer.questionId) === index;
    });

    const result = buildReview(quiz, normalizedAnswers);
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      return {
        saved: false,
        completedAt: Date.now(),
        quizId: quiz._id,
        dateKey: quiz.dateKey,
        ...result,
      };
    }

    const user = await ensureUserProfileForAuthUser(ctx, authUser);
    if (!user) throw new ConvexError("User profile not found");

    const existingAttempt = await ctx.db
      .query("quizAttempts")
      .withIndex("by_user_quiz", (q) =>
        q.eq("userId", user._id).eq("quizId", quiz._id),
      )
      .unique();

    if (existingAttempt) {
      throw new ConvexError("You have already completed this quiz");
    }

    const completedAt = Date.now();
    const attemptId = await ctx.db.insert("quizAttempts", {
      userId: user._id,
      quizId: quiz._id,
      dateKey: quiz.dateKey,
      answers: normalizedAnswers,
      score: result.score,
      maxScore: result.maxScore,
      completedAt,
    });
    await updateUserStatsForDailyQuiz(ctx, user._id, completedAt);

    return {
      saved: true,
      attemptId,
      completedAt,
      quizId: quiz._id,
      dateKey: quiz.dateKey,
      ...result,
    };
  },
});

export const gradeQuizQuestion = mutation({
  args: {
    quizId: v.id("dailyQuizzes"),
    questionId: v.string(),
    choiceId: v.string(),
  },
  handler: async (ctx, args) => {
    const quiz = await ctx.db.get(args.quizId);
    if (!quiz || quiz.status !== "ready") {
      throw new ConvexError("Quiz is not available");
    }

    const question = quiz.questions.find((row) => row.id === args.questionId);
    if (!question) {
      throw new ConvexError("Question not found");
    }
    if (!question.choices.some((choice) => choice.id === args.choiceId)) {
      throw new ConvexError("Choice not found");
    }

    return {
      questionId: question.id,
      selectedChoiceId: args.choiceId,
      correctChoiceId: question.correctChoiceId,
      isCorrect: args.choiceId === question.correctChoiceId,
      explanation: question.explanation,
      attribution: question.attribution,
      eventId: question.eventId,
    };
  },
});

export const getQuizGenerationInput = internalQuery({
  args: {
    dateKey: v.string(),
    eventLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("dailyQuizzes")
      .withIndex("by_date", (q) => q.eq("dateKey", args.dateKey))
      .unique();

    const candidates = await ctx.db
      .query("publicEventPreviews")
      .withIndex("by_trending_score")
      .order("desc")
      .take(Math.min(Math.max(args.eventLimit ?? SOURCE_EVENT_LIMIT, 3), 30));

    const events = await Promise.all(
      candidates.map(async (preview) => {
        const event = await ctx.db.get(preview.eventId);
        if (!event || event.status !== "published") return null;

        const [claims, articles] = await Promise.all([
          ctx.db
            .query("eventClaims")
            .withIndex("by_event_importance", (q) =>
              q.eq("eventId", preview.eventId),
            )
            .order("desc")
            .take(SOURCE_CLAIM_LIMIT),
          ctx.db
            .query("articles")
            .withIndex("by_event", (q) => q.eq("eventId", preview.eventId))
            .take(SOURCE_ARTICLE_LIMIT),
        ]);

        const sourceIds = Array.from(
          new Set([
            ...preview.sources.map((source) => source._id),
            ...articles.map((article) => article.sourceId),
            ...claims.flatMap((claim) =>
              claim.variants.map((variant) => variant.sourceId),
            ),
          ]),
        );
        const sourceRows = await Promise.all(
          sourceIds.map((sourceId) => ctx.db.get(sourceId)),
        );
        const sourcesById = new Map(
          sourceRows
            .filter((source): source is Doc<"sources"> => source !== null)
            .map((source) => [String(source._id), source]),
        );

        return {
          event: {
            _id: event._id,
            title: event.title,
            slug: event.slug,
            perspectiveSummaries: event.perspectiveSummaries,
            globalImpact: event.globalImpact,
            sourceBiasCounts: preview.sourceBiasCounts,
            articleCount: preview.articleCount,
            sourceCount: preview.sourceCount,
          },
          sources: Array.from(sourcesById.values()).map((source) => ({
            _id: source._id,
            name: source.name,
            baseBias: source.baseBias,
            reliabilityScore: source.reliabilityScore,
            mbfcCategory: source.mbfcCategory,
          })),
          claims: claims.map((claim) => ({
            _id: claim._id,
            canonicalStatement: claim.canonicalStatement,
            claimType: claim.claimType,
            status: claim.status,
            importance: claim.importance,
            confidence: claim.confidence,
            variants: claim.variants.map((variant) => ({
              articleId: variant.articleId,
              sourceId: variant.sourceId,
              sourceName:
                sourcesById.get(String(variant.sourceId))?.name ?? "Unknown",
              sourceLean: variant.sourceLean,
              statement: variant.statement,
              value: variant.value,
            })),
          })),
          articles: articles
            .filter((article) => (article.atomicFacts ?? []).length > 0)
            .map((article) => ({
              _id: article._id,
              title: article.title,
              canonicalUrl: article.canonicalUrl,
              sourceId: article.sourceId,
              sourceName:
                sourcesById.get(String(article.sourceId))?.name ?? "Unknown",
              atomicFacts: (article.atomicFacts ?? []).slice(0, SOURCE_FACT_LIMIT),
            })),
        };
      }),
    );

    return {
      dateKey: args.dateKey,
      existing: existing
        ? {
            _id: existing._id,
            status: existing.status,
            inputSignature: existing.inputSignature,
          }
        : null,
      events: events.filter((event) => event !== null),
    };
  },
});

export const replaceDailyQuiz = internalMutation({
  args: {
    dateKey: v.string(),
    status: v.union(v.literal("ready"), v.literal("failed")),
    questions: v.array(QUIZ_QUESTION_VALIDATOR),
    sourceEventIds: v.array(v.id("events")),
    inputSignature: v.string(),
    model: v.string(),
    lastError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("dailyQuizzes")
      .withIndex("by_date", (q) => q.eq("dateKey", args.dateKey))
      .unique();
    const now = Date.now();
    const row = {
      dateKey: args.dateKey,
      status: args.status,
      questions: args.questions,
      sourceEventIds: args.sourceEventIds,
      inputSignature: args.inputSignature,
      model: args.model,
      generatedAt: now,
      publishedAt: args.status === "ready" ? now : undefined,
      lastError: args.lastError,
    };

    if (existing) {
      await ctx.db.patch(existing._id, row);
      return { quizId: existing._id, replaced: true };
    }

    const quizId = await ctx.db.insert("dailyQuizzes", row);
    return { quizId, replaced: false };
  },
});
