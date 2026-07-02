// BIV-801 regression: the feed's tab state (recent/trending) must be passed
// through to the Convex query args for every topic selection.
import { describe, expect, test } from "vitest";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";

import { buildFeedQueryArgs } from "./feed-query";

describe("buildFeedQueryArgs (BIV-801)", () => {
  test("passes the sort through for the all-topics feed", () => {
    expect(buildFeedQueryArgs("all", "trending")).toEqual({
      sort: "trending",
    });
    expect(buildFeedQueryArgs("all", "recent")).toEqual({ sort: "recent" });
  });

  test("passes both topic and sort for a topic feed", () => {
    const topicId = "topic123" as Id<"topics">;
    expect(buildFeedQueryArgs(topicId, "recent")).toEqual({
      topicId,
      sort: "recent",
    });
    expect(buildFeedQueryArgs(topicId, "trending")).toEqual({
      topicId,
      sort: "trending",
    });
  });
});
