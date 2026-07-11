import { useEffect, useRef, useState } from "react";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AiDisclosureLabel } from "@/components/feed/ai-disclosure-label";
import EventClaimComparison from "@/components/feed/event-claim-comparison";
import SourceCoverageSummary from "@/components/feed/source-coverage-summary";
import { SectionTitle } from "@/components/ui/section-title";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { useT } from "@/lib/i18n/LocaleContext";
import { captureEvent } from "@/lib/posthog";
import { cn } from "@/lib/utils";

type Crust = "reformist" | "suveranist";

// Which crust opens first on mobile. Fixed reformist for SSR (deterministic,
// no hydration mismatch), then randomised once per browser session on the
// client so neither camp is the permanent default (MIEZ-3 neutrality AC).
// Desktop shows both crusts side by side, so this only affects the mobile tabs.
const SESSION_CRUST_KEY = "miez-default-crust";

function useSessionDefaultCrust(): Crust {
  const [crust, setCrust] = useState<Crust>("reformist");
  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(SESSION_CRUST_KEY);
      if (stored === "reformist" || stored === "suveranist") {
        setCrust(stored);
        return;
      }
      const picked: Crust = Math.random() < 0.5 ? "reformist" : "suveranist";
      window.sessionStorage.setItem(SESSION_CRUST_KEY, picked);
      setCrust(picked);
    } catch {
      // sessionStorage blocked (private mode / embeds): keep the SSR default.
    }
  }, []);
  return crust;
}

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
 * L4 — per-sentence source attribution. When the stored grounding record
 * matches the displayed text, each sentence carries its supporting outlets
 * as a hover tooltip; otherwise the plain text renders unchanged.
 */
function GroundedText({
  text,
  field,
  grounding,
  className,
}: {
  text: string;
  field: string;
  grounding: GroundingData | undefined;
  className: string;
}) {
  const sentences =
    grounding?.results.filter((entry) => entry.field === field) ?? [];
  const reconstructed = sentences.map((entry) => entry.sentence).join(" ");
  if (sentences.length === 0 || reconstructed !== text) {
    return <p className={className}>{text}</p>;
  }
  return (
    <p className={className}>
      {sentences.map((entry, index) => (
        <span
          key={index}
          title={
            entry.supportingSources.length > 0
              ? `Susținut de: ${entry.supportingSources.join(", ")}`
              : undefined
          }
          className={
            entry.supportingSources.length > 0
              ? "decoration-muted-foreground/40 underline-offset-4 hover:underline"
              : undefined
          }
        >
          {entry.sentence}
          {index < sentences.length - 1 ? " " : ""}
        </span>
      ))}
    </p>
  );
}

const bodyText =
  "break-words text-[15px] leading-relaxed text-foreground sm:text-base";

/**
 * One "coajă" (crust): a single camp's take, tinted with that camp's token.
 * Both crusts share identical structure and type scale — only the token
 * differs — so neither camp reads as louder or primary (MIEZ-3/MIEZ-11).
 */
function CrustPanel({
  camp,
  label,
  text,
  field,
  grounding,
  // In the two-crust layout the mobile tab already names the crust, so the
  // panel heading is hidden there ("hidden md:block") and only shows on
  // desktop, where there is no tab bar. A lone crust keeps it always visible.
  headingClassName,
}: {
  camp: Crust;
  label: string;
  text: string;
  field: string;
  grounding: GroundingData | undefined;
  headingClassName?: string;
}) {
  const tint =
    camp === "reformist"
      ? { wrap: "border-camp-a/30 bg-camp-a-surface", head: "text-camp-a-fg" }
      : { wrap: "border-camp-b/30 bg-camp-b-surface", head: "text-camp-b-fg" };
  return (
    <article className={cn("h-full rounded-lg border p-4 sm:p-5", tint.wrap)}>
      <h3
        className={cn(
          "mb-2 text-sm font-semibold",
          tint.head,
          headingClassName,
        )}
      >
        {label}
      </h3>
      <GroundedText
        text={text}
        field={field}
        grounding={grounding}
        className={bodyText}
      />
    </article>
  );
}

