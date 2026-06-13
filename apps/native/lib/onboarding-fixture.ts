import type { Id } from "@news-app/backend/convex/_generated/dataModel";

import type { EventRowEvent } from "@/components/event-row";

/**
 * Bundled story for Screen A (the promise). It renders through the real
 * `EventRow` so the onboarding card is the genuine article, but the data is
 * local — no network call may block Screen A. The point is the multi-perspective
 * bias breakdown, so it carries a spread of left/center/right sources.
 *
 * The card is display-only on Screen A (wrapped in `pointerEvents="none"`), so
 * the synthetic slug is never navigated to.
 */
const FIXTURE_TOPIC_ID = "onboarding-fixture-topic" as Id<"topics">;
const FIXTURE_EVENT_ID = "onboarding-fixture-event" as Id<"events">;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export function buildOnboardingFixtureEvent(
  title: string,
  summary: string,
  kicker: string,
): { event: EventRowEvent; topicNamesById: Record<string, string> } {
  const event: EventRowEvent = {
    _id: FIXTURE_EVENT_ID,
    slug: "onboarding-fixture",
    title,
    perspectiveSummaries: { center: summary },
    firstPublishedAt: Date.now() - TWO_HOURS_MS,
    topicIds: [FIXTURE_TOPIC_ID],
    sourceCount: 12,
    // A deliberate spread so the distribution bar shows all three buckets.
    sourceBiasCounts: { left: 4, center: 3, right: 5 },
  };

  // The row's kicker reads from this map; supply the "Top story" label.
  return { event, topicNamesById: { [FIXTURE_TOPIC_ID]: kicker } };
}
