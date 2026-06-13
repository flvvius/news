import * as SecureStore from "expo-secure-store";

/**
 * Guest-local followed-topic selection (onboarding topic picker). Persisted
 * as a JSON array of topic id strings under the `biviant.*` convention. The
 * authenticated source of truth is `users.followedTopicIds` in Convex; this
 * local copy seeds the feed boost before signup and migrates at merge.
 */
const FOLLOWED_TOPICS_KEY = "biviant.followed-topics";

export async function loadLocalFollowedTopics(): Promise<string[]> {
  try {
    const raw = await SecureStore.getItemAsync(FOLLOWED_TOPICS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    // Unreadable/corrupt store — treat as no selection.
    return [];
  }
}

export async function saveLocalFollowedTopics(
  topicIds: string[],
): Promise<void> {
  try {
    await SecureStore.setItemAsync(
      FOLLOWED_TOPICS_KEY,
      JSON.stringify(topicIds),
    );
  } catch {
    // Persistence is best-effort; the in-session selection still applies.
  }
}
