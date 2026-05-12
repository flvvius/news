import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { api } from "@news-app/backend/convex/_generated/api";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  HelpCircle,
  Share2,
  Trophy,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { SignInPrompt } from "@/components/SignInPrompt";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageLoadingState } from "@/components/ui/page-loading-state";
import { getLocaleFromMatches } from "@/lib/i18n/getLocaleFromMatches";
import { useLocale, useT } from "@/lib/i18n/LocaleContext";
import { getString } from "@/lib/i18n/strings";
import { absoluteSiteUrl, SITE } from "@/lib/seo";
import { cn } from "@/lib/utils";

type QuizQuestion = {
  id: string;
  type: string;
  question: { en: string; ro: string };
  choices: Array<{ id: string; text: { en: string; ro: string } }>;
  attribution: {
    eventTitle: string;
    eventSlug: string;
    sourceName?: string;
    sourceUrl?: string;
    claim?: string;
  };
  eventId: Id<"events">;
};

type SubmitResult = {
  saved: boolean;
  score: number;
  maxScore: number;
  review: Array<{
    questionId: string;
    selectedChoiceId?: string;
    correctChoiceId: string;
    isCorrect: boolean;
    explanation: { en: string; ro: string };
    attribution: QuizQuestion["attribution"];
    eventId: Id<"events">;
  }>;
};

type QuestionFeedback = SubmitResult["review"][number];

export const Route = createFileRoute("/quiz")({
  head: ({ matches }) => {
    const locale = getLocaleFromMatches(matches);
    const title = getString(locale, "quiz.metaTitle");
    const description = getString(locale, "quiz.metaDescription");

    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:site_name", content: SITE.name },
        { property: "og:url", content: absoluteSiteUrl("/quiz") },
        { property: "og:type", content: "website" },
        { property: "og:image", content: SITE.ogImage },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: SITE.ogImage },
      ],
      links: [{ rel: "canonical", href: absoluteSiteUrl("/quiz") }],
    };
  },
  component: QuizRoute,
});

function localize(value: { en: string; ro: string }, locale: "en" | "ro") {
  return value[locale] || value.en;
}

function getTypeLabel(type: string, t: ReturnType<typeof useT>) {
  switch (type) {
    case "claim_attribution":
      return t("quiz.type.claimAttribution");
    case "fact_check":
      return t("quiz.type.factCheck");
    case "perspective_match":
      return t("quiz.type.perspectiveMatch");
    case "coverage_gap":
      return t("quiz.type.coverageGap");
    default:
      return t("quiz.type.question");
  }
}

