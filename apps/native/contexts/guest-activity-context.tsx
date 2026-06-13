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
  appendGuestRead,
  clearGuestReads,
  computeGuestStreak,
  loadGuestReads,
  type GuestRead,
  type GuestStreak,
} from "@/lib/guest-activity-queue";

type GuestActivityContextType = {
  /** Guest reading streak derived from the local queue (qualified reads). */
  guestStreak: GuestStreak;
  /** Append a guest read to the local queue. Callers gate this on "is guest". */
  recordRead: (read: GuestRead) => Promise<void>;
  /** Drop all queued guest reads (after a merge, or on logout). */
  clear: () => Promise<void>;
};

const GuestActivityContext = createContext<
  GuestActivityContextType | undefined
>(undefined);

export function GuestActivityProvider({ children }: { children: ReactNode }) {
  const [reads, setReads] = useState<GuestRead[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadGuestReads()
      .then((loaded) => {
        if (!cancelled) setReads(loaded);
      })
      .catch(() => {
        // An unreadable queue simply means "no guest history yet".
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const recordRead = useCallback(async (read: GuestRead) => {
    const updated = await appendGuestRead(read);
    setReads(updated);
  }, []);

  const clear = useCallback(async () => {
    await clearGuestReads();
    setReads([]);
  }, []);

  // Recomputed when the queue changes. `Date.now()` at compute time decides
  // whether the run is still live; good enough for the streak teaser.
  const guestStreak = useMemo(
    () => computeGuestStreak(reads, Date.now()),
    [reads],
  );

  const value = useMemo<GuestActivityContextType>(
    () => ({ guestStreak, recordRead, clear }),
    [guestStreak, recordRead, clear],
  );

  return (
    <GuestActivityContext.Provider value={value}>
      {children}
    </GuestActivityContext.Provider>
  );
}

export function useGuestActivity(): GuestActivityContextType {
  const context = useContext(GuestActivityContext);
  if (!context) {
    throw new Error(
      "useGuestActivity must be used within GuestActivityProvider",
    );
  }
  return context;
}
