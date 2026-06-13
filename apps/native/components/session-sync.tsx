import { api } from "@news-app/backend/convex/_generated/api";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useRef } from "react";

import { useAnalytics } from "@/contexts/analytics-context";
import { useDeviceIdentity } from "@/contexts/device-identity-context";
import { useFollowedTopics } from "@/contexts/followed-topics-context";
import { useGuestActivity } from "@/contexts/guest-activity-context";
import {
  clearLocalFollowedTopics,
  loadLocalFollowedTopics,
} from "@/lib/followed-topics";
import { loadGuestReads } from "@/lib/guest-activity-queue";
import { clearPendingIntent, loadPendingIntent } from "@/lib/pending-intent";

/**
 * Watches the auth boundary and runs the guest↔account lifecycle. Renders
 * nothing.
 *
 * On login/signup (guest → authed): stitch analytics identity, merge the local
 * guest queue + followed topics into the account, then consume any pending
 * sign-in gate intent (completing e.g. the tapped bookmark). On logout: reset
 * analytics identity, clear local guest stores, and rotate the device id so no
 * data bleeds into the next guest session.
 */
export function SessionSync() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const currentUser = useQuery(
    api.user.getCurrentUser,
    isAuthenticated ? {} : "skip",
  );
  const mergeGuestActivity = useMutation(api.interactions.mergeGuestActivity);
  const toggleBookmark = useMutation(api.interactions.toggleBookmark);

  const { deviceId, rotateDeviceId } = useDeviceIdentity();
  const { clear: clearGuestActivity } = useGuestActivity();
  const { resetLocal: resetFollowedTopics } = useFollowedTopics();
  const { track, identifyUser, reset: resetAnalytics } = useAnalytics();

  // Latches the login work to once per authenticated session; reset on logout.
  const loginHandledRef = useRef(false);

  const handleLogin = useCallback(
    async (authUserId: string, devId: string) => {
      identifyUser(authUserId);

      const [reads, followedTopics] = await Promise.all([
        loadGuestReads(),
        loadLocalFollowedTopics(),
      ]);

      if (reads.length > 0 || followedTopics.length > 0) {
        try {
          const result = await mergeGuestActivity({
            deviceId: devId,
            reads: reads.map((read) => ({
              eventId: read.eventId as Id<"events">,
              timestamp: read.timestamp,
              timeSpentSeconds: read.timeSpentSeconds,
              scrollDepthPercentage: read.scrollDepthPercentage,
              biasRating: read.biasRating,
              sourceReliability: read.sourceReliability,
            })),
            followedTopicIds: followedTopics as Id<"topics">[],
          });
          if (result.merged) {
            track({
              name: "guest_merge_completed",
              properties: {
                readsReplayed: result.readsReplayed,
                topicsReplayed: result.topicsReplayed,
                streakDays: result.streakDays,
              },
            });
          }
          // Succeeded (merged or already-merged) — account is now the source
          // of truth; drop the local copies.
          await clearGuestActivity();
          await clearLocalFollowedTopics();
        } catch {
          // Network/transient failure — keep the local data so the next app
          // launch retries (the merge is idempotent per device).
        }
      }

      const intent = await loadPendingIntent();
      if (intent) {
        track({ name: "gate_accepted", properties: { reason: intent.gate } });
        track({
          name: "signup_completed",
          properties: { source: intent.gate },
        });
        if (intent.action?.type === "bookmark") {
          try {
            await toggleBookmark({
              eventId: intent.action.eventId as Id<"events">,
            });
          } catch {
            // The bookmark can be retried by hand; never block on it.
          }
        }
        await clearPendingIntent();
      }
    },
    [
      identifyUser,
      mergeGuestActivity,
      track,
      clearGuestActivity,
      toggleBookmark,
    ],
  );

  const handleLogout = useCallback(async () => {
    resetAnalytics();
    await clearGuestActivity();
    resetFollowedTopics();
    await clearPendingIntent();
    await rotateDeviceId();
  }, [resetAnalytics, clearGuestActivity, resetFollowedTopics, rotateDeviceId]);

  useEffect(() => {
    if (isLoading) return;

    if (isAuthenticated) {
      if (currentUser && deviceId && !loginHandledRef.current) {
        loginHandledRef.current = true;
        void handleLogin(currentUser.authUserId, deviceId);
      }
      return;
    }

    // Guest or just logged out. Run cleanup once if we had a live session.
    if (loginHandledRef.current) {
      loginHandledRef.current = false;
      void handleLogout();
    }
  }, [
    isAuthenticated,
    isLoading,
    currentUser,
    deviceId,
    handleLogin,
    handleLogout,
  ]);

  return null;
}
