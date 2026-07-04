import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { Link } from "@tanstack/react-router";
import BookmarkButton from "@/components/bookmark-button";
import { formatAbsoluteTimestamp, formatRelativeTimestamp } from "@/lib/dates";
import { buildInteractionContextFromSources } from "@/lib/interaction-tracking";
import { useLocale, useT } from "@/lib/i18n/LocaleContext";
import type { ReactNode } from "react";

type EventCardProps = {
  event: {
    _id: Id<"events">;
    slug: string;
    title: string;
    imageUrl?: string;
    perspectiveSummaries?: {
      neutral?: string;
      reformist?: string;
      suveranist?: string;
    };
    globalImpact?: string;
    firstPublishedAt: number;
    lastUpdatedAt?: number;
    topicIds?: Id<"topics">[];
    articleCount?: number;
    sourceCount?: number;
    sourceBiasCounts?: {
      left: number;
      center: number;
      right: number;
    };
    sources?: Array<{
      _id: Id<"sources">;
      name: string;
      logoUrl?: string;
      baseBias: number;
      reliabilityScore: number;
      mbfcCategory?: string;
      mbfcFactual?: string;
      mbfcCredibility?: string;
    }>;
  };
  topicNamesById: Record<string, string>;
  /** Kept for API compatibility; the editorial row shows no logo stack. */
  maxSources?: number;
  variant?: "default" | "feature";
  searchQuery?: string;
  returnToFeed?: boolean;
  interactive?: boolean;
  /** Saved page only: show the bookmark toggle as the row's one action. */
  showBookmark?: boolean;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightTitle(title: string, query?: string): ReactNode {
  const terms = Array.from(
    new Set(
      (query ?? "")
        .trim()
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2),
    ),
  );

  if (terms.length === 0) {
    return title;
  }

  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  const parts = title.split(pattern);

  return parts.map((part, index) =>
    terms.some((term) => part.toLowerCase() === term.toLowerCase()) ? (
      <mark
        key={`${part}-${index}`}
        className="rounded bg-primary/18 px-0.5 text-inherit"
      >
        {part}
      </mark>
    ) : (
      <span key={`${part}-${index}`}>{part}</span>
    ),
  );
}

type BiasBucket = "left" | "center" | "right";

function getBiasBucket(
  source: NonNullable<EventCardProps["event"]["sources"]>[number],
): BiasBucket {
  const category = source.mbfcCategory?.toLowerCase();
  if (category === "left" || category === "left-center") return "left";
  if (category === "right" || category === "right-center") return "right";
  if (category === "center") return "center";
  if (source.baseBias < 0) return "left";
  if (source.baseBias > 0) return "right";
  return "center";
}

function biasBucketClass(bucket: BiasBucket) {
  if (bucket === "left") return "bg-bias-left-muted";
  if (bucket === "right") return "bg-bias-right-muted";
  return "bg-bias-center";
}

/**
 * Editorial feed row (BIV-807, mirrors the native DESIGN_LOG): kicker →
 * title → 4px bias distribution bar → meta line, with an optional right
 * thumbnail. The lead ("feature") row gets a full-width 3:2 image and a
 * bigger headline — a front-page move, not a "featured card". No card
 * chrome, no shadows, no per-row share/bookmark actions (the feed is for
 * reading; the saved page opts into the bookmark toggle).
 */
