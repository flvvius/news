import { api } from "@news-app/backend/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

export type EventDetail = NonNullable<
  FunctionReturnType<typeof api.events.getEventBySlug>
>;

export type EventArticle = EventDetail["articles"][number];

export type EventSource = NonNullable<EventArticle["source"]>;

// getEventClaims returns null when claim analysis is feature-flagged off
// (BIV-602), so unwrap before indexing.
export type EventClaim = NonNullable<
  FunctionReturnType<typeof api.claimDivergence.getEventClaims>
>[number];

export type ClaimStatus = EventClaim["status"];

export type ClaimVariant = EventClaim["variants"][number];

/** Unique sources across an event's articles, first occurrence wins. */
export function uniqueEventSources(articles: EventArticle[]): EventSource[] {
  return Array.from(
    new Map(
      articles
        .map((article) => article.source)
        .filter((source): source is EventSource => Boolean(source))
        .map((source) => [source._id, source]),
    ).values(),
  );
}
