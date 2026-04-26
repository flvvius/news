import { toast } from "sonner";

const BETA_WELCOME_KEY = "biviant-beta-welcome-pending";

export function markBetaWelcomePending() {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(BETA_WELCOME_KEY, "1");
}

export function consumeBetaWelcomeToast() {
  if (typeof window === "undefined") return;
  const pending = window.sessionStorage.getItem(BETA_WELCOME_KEY);
  if (!pending) return;
  window.sessionStorage.removeItem(BETA_WELCOME_KEY);
  toast.success("Congrats, you now have early access to Biviant.");
}
