import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useAnalytics } from "@/contexts/analytics-context";
import {
  hasCompletedOnboarding,
  loadOrCreateDeviceId,
  markOnboardingComplete,
  rotateDeviceId as rotateStoredDeviceId,
} from "@/lib/device-identity";

type DeviceIdentityContextType = {
  /** Stable anonymous device id; null until SecureStore has been read. */
  deviceId: string | null;
  /**
   * True once the device id and onboarding flag have loaded. Routing waits on
   * this before deciding whether to show onboarding, so a fresh install never
   * flashes the feed before Screen A.
   */
  isReady: boolean;
  /** Whether onboarding for the current version has been completed. */
  hasOnboarded: boolean;
  /** Persist onboarding completion for the current version. */
  completeOnboarding: () => void;
  /**
   * Mint a fresh device id (logout) so no guest data bleeds across accounts,
   * and re-register it with analytics. Resolves with the new id.
   */
  rotateDeviceId: () => Promise<string>;
};

const DeviceIdentityContext = createContext<
  DeviceIdentityContextType | undefined
>(undefined);

export function DeviceIdentityProvider({ children }: { children: ReactNode }) {
  const { registerDeviceId } = useAnalytics();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [hasOnboarded, setHasOnboarded] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadOrCreateDeviceId(), hasCompletedOnboarding()])
      .then(([id, onboarded]) => {
        if (cancelled) return;
        setDeviceId(id);
        setHasOnboarded(onboarded);
        setIsReady(true);
        // Anonymous, pre-signup events now carry the device uuid.
        registerDeviceId(id);
      })
      .catch(() => {
        // Never block the app on identity load — proceed as a fresh guest.
        if (!cancelled) setIsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [registerDeviceId]);

  const completeOnboarding = useCallback(() => {
    setHasOnboarded(true);
    markOnboardingComplete().catch(() => {
      // Persistence is best-effort; the in-session flag still suppresses re-show.
    });
  }, []);

  const rotateDeviceId = useCallback(async () => {
    const id = await rotateStoredDeviceId();
    setDeviceId(id);
    registerDeviceId(id);
    return id;
  }, [registerDeviceId]);

  const value = useMemo<DeviceIdentityContextType>(
    () => ({
      deviceId,
      isReady,
      hasOnboarded,
      completeOnboarding,
      rotateDeviceId,
    }),
    [deviceId, isReady, hasOnboarded, completeOnboarding, rotateDeviceId],
  );

  return (
    <DeviceIdentityContext.Provider value={value}>
      {children}
    </DeviceIdentityContext.Provider>
  );
}

export function useDeviceIdentity(): DeviceIdentityContextType {
  const context = useContext(DeviceIdentityContext);
  if (!context) {
    throw new Error(
      "useDeviceIdentity must be used within DeviceIdentityProvider",
    );
  }
  return context;
}
