import { Link } from "@tanstack/react-router";
import { BrainCircuit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { useT } from "@/lib/i18n/LocaleContext";
import { cn } from "@/lib/utils";

/**
 * Quiz call-to-action card (feed + activity surfaces). Renders nothing while
 * the quiz feature flag is off (BIV-802) so no quiz entry point is visible.
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
    <section
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border sm:flex-row sm:items-center sm:justify-between",
        variant === "feed"
          ? "bg-card/90 px-4 py-4 shadow-sm sm:px-5"
          : "bg-card p-4 sm:p-5",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <BrainCircuit className="size-5" aria-hidden="true" />
        </div>
        <div>
          <h2
            className={cn(
              "font-semibold",
              variant === "feed" && "text-sm",
            )}
          >
            {title}
          </h2>
          <p className="text-sm text-muted-foreground">{body}</p>
        </div>
      </div>
      <Button asChild size="sm" className="shrink-0">
        <Link to="/quiz">{t("quiz.cta.action")}</Link>
      </Button>
    </section>
  );
}
