import { clearLocalFollowedTopics } from "./followed-topics";
import { clearGuestReads } from "./guest-activity-queue";
import { clearPendingIntent } from "./pending-intent";
import { clearPushToken } from "./push-token";

/**
 * Wipe every device-local guest store (Ticket 5c — guest "clear my data"):
 * the reading queue, followed topics, the held push token, and any pending
 * sign-in intent. Each clear is independent and best-effort, so one failing
 * store can't block the others.
 *
 * The caller pairs this with a device-id rotation + analytics reset (which need
 * React context + the analytics client), so a cleared guest becomes a brand new
 * anonymous identity with no residual data.
 */
export async function clearLocalGuestData(): Promise<void> {
  // allSettled, not all: a single failing store must not abort the wipe or
  // block the caller's follow-up device rotation + analytics reset.
  await Promise.allSettled([
    clearGuestReads(),
    clearLocalFollowedTopics(),
    clearPushToken(),
    clearPendingIntent(),
  ]);
}
