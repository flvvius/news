import { api } from "@news-app/backend/convex/_generated/api";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useConvexAuth, useMutation } from "convex/react";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { Platform, Text } from "react-native";

import { PressableScale } from "@/components/ui/pressable-scale";
import { Sheet } from "@/components/ui/sheet";
import { useAnalytics } from "@/contexts/analytics-context";
import { useT } from "@/contexts/locale-context";
import {
  canShowPrimer,
  loadPrimerState,
  savePrimerState,
  type PrimerState,
} from "@/lib/notification-primer";
import { reportError } from "@/lib/error-monitoring";
import { savePushToken } from "@/lib/push-token";

type NotificationPrimerContextType = {
  /**
   * Show the pre-permission primer if eligible (first qualified read / first
   * save, within the re-ask budget, OS still askable). Safe to call eagerly —
   * it self-gates and is a no-op when not eligible.
   */
  maybeShowPrimer: () => void;
};

const NotificationPrimerContext = createContext<
  NotificationPrimerContextType | undefined
>(undefined);

// Ticket 21: show notifications while the app is foregrounded (banner + sound),
// otherwise a delivered push is invisible to an active user. Set once at module
// load.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function resolvePlatform(): "ios" | "android" | undefined {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  return undefined;
}

function notificationsEnabled(): boolean {
  const value = process.env.EXPO_PUBLIC_NOTIFICATIONS_ENABLED;
  return ["1", "true", "yes", "on"].includes(
    value?.trim().toLowerCase() ?? "",
  );
}

function getEasProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra;
  if (typeof extra !== "object" || extra === null) return undefined;
  const eas = (extra as Record<string, unknown>).eas;
  if (typeof eas !== "object" || eas === null) return undefined;
  const projectId = (eas as Record<string, unknown>).projectId;
  return typeof projectId === "string" ? projectId : undefined;
}

export function NotificationPrimerProvider({
  children,
}: {
  children: ReactNode;
}) {
  const t = useT();
  const { isAuthenticated } = useConvexAuth();
  const { track } = useAnalytics();
  const registerPushToken = useMutation(api.notifications.registerPushToken);

  const sheetRef = useRef<BottomSheetModal>(null);
  // Once shown this session, don't re-present until the app restarts.
  const presentedThisSessionRef = useRef(false);

  const markResolved = useCallback(async (state: PrimerState) => {
    await savePrimerState({ ...state, resolved: true });
  }, []);

  const registerForPush = useCallback(async () => {
    try {
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("default", {
          name: "Default",
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }
      const projectId = getEasProjectId();
      const tokenResponse = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined,
      );
      const token = tokenResponse.data;
      await savePushToken(token);
      // Register now if signed in; otherwise session-sync registers on login.
      if (isAuthenticated) {
        await registerPushToken({ token, platform: resolvePlatform() });
      }
    } catch (error) {
      reportError(error, { scope: "notification-primer.registerForPush" });
      // Token fetch requires a dev/EAS build with a projectId — skip cleanly
      // (we still recorded the permission result).
    }
  }, [isAuthenticated, registerPushToken]);

  const maybeShowPrimer = useCallback(() => {
    void (async () => {
      // Ticket 6: the primer promises a "morning briefing" — it must stay
      // dormant until the briefing cron (T19) can actually send, and it must
      // never burn the one-shot iOS grant for a guest who can't be messaged.
      // Flip EXPO_PUBLIC_NOTIFICATIONS_ENABLED on once the cron delivers.
      if (!notificationsEnabled()) return;
      if (!isAuthenticated) return;

      if (presentedThisSessionRef.current) return;

      // If the OS already has an answer (or can't be asked again), there's
      // nothing the primer can do — mark resolved and never show it.
      const permission = await Notifications.getPermissionsAsync();
      if (permission.granted) {
        await registerForPush();
        const state = await loadPrimerState();
        await markResolved(state);
        return;
      }
      if (!permission.canAskAgain) {
        const state = await loadPrimerState();
        await markResolved(state);
        return;
      }

      const state = await loadPrimerState();
      if (!canShowPrimer(state, Date.now())) return;

      presentedThisSessionRef.current = true;
      await savePrimerState({
        ...state,
        shownCount: state.shownCount + 1,
        lastShownAt: Date.now(),
      });
      track({ name: "primer_shown" });
      sheetRef.current?.present();
    })();
  }, [markResolved, track, isAuthenticated, registerForPush]);

  const dismiss = () => sheetRef.current?.dismiss();

  const handleAccept = () => {
    void (async () => {
      track({ name: "primer_accepted" });
      dismiss();
      const result = await Notifications.requestPermissionsAsync();
      track({
        name: "os_push_prompt_result",
        properties: { granted: result.granted },
      });
      // The OS has now answered — never prompt via the primer again.
      const state = await loadPrimerState();
      await markResolved(state);
      if (result.granted) {
        await registerForPush();
      }
    })();
  };

  const value = useMemo<NotificationPrimerContextType>(
    () => ({ maybeShowPrimer }),
    [maybeShowPrimer],
  );

  return (
    <NotificationPrimerContext.Provider value={value}>
      {children}
      <Sheet ref={sheetRef}>
        <Text className="text-lg font-semibold tracking-tight text-card-foreground">
          {t("primer.title")}
        </Text>
        <Text className="max-w-[455px] text-base leading-relaxed text-muted-foreground">
          {t("primer.body")}
        </Text>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t("primer.accept")}
          onPress={handleAccept}
          className="mt-2"
          contentClassName="min-h-12 items-center justify-center rounded-lg bg-primary"
        >
          <Text className="text-base font-medium text-primary-foreground">
            {t("primer.accept")}
          </Text>
        </PressableScale>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t("primer.decline")}
          onPress={dismiss}
          contentClassName="min-h-12 items-center justify-center rounded-lg"
        >
          <Text className="text-base font-medium text-muted-foreground">
            {t("primer.decline")}
          </Text>
        </PressableScale>
      </Sheet>
    </NotificationPrimerContext.Provider>
  );
}

export function useNotificationPrimer(): NotificationPrimerContextType {
  const context = useContext(NotificationPrimerContext);
  if (!context) {
    throw new Error(
      "useNotificationPrimer must be used within NotificationPrimerProvider",
    );
  }
  return context;
}