const EventCard = ({
  event,
  topicNamesById,
  variant = "default",
  searchQuery,
  returnToFeed = false,
  interactive = true,
  showBookmark = false,
}: EventCardProps) => {
  const locale = useLocale();
  const t = useT();
  const topics = (event.topicIds ?? [])
    .map((id) => topicNamesById[id])
    .filter(Boolean);
  const primaryTopic = topics[0] ?? t("event.general");
  const summaryPreview =
    event.perspectiveSummaries?.neutral ??
    event.globalImpact ??
    t("event.coveragePreview");
  const isFeature = variant === "feature";
  const lastUpdatedAt = event.lastUpdatedAt ?? event.firstPublishedAt;
  const lastUpdatedLabel = formatRelativeTimestamp(lastUpdatedAt, locale);
  const lastUpdatedTitle = formatAbsoluteTimestamp(lastUpdatedAt, locale);
  const interactionContext = buildInteractionContextFromSources(
    event.sources ?? [],
  );
  const fallbackBiasDistribution = (event.sources ?? []).reduce(
    (counts, source) => {
      counts[getBiasBucket(source)]++;
      return counts;
    },
    { left: 0, center: 0, right: 0 } as Record<BiasBucket, number>,
  );
  const biasDistribution = event.sourceBiasCounts ?? fallbackBiasDistribution;
  const totalSources = Math.max(
    0,
    event.sourceCount ?? event.sources?.length ?? 0,
  );
  const distributionTotal =
    biasDistribution.left + biasDistribution.center + biasDistribution.right;
  const showBiasDistribution =
    totalSources > 0 &&
    distributionTotal > 0 &&
    (event.sourceBiasCounts !== undefined ||
      (event.sources?.length ?? 0) > 0);

  const metaParts = [
    t("event.sources").replace("{count}", String(totalSources)),
    event.articleCount !== undefined
      ? event.articleCount === 1
        ? t("event.articles.one")
        : t("event.articles.many").replace(
            "{count}",
            String(event.articleCount),
          )
      : null,
    lastUpdatedLabel,
  ].filter(Boolean);

  const biasBar = showBiasDistribution ? (
    <div
      className="flex h-1 w-full max-w-64 overflow-hidden rounded-full bg-bias-track"
      aria-label={t("event.biasDistribution")
        .replace("{left}", String(biasDistribution.left))
        .replace("{center}", String(biasDistribution.center))
        .replace("{right}", String(biasDistribution.right))}
      role="img"
    >
      {(["left", "center", "right"] as BiasBucket[]).map((bucket) => {
        const count = biasDistribution[bucket];
        if (count === 0) return null;
        return (
          <div
            key={bucket}
            className={biasBucketClass(bucket)}
            style={{ width: `${(count / distributionTotal) * 100}%` }}
          />
        );
      })}
    </div>
  ) : null;

  const kicker = (
    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
      {primaryTopic}
    </p>
  );

  const meta = (
    <p className="text-xs text-muted-foreground" title={lastUpdatedTitle}>
      {metaParts.join(" · ")}
    </p>
  );

  const rowContent = isFeature ? (
    <article className="flex flex-col gap-3">
      {event.imageUrl && (
        <div className="aspect-3/2 w-full overflow-hidden rounded-lg border border-border bg-muted">
          <img
            src={event.imageUrl}
            alt={event.title}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
      )}
      {kicker}
      <h3 className="break-words text-2xl font-semibold leading-tight tracking-tight text-foreground transition-colors group-hover:text-primary">
        {highlightTitle(event.title, searchQuery)}
      </h3>
      <p className="line-clamp-2 max-w-[65ch] break-words text-sm text-muted-foreground">
        {summaryPreview}
      </p>
      {biasBar}
      {meta}
    </article>
  ) : (
    <article data-slot="event-card-list-row" className="flex gap-4">
      <div data-slot="event-card-list-copy" className="min-w-0 flex-1 space-y-2">
        {kicker}
        <h3 className="line-clamp-3 break-words text-lg font-semibold leading-snug tracking-tight text-foreground transition-colors group-hover:text-primary">
          {highlightTitle(event.title, searchQuery)}
        </h3>
        {biasBar}
        {meta}
      </div>
      {event.imageUrl && (
        <div
          data-slot="event-card-list-thumbnail"
          className="h-24 w-32 shrink-0 overflow-hidden rounded-lg border border-border bg-muted"
        >
          <img
            src={event.imageUrl}
            alt=""
            aria-hidden="true"
            width={128}
            height={96}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
      )}
    </article>
  );

  // The bookmark toggle must be a SIBLING of the row link, never nested
  // inside it — <a><button/></a> is invalid, keyboard-hostile markup.
  const bookmarkAction = showBookmark ? (
    <div className="shrink-0 self-start">
      <BookmarkButton
        eventId={event._id}
        interactionContext={interactionContext}
        size="sm"
        redirectTo={`/event/${event.slug}`}
      />
    </div>
  ) : null;

  if (!interactive) {
    return <div className="group block">{rowContent}</div>;
  }

  return (
    <div className="flex gap-3">
      <Link
        to="/event/$slug"
        params={{ slug: event.slug }}
        search={returnToFeed ? { returnToFeed: "1" } : undefined}
        className="group block min-w-0 flex-1 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      >
        {rowContent}
      </Link>
      {bookmarkAction}
    </div>
  );
};

export default EventCard;
