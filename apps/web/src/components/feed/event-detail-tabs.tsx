import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AiDisclosureLabel } from "@/components/feed/ai-disclosure-label";
import EventClaimComparison from "@/components/feed/event-claim-comparison";
import SourceCoverageSummary from "@/components/feed/source-coverage-summary";
import { SectionTitle } from "@/components/ui/section-title";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import {
  isFallbackGlobalImpact,
  toSummaryPoints,
} from "@news-app/backend/convex/lib/summaryText";
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

export type GroundingData = {
  results: Array<{
    field: string;
    sentence: string;
    supportingSources: string[];
  }>;
} | null;

/**
 * L4 — per-sentence source attribution, applied to one rendered line.
 *
 * A line is decorated only when that exact sentence appears in the stored
 * grounding record, so a stale record degrades per line instead of dropping
 * attribution for the whole field.
 */
function GroundedSentence({
  sentence,
  supportingSources,
}: {
  sentence: string;
  supportingSources: string[] | undefined;
}) {
  if (!supportingSources || supportingSources.length === 0) {
    return <>{sentence}</>;
  }
  return (
    <span
      title={`Susținut de: ${supportingSources.join(", ")}`}
      className="decoration-muted-foreground/40 underline-offset-4 hover:underline"
    >
      {sentence}
    </span>
  );
}

/**
 * A summary rendered for scanning rather than for reading straight through
 * (BIV-820).
 *
 * Production summaries averaged 23 words per sentence in a single unbroken
 * block, which is accurate and close to unreadable on a phone. Prompt v9 asks
 * the model for short one-fact sentences; this splits them back out — an
 * opening line that says what happened, then one bullet per remaining fact.
 * Short texts (under three sentences) stay a plain paragraph: a two-item list
 * is more chrome than help.
 *
 * The stored value is untouched prose, so SEO descriptions, share images and
 * the grounding record keep seeing exactly what the model wrote.
 */
