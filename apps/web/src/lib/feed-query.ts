import type { Id } from "@news-app/backend/convex/_generated/dataModel";

export type FeedSort = "recent" | "trending";
export type FeedTopicSelection = "all" | Id<"topics">;

// BIV-801 regression guard: the feed tab state must reach the Convex query —
// a dropped `sort` arg silently collapses Trending into the default ordering.
export function buildFeedQueryArgs(
  selectedTopic: FeedTopicSelection,
  feedSort: FeedSort,
) {
  return selectedTopic === "all"
    ? { sort: feedSort }
    : { topicId: selectedTopic, sort: feedSort };
}
