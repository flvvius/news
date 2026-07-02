import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import * as SecureStore from "expo-secure-store";

import { reportError } from "@/lib/error-monitoring";

/**
 * Guest-local followed-topic selection (onboarding topic picker). Persisted
 * as a JSON array of topic id strings under the `biviant.*` convention. The
 * authenticated source of truth is `users.followedTopicIds` in Convex; this
 * local copy seeds the feed boost before signup and migrates at merge.
 */
const FOLLOWED_TOPICS_KEY = "biviant.followed-topics";

function isTopicId(value: unknown): value is Id<"topics"> {
  return typeof value === "string";
}

export async function loadLocalFollowedTopics(): Promise<Id<"topics">[]> {
  try {
    const raw = await SecureStore.getItemAsync(FOLLOWED_TOPICS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTopicId);
  } catch (error) {
    reportError(error, { scope: "followed-topics.load" });
    // Unreadable/corrupt store — treat as no selection.
    return [];
  }
}

export async function saveLocalFollowedTopics(
  topicIds: Id<"topics">[],
): Promise<void> {
  try {
    await SecureStore.setItemAsync(
      FOLLOWED_TOPICS_KEY,
      JSON.stringify(topicIds),
    );
  } catch (error) {
    reportError(error, { scope: "followed-topics.save" });
    // Persistence is best-effort; the in-session selection still applies.
  }
}

/** Drop the local selection (after merge into an account, or on logout). */
export async function clearLocalFollowedTopics(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(FOLLOWED_TOPICS_KEY);
  } catch (error) {
    reportError(error, { scope: "followed-topics.clear" });
    // Best-effort.
  }
}
