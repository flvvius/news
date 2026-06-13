import { api } from "@news-app/backend/convex/_generated/api";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  clearLocalFollowedTopics,
  loadLocalFollowedTopics,
  saveLocalFollowedTopics,
} from "@/lib/followed-topics";

type FollowedTopicsContextType = {
  /** Effective followed topics: the account's when signed in, else local. */
  followedTopicIds: Id<"topics">[];
  /** True once both the local store and (if signed in) the account have loaded. */
  isReady: boolean;
  /** Persist a new selection locally and, when signed in, to the account. */
  setFollowedTopics: (topicIds: Id<"topics">[]) => void;
  /** Clear the local selection and in-memory state (logout — no data bleed). */
  resetLocal: () => void;
};

const FollowedTopicsContext = createContext<
  FollowedTopicsContextType | undefined
>(undefined);

export function FollowedTopicsProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  const currentUser = useQuery(
    api.user.getCurrentUser,
    isAuthenticated ? {} : "skip",
  );
  const setFollowedTopicsMutation = useMutation(api.user.setFollowedTopics);

  const [localTopicIds, setLocalTopicIds] = useState<Id<"topics">[]>([]);
  const [localLoaded, setLocalLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadLocalFollowedTopics()
      .then((ids) => {
        if (!cancelled) {
          setLocalTopicIds(ids as Id<"topics">[]);
          setLocalLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLocalLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const accountTopicIds = currentUser?.followedTopicIds as
    | Id<"topics">[]
    | undefined;

  // The account selection wins once it exists. A signed-in user with an empty
  // account selection (e.g. the gap right after signup, before the step-7
  // merge folds the guest value in) falls back to the local selection.
  const followedTopicIds = useMemo(
    () =>
      isAuthenticated && accountTopicIds && accountTopicIds.length > 0
        ? accountTopicIds
        : localTopicIds,
    [isAuthenticated, accountTopicIds, localTopicIds],
  );

  const isReady =
    localLoaded && (!isAuthenticated || currentUser !== undefined);

  const setFollowedTopics = useCallback(
    (topicIds: Id<"topics">[]) => {
      setLocalTopicIds(topicIds);
      saveLocalFollowedTopics(topicIds).catch(() => {
        // Best-effort; the in-session value still drives the feed boost.
      });
      if (isAuthenticated) {
        setFollowedTopicsMutation({ topicIds }).catch(() => {
          // Account sync is best-effort; the local value still applies.
        });
      }
    },
    [isAuthenticated, setFollowedTopicsMutation],
  );

  const resetLocal = useCallback(() => {
    setLocalTopicIds([]);
    clearLocalFollowedTopics().catch(() => {
      // Best-effort.
    });
  }, []);

  const value = useMemo<FollowedTopicsContextType>(
    () => ({ followedTopicIds, isReady, setFollowedTopics, resetLocal }),
    [followedTopicIds, isReady, setFollowedTopics, resetLocal],
  );

  return (
    <FollowedTopicsContext.Provider value={value}>
      {children}
    </FollowedTopicsContext.Provider>
  );
}

export function useFollowedTopics(): FollowedTopicsContextType {
  const context = useContext(FollowedTopicsContext);
  if (!context) {
    throw new Error(
      "useFollowedTopics must be used within FollowedTopicsProvider",
    );
  }
  return context;
}
