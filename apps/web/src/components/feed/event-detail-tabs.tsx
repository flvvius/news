import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import EventClaimComparison from "@/components/feed/event-claim-comparison";
import SourceCoverageSummary from "@/components/feed/source-coverage-summary";
import { SectionTitle } from "@/components/ui/section-title";
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
  perspectiveApplicable,
  globalImpact,
  articles,
}: {
  eventId: Id<"events">;
  perspectiveSummaries?: PerspectiveSummaries | null;
  // false = the summarizer judged the story has no reformist/suveranist axis
  // (CASE D) — show a note instead of the split. undefined = legacy events,
  // rendered exactly as before.
  perspectiveApplicable?: boolean | null;
  globalImpact?: string | null;
  articles: EventDetailArticle[];
}) {
  const t = useT();
  const hasPerspectives =
    perspectiveApplicable !== false &&
    Boolean(
      perspectiveSummaries?.reformist || perspectiveSummaries?.suveranist,
    );

  // Section rhythm from the native DESIGN_LOG: zones separate with mt-8 +
  // hairline + pt-6 while titles stay readable and content-first.
  const sectionBreak = "mt-8 border-t border-border pt-6";
  const bodyText =
    "break-words text-[15px] leading-relaxed text-foreground sm:text-base";
  // Perspective tabs: bias-token underline instead of pill chrome.
  const underlineTrigger =
    "flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-0 pb-2 pt-1 text-sm font-medium text-muted-foreground shadow-none transition-colors data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent dark:data-[state=active]:border-b-2";

  const perspectivesPanel = (
    <>
      {hasPerspectives ? (
        <section className="space-y-4">
          <SectionTitle>{t("event.multiplePerspectives")}</SectionTitle>
          <Tabs defaultValue="center" className="w-full gap-4">
            {/* overflow-x-auto: labels that outgrow 360px scroll inside the
                row instead of making the whole page x-scrollable (BIV-811). */}
            <TabsList className="flex h-auto w-full justify-start gap-6 overflow-x-auto rounded-none border-b border-border bg-transparent p-0">
              {perspectiveSummaries?.reformist && (
                <TabsTrigger
                  value="left"
                  className={`${underlineTrigger} data-[state=active]:border-bias-left dark:data-[state=active]:border-bias-left`}
                >
                  {t("event.left")}
                </TabsTrigger>
              )}
              <TabsTrigger
                value="center"
                className={`${underlineTrigger} data-[state=active]:border-bias-center dark:data-[state=active]:border-bias-center`}
              >
                {t("event.centerTab")}
              </TabsTrigger>
              {perspectiveSummaries?.suveranist && (
                <TabsTrigger
                  value="right"
                  className={`${underlineTrigger} data-[state=active]:border-bias-right dark:data-[state=active]:border-bias-right`}
                >
                  {t("event.right")}
                </TabsTrigger>
              )}
            </TabsList>

            {/* forceMount keeps the inactive perspective texts in the
                server-rendered DOM (Radix unmounts them by default, which
                left the left/right summaries invisible to crawlers). Radix
                still puts `hidden` on non-selected panels, so the visual
                tab behavior is unchanged. */}
            {perspectiveSummaries?.reformist && (
              <TabsContent value="left" forceMount>
                <p className={bodyText}>{perspectiveSummaries.reformist}</p>
              </TabsContent>
            )}

            <TabsContent value="center" forceMount>
              <p className={bodyText}>
                {perspectiveSummaries?.neutral ?? t("event.summaryPending")}
              </p>
            </TabsContent>

            {perspectiveSummaries?.suveranist && (
              <TabsContent value="right" forceMount>
                <p className={bodyText}>{perspectiveSummaries.suveranist}</p>
              </TabsContent>
            )}
          </Tabs>
        </section>
      ) : (
        <section className="space-y-4">
          <SectionTitle>{t("event.summary")}</SectionTitle>
          <p className={bodyText}>
            {perspectiveSummaries?.neutral ?? t("event.compareOriginal")}
          </p>
          {perspectiveApplicable === false && (
            <p className="text-sm text-muted-foreground">
              {t("event.noPoliticalAxis")}
            </p>
          )}
        </section>
      )}

      {globalImpact && (
        <section className={`${sectionBreak} space-y-4`}>
          <SectionTitle>{t("event.meaning")}</SectionTitle>
          <p className={bodyText}>{globalImpact}</p>
        </section>
      )}

      <div className={sectionBreak}>
        <SourceCoverageSummary articles={articles} />
      </div>
    </>
  );

  if (!FEATURE_FLAGS.claimAnalysis) {
    return perspectivesPanel;
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
