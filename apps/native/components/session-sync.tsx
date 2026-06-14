import { api } from "@news-app/backend/convex/_generated/api";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { useConvex, useConvexAuth, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useRef } from "react";

import { useAnalytics } from "@/contexts/analytics-context";
import { useDeviceIdentity } from "@/contexts/device-identity-context";
import { useFollowedTopics } from "@/contexts/followed-topics-context";
import { useGuestActivity } from "@/contexts/guest-activity-context";
import {
  clearLocalFollowedTopics,
  loadLocalFollowedTopics,
} from "@/lib/followed-topics";
import {
  clearGuestReadsIfMerged,
  loadGuestReads,
} from "@/lib/guest-activity-queue";
import { clearPendingIntent, loadPendingIntent } from "@/lib/pending-intent";
import { clearPushToken, loadPushToken } from "@/lib/push-token";
import { Platform } from "react-native";

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
  const registerPushToken = useMutation(api.notifications.registerPushToken);

  const convex = useConvex();
  const { deviceId, rotateDeviceId } = useDeviceIdentity();
  const { clear: clearGuestActivity, guestStreak } = useGuestActivity();
  const { resetLocal: resetFollowedTopics } = useFollowedTopics();
  const { track, identifyUser } = useAnalytics();

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
            // Ticket 7: the merged streak must never drop below the teaser.
            guestStreak: guestStreak.currentStreak,
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

      // A guest who granted notifications before signing in has a token held
      // locally; register it now that there's an account to attach it to.
      const pushToken = await loadPushToken();
      if (pushToken) {
        try {
          await registerPushToken({
            token: pushToken,
            platform:
              Platform.OS === "ios"
                ? "ios"
                : Platform.OS === "android"
                  ? "android"
                  : undefined,
          });
        } catch {
          // Best-effort; the primer will re-register on a later grant.
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
      registerPushToken,
      guestStreak,
    ],
  );

  const handleLogout = useCallback(
    async (devId: string | null) => {
      // Ticket 3: only drop the local guest stores once the server ledger
      // confirms this device's queue merged into an account. On any uncertainty
      // (no device id yet, or the check fails / is offline) treat it as
      // unmerged and RETAIN — the next login replays the queue (the merge is
      // idempotent per device). Deleting an unmerged queue is silent
      // guest-history loss.
      let merged = false;
      if (devId) {
        try {
          merged = await convex.query(api.interactions.hasDeviceMerged, {
            deviceId: devId,
          });
        } catch {
          merged = false;
        }
      }
      const cleared = await clearGuestReadsIfMerged(merged);
      if (cleared) {
        // Queue confirmed-merged and dropped — also drop the followed-topics
        // store so a post-logout guest session starts clean. (The guest-activity
        // React state is already empty here: handleLogin resets it on a
        // confirmed merge, so there is nothing stale to clear.)
        resetFollowedTopics();
      }

      await clearPendingIntent();
      // Drop the local push token so it isn't reused by the next guest; the
      // server row is reassigned on the next account's registration.
      await clearPushToken();
      // rotateDeviceId owns the analytics reset + new device_uuid (Ticket 10).
      await rotateDeviceId();
    },
    [resetFollowedTopics, rotateDeviceId, convex],
  );

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
    // Pass the current (pre-rotation) device id so the ledger check targets the
    // session that owned the queue.
    if (loginHandledRef.current) {
      loginHandledRef.current = false;
      void handleLogout(deviceId);
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
