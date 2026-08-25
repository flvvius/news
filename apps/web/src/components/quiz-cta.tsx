import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { useT } from "@/lib/i18n/LocaleContext";
import { cn } from "@/lib/utils";

/**
 * Quiz call-to-action (feed + activity surfaces). A hairline-bounded row, not
 * a panel: it is one offer among the page's content, not a promo unit.
 * Renders nothing while the quiz feature flag is off (BIV-802) so no quiz
 * entry point is visible.
 */
export function QuizCta({ variant }: { variant: "feed" | "activity" }) {
  const t = useT();

  if (!FEATURE_FLAGS.quiz) {
    return null;
  }

  const title =
    variant === "feed" ? t("quiz.cta.feedTitle") : t("quiz.cta.activityTitle");
  const body =
    variant === "feed" ? t("quiz.cta.feedBody") : t("quiz.cta.activityBody");

  return (
    <section className="flex flex-col gap-3 border-y border-border py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className={cn("font-semibold", variant === "feed" && "text-sm")}>
          {title}
        </h2>
        <p className="max-w-[55ch] text-sm text-muted-foreground">{body}</p>
      </div>
      <Button
        asChild
        size="sm"
        variant="outline"
        className="shrink-0 self-start sm:self-auto"
      >
        <Link to="/quiz">{t("quiz.cta.action")}</Link>
      </Button>
    </section>
  );
}