/**
 * The event-detail content region, restructured for Miez (MIEZ-3):
 *   1. "Miezul" — the neutral common summary as the core block up top.
 *   2. Two equal-weight crusts ("Coaja reformistă" / "Coaja suveranistă"),
 *      side by side on desktop, tab-switched on mobile, each camp-tinted.
 *   3. Source coverage below.
 * Global impact is demoted to the bottom (MIEZ-4 turns it into an accordion).
 *
 * Still wrapped, only while the claimAnalysis feature flag is on (paused for
 * launch, BIV-602/BIV-804), in an outer tab bar adding the claims panel.
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
  const defaultCrust = useSessionDefaultCrust();
  // Controlled crust selection (mobile tabs): follows the per-session default
  // until the reader switches, then stays put.
  const [activeCrust, setActiveCrust] = useState<Crust>(defaultCrust);
  const crustTouched = useRef(false);
  useEffect(() => {
    if (!crustTouched.current) setActiveCrust(defaultCrust);
  }, [defaultCrust]);

  const disclosureSourceCount =
    sourceCount ??
    new Set(
      articles.map((article) => article.source?._id).filter(Boolean),
    ).size;

  const neutral = perspectiveSummaries?.neutral;
  const hasAiSummary = Boolean(
    neutral ||
      perspectiveSummaries?.reformist ||
      perspectiveSummaries?.suveranist ||
      globalImpact,
  );

  // CASE D (perspectiveApplicable === false): the summarizer judged the story
  // has no reformist/suveranist axis — suppress the crusts, show a note.
  const showCrusts = perspectiveApplicable !== false;
  const reformist = showCrusts ? perspectiveSummaries?.reformist : null;
  const suveranist = showCrusts ? perspectiveSummaries?.suveranist : null;
  const hasBothCrusts = Boolean(reformist && suveranist);
  const hasAnyCrust = Boolean(reformist || suveranist);

  // Section rhythm from the native DESIGN_LOG: zones separate with mt-8 +
  // hairline + pt-6 while titles stay readable and content-first.
  const sectionBreak = "mt-8 border-t border-border pt-6";

  // Mobile-only crust tab triggers (desktop shows both side by side).
  const crustTrigger =
    "flex-1 rounded-none border-0 border-b-2 border-transparent bg-transparent px-0 pb-2 pt-1 text-sm font-medium text-muted-foreground shadow-none transition-colors data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none";
  const crustPanelClass =
    "mt-4 data-[state=inactive]:hidden md:mt-0 md:data-[state=inactive]:block";

  // Two crusts → tabs on mobile, so hide the panel heading there (the tab
  // labels it) and show it only on desktop. A lone crust keeps it always on.
  const crustHeadingClass = hasBothCrusts ? "hidden md:block" : undefined;
  const reformistPanel = reformist ? (
    <CrustPanel
      camp="reformist"
      label={t("event.crustReformist")}
      text={reformist}
      field="reformist"
      grounding={grounding}
      headingClassName={crustHeadingClass}
    />
  ) : null;
  const suveranistPanel = suveranist ? (
    <CrustPanel
      camp="suveranist"
      label={t("event.crustSuveranist")}
      text={suveranist}
      field="suveranist"
      grounding={grounding}
      headingClassName={crustHeadingClass}
    />
  ) : null;

  const perspectivesPanel = (
    <>
      {/* 1. Miezul — the neutral common summary as the core block up top. */}
      <section className="space-y-3">
        <SectionTitle>{t("event.core")}</SectionTitle>
        <div className="rounded-lg border border-core/40 bg-core-surface p-4 sm:p-5">
          {neutral ? (
            <GroundedText
              text={neutral}
              field="neutral"
              grounding={grounding}
              className={bodyText}
            />
          ) : (
            // TODO(backend): no dedicated common/neutral summary field yet, so
            // the core falls back to the pending state. A future common-summary
            // field would populate the Miezul block directly.
            <p className={bodyText}>{t("event.summaryPending")}</p>
          )}
        </div>
        {perspectiveApplicable === false && (
          <p className="text-sm text-muted-foreground">
            {t("event.noPoliticalAxis")}
          </p>
        )}
      </section>

      {/* 2. Two crusts — equal weight, camp-tinted. Reformist takes the fixed
          left/first slot (alphabetical on the camp axis, documented as an
          arbitrary choice — not a preference); on mobile the tabs open on a
          per-session-random crust so neither camp is the standing default. */}
      {hasAnyCrust && (
        <section className={`${sectionBreak} space-y-4`}>
          <SectionTitle>{t("event.multiplePerspectives")}</SectionTitle>
          {hasBothCrusts ? (
            <Tabs
              value={activeCrust}
              onValueChange={(value) => {
                crustTouched.current = true;
                setActiveCrust(value as Crust);
              }}
              className="w-full gap-0"
            >
              {/* Tab bar is mobile-only; desktop renders both crusts in a grid. */}
              <TabsList className="flex w-full gap-6 rounded-none border-b border-border bg-transparent p-0 md:hidden">
                <TabsTrigger
                  value="reformist"
                  className={`${crustTrigger} data-[state=active]:border-camp-a`}
                >
                  {t("event.crustReformist")}
                </TabsTrigger>
                <TabsTrigger
                  value="suveranist"
                  className={`${crustTrigger} data-[state=active]:border-camp-b`}
                >
                  {t("event.crustSuveranist")}
                </TabsTrigger>
              </TabsList>

              {/* forceMount keeps both crusts in the server-rendered HTML for
                  crawlers; on mobile the inactive one is hidden, on desktop the
                  grid shows both regardless of active state. */}
              <div className="grid items-stretch gap-4 md:grid-cols-2">
                <TabsContent
                  value="reformist"
                  forceMount
                  className={crustPanelClass}
                >
                  {reformistPanel}
                </TabsContent>
                <TabsContent
                  value="suveranist"
                  forceMount
                  className={crustPanelClass}
                >
                  {suveranistPanel}
                </TabsContent>
              </div>
            </Tabs>
          ) : (
            // Only one crust genuinely diverges (v7): show it full width.
            (reformistPanel ?? suveranistPanel)
          )}
        </section>
      )}

      {/* L1 (AI Act art. 50(4)): AI-summary disclosure, server-rendered. */}
      {hasAiSummary && <AiDisclosureLabel sourceCount={disclosureSourceCount} />}

      {/* 3. Source coverage — shared below both crusts. NOTE: the API has no
          per-perspective source attribution, so listing sources "under each
          crust" would fabricate a camp→source mapping; kept shared instead.
          TODO(backend): per-crust source lists need per-perspective attribution. */}
      <div className={sectionBreak}>
        <SourceCoverageSummary articles={articles} />
      </div>

      {/* Global impact demoted (MIEZ-4): closed-by-default accordion below the
          crusts, off the initial viewport. Native <details> keeps it collapsed
          with no JS and stays keyboard-accessible; expanding fires a one-off
          analytics event so we have data to justify killing or fixing it. */}
      {globalImpact && (
        <details
          className={`${sectionBreak} group`}
          onToggle={(event) => {
            if (event.currentTarget.open) {
              captureEvent("global_impact_expand", { eventId });
            }
          }}
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
            {t("event.globalContext")}
            <span
              aria-hidden="true"
              className="transition-transform group-open:rotate-180"
            >
              ⌄
            </span>
          </summary>
          <p className={`mt-4 ${bodyText}`}>{globalImpact}</p>
        </details>
      )}
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
