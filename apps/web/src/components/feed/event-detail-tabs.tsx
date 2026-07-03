import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import EventClaimComparison from "@/components/feed/event-claim-comparison";
import SourceCoverageSummary from "@/components/feed/source-coverage-summary";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { useT } from "@/lib/i18n/LocaleContext";

type EventDetailArticle = {
  _id: Id<"articles">;
  title: string;
  canonicalUrl: string;
  source: {
    _id: Id<"sources">;
    name: string;
    logoUrl?: string;
    baseBias: number;
    reliabilityScore: number;
    mbfcCategory?: string;
    mbfcFactual?: string;
    mbfcCredibility?: string;
  } | null;
};

type PerspectiveSummaries = {
  neutral?: string | null;
  reformist?: string | null;
  suveranist?: string | null;
};

/**
 * The event-detail content region: perspective summaries, global impact and
 * source coverage — plus, only while the claimAnalysis feature flag is on
 * (paused for launch, BIV-602/BIV-804), an outer tab bar adding the
 * "Analiza afirmațiilor" claims panel. With the flag off the perspectives
 * content renders directly with no single-tab chrome left behind.
 */
export function EventDetailTabs({
  eventId,
  perspectiveSummaries,
  globalImpact,
  articles,
}: {
  eventId: Id<"events">;
  perspectiveSummaries?: PerspectiveSummaries | null;
  globalImpact?: string | null;
  articles: EventDetailArticle[];
}) {
  const t = useT();
  const hasPerspectives = Boolean(
    perspectiveSummaries?.reformist || perspectiveSummaries?.suveranist,
  );
  const tabCount = [
    perspectiveSummaries?.reformist ? "left" : null,
    "center",
    perspectiveSummaries?.suveranist ? "right" : null,
  ].filter(Boolean).length;

  const perspectivesPanel = (
    <>
      {hasPerspectives ? (
        <Card className="overflow-hidden border-border/80 py-0">
          <CardHeader className="border-b border-border/70 bg-muted/30 pt-3 sm:pt-4">
            <CardTitle className="text-xl tracking-tight">
              {t("event.multiplePerspectives")}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-4 sm:px-8 sm:pb-5">
            <Tabs defaultValue="center" className="w-full gap-5">
              <TabsList
                className={`grid w-full ${({ 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3" } as Record<number, string>)[tabCount] ?? "grid-cols-3"}`}
              >
                {perspectiveSummaries?.reformist && (
                  <TabsTrigger value="left">{t("event.left")}</TabsTrigger>
                )}
                <TabsTrigger value="center">{t("event.centerTab")}</TabsTrigger>
                {perspectiveSummaries?.suveranist && (
                  <TabsTrigger value="right">{t("event.right")}</TabsTrigger>
                )}
              </TabsList>

              {perspectiveSummaries?.reformist && (
                <TabsContent value="left">
                  <p className="max-w-[65ch] text-sm text-card-foreground sm:text-base">
                    {perspectiveSummaries.reformist}
                  </p>
                </TabsContent>
              )}

              <TabsContent value="center">
                <p className="max-w-[65ch] text-sm text-card-foreground sm:text-base">
                  {perspectiveSummaries?.neutral ?? t("event.summaryPending")}
                </p>
              </TabsContent>

              {perspectiveSummaries?.suveranist && (
                <TabsContent value="right">
                  <p className="max-w-[65ch] text-sm text-card-foreground sm:text-base">
                    {perspectiveSummaries.suveranist}
                  </p>
                </TabsContent>
              )}
            </Tabs>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden border-border/80 py-0">
          <CardHeader className="border-b border-border/70 bg-muted/30 py-3 sm:py-4">
            <CardTitle className="text-xl tracking-tight">
              {t("event.summary")}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pt-3 pb-4 sm:px-8 sm:pt-4 sm:pb-5">
            <p className="max-w-[65ch] text-sm text-card-foreground sm:text-base">
              {perspectiveSummaries?.neutral ?? t("event.compareOriginal")}
            </p>
          </CardContent>
        </Card>
      )}

      {globalImpact && (
        <Card className="overflow-hidden border-border/80 py-0">
          <CardHeader className="border-b border-border/70 bg-muted/30 pt-3 sm:pt-4">
            <CardTitle className="text-xl tracking-tight">
              {t("event.meaning")}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-4 sm:px-8 sm:pb-5">
            <p className="max-w-[65ch] text-sm text-card-foreground sm:text-base">
              {globalImpact}
            </p>
          </CardContent>
        </Card>
      )}

      <SourceCoverageSummary articles={articles} />
    </>
  );

  if (!FEATURE_FLAGS.claimAnalysis) {
    return <div className="space-y-5 sm:space-y-8">{perspectivesPanel}</div>;
  }

  return (
    <Tabs defaultValue="perspectives" className="gap-5">
      <TabsList className="grid h-11 w-full grid-cols-2 rounded-full bg-muted/70 p-1">
        <TabsTrigger
          className="h-full rounded-full border-0 py-0 text-sm font-medium after:hidden data-[state=active]:border-transparent data-[state=active]:bg-background data-[state=active]:shadow-sm dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-background/80"
          value="perspectives"
        >
          {t("event.perspectives")}
        </TabsTrigger>
        <TabsTrigger
          className="h-full rounded-full border-0 py-0 text-sm font-medium after:hidden data-[state=active]:border-transparent data-[state=active]:bg-background data-[state=active]:shadow-sm dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-background/80"
          value="claims"
        >
          {t("event.claimBreakdown")}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="perspectives" className="space-y-5 sm:space-y-8">
        {perspectivesPanel}
      </TabsContent>

      <TabsContent value="claims">
        <EventClaimComparison eventId={eventId} articles={articles} />
      </TabsContent>
    </Tabs>
  );
}