function SummaryBody({
  text,
  field,
  grounding,
  className,
  leadCount = 1,
  asPoints = true,
}: {
  text: string;
  field: string;
  grounding: GroundingData | undefined;
  className: string;
  /** 0 = every sentence becomes a bullet (used by the impact section). */
  leadCount?: number;
  /**
   * false keeps the field as one paragraph. The perspective sides read that
   * way on purpose: they are a single contrastive argument ("X emphasised
   * this, Y left it out"), which a list would chop into disconnected claims.
   */
  asPoints?: boolean;
}) {
  const { lead, points } = asPoints
    ? toSummaryPoints(text, { leadCount })
    : { lead: text.trim(), points: [] as string[] };
  const sourcesBySentence = new Map<string, string[]>(
    (grounding?.results ?? [])
      .filter((entry) => entry.field === field)
      .map((entry) => [entry.sentence, entry.supportingSources]),
  );

  if (points.length === 0) {
    return (
      <p className={className}>
        <GroundedSentence
          sentence={lead}
          supportingSources={sourcesBySentence.get(lead)}
        />
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {lead && (
        <p className={className}>
          <GroundedSentence
            sentence={lead}
            supportingSources={sourcesBySentence.get(lead)}
          />
        </p>
      )}
      <ul className={`${className} space-y-2`}>
        {points.map((point, index) => (
          <li key={index} className="flex gap-2.5">
            <span
              aria-hidden="true"
              className="mt-2.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50"
            />
            <span className="min-w-0 flex-1">
              <GroundedSentence
                sentence={point}
                supportingSources={sourcesBySentence.get(point)}
              />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

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
  sourceCount,
  grounding,
}: {
  eventId: Id<"events">;
  perspectiveSummaries?: PerspectiveSummaries | null;
  // false = the summarizer judged the story has no reformist/suveranist axis
  // (CASE D) — show a note instead of the split. undefined = legacy events,
  // rendered exactly as before.
  perspectiveApplicable?: boolean | null;
  globalImpact?: string | null;
  articles: EventDetailArticle[];
  // For the AI-disclosure label ("from N sources"); falls back to the
  // distinct sources present in `articles`.
  sourceCount?: number;
  // L4: per-sentence attribution mapping (null/undefined = render plain).
  grounding?: GroundingData;
}) {
  const t = useT();
  const disclosureSourceCount =
    sourceCount ??
    new Set(
      articles.map((article) => article.source?._id).filter(Boolean),
    ).size;
  const hasAiSummary = Boolean(
    perspectiveSummaries?.neutral ||
      perspectiveSummaries?.reformist ||
      perspectiveSummaries?.suveranist ||
      globalImpact,
  );
  // A stored globalImpact is never blank — `shouldResummarize` treats an empty
  // one as an incomplete run and would re-enqueue the event forever — so the
  // "no impact stated" fallback is filtered here, at render time.
  const impactText = isFallbackGlobalImpact(globalImpact)
    ? ""
    : (globalImpact ?? "").trim();
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
            {/* flex-wrap: labels that outgrow the row wrap to a new line
                instead of scrolling, while still never making the whole page
                x-scrollable (BIV-811). */}
            <TabsList className="flex h-auto w-full flex-wrap justify-start gap-6 rounded-none border-b border-border bg-transparent p-0">
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
                {t("event.core")}
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
                left the left/right summaries invisible to crawlers). With
                forceMount Radix treats every panel as "present" and never
                sets `hidden`, so we hide the inactive ones ourselves via
                data-[state=inactive]:hidden — content stays in the HTML, but
                only the selected tab shows. */}
            {perspectiveSummaries?.reformist && (
              <TabsContent
                value="left"
                forceMount
                className="data-[state=inactive]:hidden"
              >
                <SummaryBody
                  text={perspectiveSummaries.reformist}
                  field="reformist"
                  grounding={grounding}
                  className={bodyText}
                  asPoints={false}
                />
              </TabsContent>
            )}

            <TabsContent
              value="center"
              forceMount
              className="data-[state=inactive]:hidden"
            >
              {perspectiveSummaries?.neutral ? (
                <SummaryBody
                  text={perspectiveSummaries.neutral}
                  field="neutral"
                  grounding={grounding}
                  className={bodyText}
                />
              ) : (
                <p className={bodyText}>{t("event.summaryPending")}</p>
              )}
            </TabsContent>

            {perspectiveSummaries?.suveranist && (
              <TabsContent
                value="right"
                forceMount
                className="data-[state=inactive]:hidden"
              >
                <SummaryBody
                  text={perspectiveSummaries.suveranist}
                  field="suveranist"
                  grounding={grounding}
                  className={bodyText}
                  asPoints={false}
                />
              </TabsContent>
            )}
          </Tabs>
          {/* L1 (AI Act art. 50(4)): sits under the tab container so it is
              adjacent to whichever perspective tab is active, and is part of
              the server-rendered HTML. */}
          {hasAiSummary && (
            <AiDisclosureLabel sourceCount={disclosureSourceCount} />
          )}
        </section>
      ) : (
        <section className="space-y-4">
          <SectionTitle>{t("event.core")}</SectionTitle>
          {/* CASE D (no political axis) is a large share of the feed, so this
              branch gets the same scannable treatment as the tabbed one. */}
          {perspectiveSummaries?.neutral ? (
            <SummaryBody
              text={perspectiveSummaries.neutral}
              field="neutral"
              grounding={grounding}
              className={bodyText}
            />
          ) : (
            <p className={bodyText}>{t("event.compareOriginal")}</p>
          )}
          {perspectiveApplicable === false && (
            <p className="text-sm text-muted-foreground">
              {t("event.noPoliticalAxis")}
            </p>
          )}
          {hasAiSummary && (
            <AiDisclosureLabel sourceCount={disclosureSourceCount} />
          )}
        </section>
      )}

      {/* "Ce înseamnă asta" is the one section that answers *why the reader
          should care*, so it gets its own surface instead of being a fourth
          identical paragraph. It is dropped entirely when the model had no
          stated consequence to report: 35% of the impact sections live in
          production were the "no impact stated" fallback under a heading
          promising the opposite (BIV-820). */}
      {impactText && (
        <section className={`${sectionBreak} space-y-3`}>
          <SectionTitle>{t("event.meaning")}</SectionTitle>
          <div className="rounded-lg border border-border bg-muted/40 p-4 sm:p-5">
            <SummaryBody
              text={impactText}
              field="globalImpact"
              grounding={grounding}
              className={bodyText}
              leadCount={0}
            />
          </div>
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
