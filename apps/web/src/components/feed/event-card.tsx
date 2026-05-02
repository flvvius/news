import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import BookmarkButton from "@/components/bookmark-button";
import ShareEventButton from "@/components/share-event-button";
import { formatAbsoluteTimestamp, formatRelativeTimestamp } from "@/lib/dates";
import { buildInteractionContextFromSources } from "@/lib/interaction-tracking";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type EventCardProps = {
  event: {
    _id: Id<"events">;
    slug: string;
    title: string;
    imageUrl?: string;
    perspectiveSummaries?: {
      center?: string;
    };
    globalImpact?: string;
    firstPublishedAt: number;
    lastUpdatedAt?: number;
    topicIds?: Id<"topics">[];
    articleCount?: number;
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
  /** Max source logos to display. Pre-validated by the parent. */
  maxSources?: number;
  variant?: "default" | "feature";
  searchQuery?: string;
  returnToFeed?: boolean;
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

const EventCard = ({
  event,
  topicNamesById,
  maxSources = 5,
  variant = "default",
  searchQuery,
  returnToFeed = false,
}: EventCardProps) => {
  const topics = (event.topicIds ?? [])
    .map((id) => topicNamesById[id])
    .filter(Boolean);
  const primaryTopic = topics[0] ?? "General";
  const summaryPreview =
    event.perspectiveSummaries?.center ??
    event.globalImpact ??
    "Coverage grouped from multiple sources. Open the event to compare articles.";
  const isFeature = variant === "feature";
  const lastUpdatedAt = event.lastUpdatedAt ?? event.firstPublishedAt;
  const lastUpdatedLabel = formatRelativeTimestamp(lastUpdatedAt);
  const lastUpdatedTitle = formatAbsoluteTimestamp(lastUpdatedAt);
  const interactionContext = buildInteractionContextFromSources(
    event.sources ?? [],
  );
  const biasDistribution = (event.sources ?? []).reduce(
    (counts, source) => {
      counts[getBiasBucket(source)]++;
      return counts;
    },
    { left: 0, center: 0, right: 0 } as Record<BiasBucket, number>,
  );
  const distributionTotal = Math.max(1, event.sources?.length ?? 0);

  return (
    <Link
      to="/event/$slug"
      params={{ slug: event.slug }}
      search={returnToFeed ? { returnToFeed: "1" } : undefined}
      className="group block"
    >
      <Card
        className={cn(
          "overflow-hidden border-border/80 bg-card/95 py-0 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg",
          isFeature ? "rounded-[1.4rem]" : "rounded-[1.2rem]",
        )}
      >
        <div
          className={cn(
            "relative overflow-hidden bg-muted/40",
            isFeature
              ? "aspect-[16/10] sm:aspect-[16/10]"
              : "aspect-[16/10] lg:aspect-[16/10]",
          )}
        >
          <div className="absolute left-4 top-4 z-10 flex flex-wrap items-center gap-2">
            {(topics.length > 0 ? topics : ["General"])
              .slice(0, isFeature ? 3 : 2)
              .map((topic) => (
                <span
                  key={topic}
                  className="inline-flex h-7 items-center rounded-full border border-white/20 bg-black/45 px-3 text-xs font-medium text-white shadow-sm backdrop-blur-md"
                >
                  {topic}
                </span>
              ))}
          </div>
          {event.imageUrl ? (
            <img
              src={event.imageUrl}
              alt={event.title}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-linear-to-br from-muted to-background">
              <span className="rounded-full border border-border/80 bg-background/85 px-3 py-1 text-xs font-medium text-muted-foreground">
                {primaryTopic}
              </span>
            </div>
          )}
        </div>
        <CardContent
          className={cn(
            "space-y-4 px-5 pb-6 pt-0 sm:px-6",
            isFeature && "px-5 pb-7 pt-1 sm:px-8",
          )}
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <p
                className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground -mt-1"
                title={lastUpdatedTitle}
              >
                Updated {lastUpdatedLabel}
              </p>
              <div className="flex items-center gap-2 -mt-1">
                <ShareEventButton
                  eventId={event._id}
                  interactionContext={interactionContext}
                  slug={event.slug}
                  title={event.title}
                  summary={summaryPreview}
                  size="sm"
                  className="rounded-full border border-border/80 bg-background/80"
                />
                <BookmarkButton
                  eventId={event._id}
                  interactionContext={interactionContext}
                  size="sm"
                  redirectTo={`/event/${event.slug}`}
                  className="rounded-full border border-border/80 bg-background/80"
                />
              </div>
            </div>
            <CardTitle
              className={cn(
                "leading-tight tracking-tight text-card-foreground",
                isFeature ? "text-2xl sm:text-3xl" : "text-xl sm:text-2xl",
              )}
            >
              {highlightTitle(event.title, searchQuery)}
            </CardTitle>
          </div>

          <p
            className={cn(
              "text-muted-foreground",
              isFeature ? "text-base" : "text-sm line-clamp-3",
            )}
          >
            {summaryPreview}
          </p>

          <div className="border-t border-border/70 pt-4">
            <div className="flex flex-col gap-3">
              <div className="flex min-w-0 items-center gap-3">
                {event.sources && event.sources.length > 0 && (
                  <div className="flex -space-x-3">
                    {event.sources.slice(0, maxSources).map((source) => (
                      <div
                        key={source._id}
                        className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border-2 border-background bg-background shadow-sm"
                        title={source.name}
                      >
                        {source.logoUrl ? (
                          <img
                            src={source.logoUrl}
                            alt={source.name}
                            className="h-full w-full object-contain p-1.5"
                          />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-xs font-medium text-foreground">
                            {source.name.charAt(0)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-card-foreground">
                    {event.sources?.length ?? 0} sources
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {event.articleCount !== undefined
                      ? `${event.articleCount} ${event.articleCount === 1 ? "article" : "articles"}`
                      : "Follow the event"}
                  </p>
                </div>
              </div>

              {(event.sources?.length ?? 0) > 0 && (
                <div className="space-y-1.5">
                  <div
                    className="flex h-1.5 overflow-hidden rounded-full bg-bias-track"
                    aria-label={`Source bias distribution: ${biasDistribution.left} left, ${biasDistribution.center} center, ${biasDistribution.right} right`}
                    role="img"
                  >
                    {(["left", "center", "right"] as BiasBucket[]).map(
                      (bucket) => {
                        const count = biasDistribution[bucket];
                        if (count === 0) return null;
                        return (
                          <div
                            key={bucket}
                            className={biasBucketClass(bucket)}
                            style={{
                              width: `${(count / distributionTotal) * 100}%`,
                            }}
                          />
                        );
                      },
                    )}
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{biasDistribution.left} left</span>
                    <span>{biasDistribution.center} center</span>
                    <span>{biasDistribution.right} right</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
};

export default EventCard;