function QuizRoute() {
  const t = useT();
  const quiz = useQuery(api.quiz.getTodayQuiz, {});

  if (quiz === undefined) {
    return (
      <PageLoadingState
        title={t("quiz.loading.title")}
        description={t("quiz.loading.body")}
        cardCount={2}
      />
    );
  }

  if (!quiz) {
    return (
      <div className="bg-linear-to-b from-background via-background to-muted/35">
        <div className="container mx-auto max-w-3xl px-4 py-10 sm:py-16">
          <Card className="overflow-hidden border-border bg-card/95">
            <CardContent className="flex flex-col items-center gap-5 px-6 py-10 text-center">
              <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <HelpCircle className="size-6" />
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-bold tracking-tight">
                  {t("quiz.empty.title")}
                </h1>
                <p className="mx-auto max-w-[55ch] text-sm text-muted-foreground">
                  {t("quiz.empty.body")}
                </p>
              </div>
              <Button asChild>
                <Link to="/feed">{t("quiz.empty.action")}</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return <QuizExperience quiz={quiz} />;
}

function QuizExperience({
  quiz,
}: {
  quiz: {
    _id: Id<"dailyQuizzes">;
    dateKey: string;
    questions: QuizQuestion[];
    questionCount: number;
  };
}) {
  const locale = useLocale();
  const t = useT();
  const { isAuthenticated } = useConvexAuth();
  const existingAttempt = useQuery(
    api.quiz.getMyTodayAttempt,
    isAuthenticated ? { dateKey: quiz.dateKey } : "skip",
  );
  const submitQuiz = useMutation(api.quiz.submitQuizAttempt);
  const gradeQuestion = useMutation(api.quiz.gradeQuizQuestion);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [questionFeedback, setQuestionFeedback] = useState<
    Record<string, QuestionFeedback>
  >({});
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGrading, setIsGrading] = useState(false);
  const currentQuestion = quiz.questions[currentIndex];
  const selectedChoiceId = currentQuestion ? answers[currentQuestion.id] : undefined;
  const answeredCount = Object.keys(answers).length;
  const currentFeedback = currentQuestion
    ? questionFeedback[currentQuestion.id]
    : undefined;
  const progress = Math.round((answeredCount / quiz.questions.length) * 100);
  const activeResult = result ?? existingAttempt;

  const reviewByQuestionId = useMemo(() => {
    const map = new Map<string, SubmitResult["review"][number]>();
    activeResult?.review?.forEach((row) => map.set(row.questionId, row));
    return map;
  }, [activeResult]);

  const handleSelect = async (questionId: string, choiceId: string) => {
    if (activeResult || questionFeedback[questionId] || isGrading) return;
    setAnswers((current) => ({ ...current, [questionId]: choiceId }));
    setIsGrading(true);
    try {
      const feedback = await gradeQuestion({
        quizId: quiz._id,
        questionId,
        choiceId,
      });
      setQuestionFeedback((current) => ({
        ...current,
        [questionId]: feedback as QuestionFeedback,
      }));
    } catch (error) {
      console.error("Failed to grade quiz answer:", error);
      toast.error(t("quiz.submit.error"));
      setAnswers((current) => {
        const next = { ...current };
        delete next[questionId];
        return next;
      });
    } finally {
      setIsGrading(false);
    }
  };

  const handleSubmit = async () => {
    if (isSubmitting || activeResult) return;
    setIsSubmitting(true);
    try {
      const response = await submitQuiz({
        quizId: quiz._id,
        answers: Object.entries(answers).map(([questionId, choiceId]) => ({
          questionId,
          choiceId,
        })),
      });
      setResult(response as SubmitResult);
      setCurrentIndex(quiz.questions.length);
    } catch (error) {
      console.error("Failed to submit quiz:", error);
      toast.error(t("quiz.submit.error"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleShare = async () => {
    if (!activeResult) return;
    const url = absoluteSiteUrl("/quiz");
    const text = t("quiz.share.text")
      .replace("{score}", String(activeResult.score))
      .replace("{max}", String(activeResult.maxScore));

    try {
      if (navigator.share) {
        await navigator.share({ title: t("quiz.share.title"), text, url });
      } else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        toast.success(t("quiz.share.copied"));
      }
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") return;
      toast.error(t("quiz.share.error"));
    }
  };

  const showResults = currentIndex >= quiz.questions.length || Boolean(activeResult);

  return (
    <div className="bg-linear-to-b from-background via-background to-muted/35">
      <div className="container mx-auto max-w-4xl px-4 py-6 sm:py-10">
        <div className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              {t("quiz.kicker")}
            </p>
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              {t("quiz.title")}
            </h1>
            <p className="max-w-[55ch] text-sm text-muted-foreground">
              {t("quiz.subtitle")}
            </p>
          </div>
          <div className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            {quiz.dateKey}
          </div>
        </div>

        {!showResults && currentQuestion ? (
          <Card className="overflow-hidden border-border bg-card/95 py-0">
            <div className="border-b border-border bg-muted/30 px-4 py-4 sm:px-6">
              <div className="mb-3 flex items-center justify-between gap-4">
                <span className="text-sm font-medium text-muted-foreground">
                  {t("quiz.progress")
                    .replace("{current}", String(currentIndex + 1))
                    .replace("{total}", String(quiz.questions.length))}
                </span>
                <span className="rounded-full bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
                  {getTypeLabel(currentQuestion.type, t)}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-background">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.max(progress, 8)}%` }}
                />
              </div>
            </div>

            <CardContent className="space-y-6 px-4 py-6 sm:px-6 sm:py-8">
              <div className="space-y-3">
                <h2 className="max-w-[65ch] text-xl font-semibold leading-snug tracking-tight sm:text-2xl">
                  {localize(currentQuestion.question, locale)}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {currentQuestion.attribution.sourceName
                    ? t("quiz.sourceLine").replace(
                        "{source}",
                        currentQuestion.attribution.sourceName,
                      )
                    : currentQuestion.attribution.eventTitle}
                </p>
              </div>

              <div className="grid gap-3">
                {currentQuestion.choices.map((choice) => {
                  const isSelected = selectedChoiceId === choice.id;
                  return (
                    <button
                      key={choice.id}
                      type="button"
                      onClick={() => void handleSelect(currentQuestion.id, choice.id)}
                      aria-pressed={isSelected}
                      disabled={Boolean(currentFeedback) || isGrading}
                      className={cn(
                        "flex min-h-14 items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-medium transition-all",
                        currentFeedback?.correctChoiceId === choice.id
                          ? "border-success/45 bg-success/10"
                          : currentFeedback &&
                              currentFeedback.selectedChoiceId === choice.id
                            ? "border-destructive/40 bg-destructive/10"
                            : isSelected
                          ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                          : "border-border bg-background hover:border-primary/35 hover:bg-accent",
                        (Boolean(currentFeedback) || isGrading) &&
                          "cursor-default",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold uppercase",
                          isSelected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border text-muted-foreground",
                        )}
                      >
                        {choice.id}
                      </span>
                      <span>{localize(choice.text, locale)}</span>
                    </button>
                  );
                })}
              </div>

              {currentFeedback && (
                <div
                  className={cn(
                    "rounded-xl border px-4 py-3 text-sm",
                    currentFeedback.isCorrect
                      ? "border-success/35 bg-success/10 text-foreground"
                      : "border-destructive/30 bg-destructive/10 text-foreground",
                  )}
                >
                  <div className="mb-1 flex items-center gap-2 font-semibold">
                    {currentFeedback.isCorrect ? (
                      <CheckCircle2 className="size-4 text-success" />
                    ) : (
                      <XCircle className="size-4 text-destructive" />
                    )}
                    {currentFeedback.isCorrect
                      ? t("quiz.correct")
                      : t("quiz.incorrect")}
                  </div>
                  <p className="leading-relaxed text-muted-foreground">
                    {localize(currentFeedback.explanation, locale)}
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between gap-3 border-t border-border pt-5">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}
                  disabled={currentIndex === 0}
                >
                  <ChevronLeft className="size-4" />
                  {t("quiz.previous")}
                </Button>
                {currentIndex === quiz.questions.length - 1 ? (
                  <Button
                    type="button"
                    onClick={handleSubmit}
                    disabled={
                      answeredCount < quiz.questions.length || isSubmitting
                    }
                  >
                    <Trophy className="size-4" />
                    {isSubmitting ? t("quiz.submitting") : t("quiz.finish")}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={() =>
                      setCurrentIndex((index) =>
                        Math.min(quiz.questions.length - 1, index + 1),
                      )
                    }
                    disabled={!currentFeedback}
                  >
                    {t("quiz.next")}
                    <ChevronRight className="size-4" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-5">
            <Card className="overflow-hidden border-border bg-card/95 py-0">
              <CardContent className="grid gap-5 px-4 py-6 sm:grid-cols-[1fr_auto] sm:items-center sm:px-6 sm:py-8">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    {t("quiz.result.kicker")}
                  </p>
                  <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                    {t("quiz.result.title")
                      .replace("{score}", String(activeResult?.score ?? 0))
                      .replace("{max}", String(activeResult?.maxScore ?? quiz.questions.length))}
                  </h2>
                  <p className="max-w-[55ch] text-sm text-muted-foreground">
                    {activeResult?.saved
                      ? t("quiz.result.saved")
                      : t("quiz.result.public")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  <Button type="button" onClick={handleShare}>
                    <Share2 className="size-4" />
                    {t("quiz.share.action")}
                  </Button>
                  <Button asChild variant="outline">
                    <Link to="/feed">{t("quiz.backToFeed")}</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>

            {!isAuthenticated && (
              <SignInPrompt
                title={t("quiz.signIn.title")}
                description={t("quiz.signIn.body")}
                redirectTo="/quiz"
              />
            )}

            <div className="grid gap-4">
              {quiz.questions.map((question, index) => {
                const review = reviewByQuestionId.get(question.id);
                const selectedChoiceIdForQuestion =
                  review?.selectedChoiceId ?? answers[question.id];
                const correctChoice = question.choices.find(
                  (choice) => choice.id === review?.correctChoiceId,
                );
                return (
                  <Card
                    key={question.id}
                    className="overflow-hidden border-border bg-card/95 py-0"
                  >
                    <CardContent className="space-y-4 px-4 py-5 sm:px-6">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="text-sm font-semibold text-muted-foreground">
                          {t("quiz.review.question").replace(
                            "{count}",
                            String(index + 1),
                          )}
                        </span>
                        {review?.isCorrect ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
                            <CheckCircle2 className="size-3.5" />
                            {t("quiz.correct")}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
                            <XCircle className="size-3.5" />
                            {t("quiz.incorrect")}
                          </span>
                        )}
                      </div>
                      <h3 className="text-lg font-semibold leading-snug">
                        {localize(question.question, locale)}
                      </h3>
                      <div className="grid gap-2">
                        {question.choices.map((choice) => {
                          const isSelected = selectedChoiceIdForQuestion === choice.id;
                          const isCorrect = review?.correctChoiceId === choice.id;
                          return (
                            <div
                              key={choice.id}
                              className={cn(
                                "rounded-lg border px-3 py-2 text-sm",
                                isCorrect
                                  ? "border-success/40 bg-success/10"
                                  : isSelected
                                    ? "border-destructive/35 bg-destructive/10"
                                    : "border-border bg-background",
                              )}
                            >
                              {localize(choice.text, locale)}
                            </div>
                          );
                        })}
                      </div>
                      <p className="max-w-[65ch] text-sm leading-relaxed text-muted-foreground">
                        {review
                          ? localize(review.explanation, locale)
                          : correctChoice
                            ? t("quiz.review.correctAnswer").replace(
                                "{answer}",
                                localize(correctChoice.text, locale),
                              )
                            : ""}
                      </p>
                      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                        <Button asChild variant="outline" size="sm">
                          <Link
                            to="/event/$slug"
                            params={{ slug: question.attribution.eventSlug }}
                          >
                            {t("quiz.review.openEvent")}
                            <ChevronRight className="size-3.5" />
                          </Link>
                        </Button>
                        {question.attribution.sourceUrl && (
                          <Button asChild variant="ghost" size="sm">
                            <a
                              href={question.attribution.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {t("quiz.review.source")}
                              <ExternalLink className="size-3.5" />
                            </a>
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
