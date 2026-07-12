import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/LocaleContext";
import { captureEvent } from "@/lib/posthog";

// Versioned so a future re-onboarding can bump the suffix without colliding
// with devices that dismissed the previous version.
const ONBOARDING_KEY = "miez-onboarding-v1";

type DismissReason = "cta" | "skip" | "backdrop" | "escape";

/**
 * MIEZ-8 — the Miez first-run screen. A single, dismissible, account-free
 * screen shown exactly once per device (localStorage): the three-beat pitch
 * over the sliced-disc motif, with a CTA into the feed. Renders nothing on the
 * server and until it has confirmed the device has not seen it, so there is no
 * flash for returning visitors.
 */
export function MiezOnboarding() {
  const t = useT();
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const ctaRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(ONBOARDING_KEY) !== "1") {
        setVisible(true);
      }
    } catch {
      // Storage blocked (private mode): skip onboarding rather than show it on
      // every load, which would be worse than not showing it at all.
    }
  }, []);

  useEffect(() => {
    if (visible) ctaRef.current?.focus();
  }, [visible]);

  if (!visible) return null;

  const dismiss = (reason: DismissReason) => {
    try {
      window.localStorage.setItem(ONBOARDING_KEY, "1");
    } catch {
      // ignore — worst case it shows again next load.
    }
    captureEvent("onboarding_dismiss", { reason });
    setVisible(false);
  };

  const beats = [
    t("onboarding.miez.beat1"),
    t("onboarding.miez.beat2"),
    t("onboarding.miez.beat3"),
  ];

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Miez"
      onClick={(event) => {
        if (event.target === event.currentTarget) dismiss("backdrop");
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          dismiss("escape");
          return;
        }
        // Trap focus inside the modal so Tab / Shift+Tab cannot reach the page
        // behind it (aria-modal alone doesn't enforce this in every browser).
        if (event.key === "Tab") {
          const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          );
          if (!focusable || focusable.length === 0) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }}
    >
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-lg sm:p-8">
        <button
          type="button"
          onClick={() => dismiss("skip")}
          className="absolute right-3 top-3 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-label={t("onboarding.miez.close")}
        >
          {t("onboarding.miez.skip")}
        </button>

        <div className="flex flex-col items-center gap-6 text-center">
          <SlicedDisc />

          <ol className="flex w-full flex-col gap-3 text-left">
            {beats.map((beat, index) => (
              <li key={beat} className="flex items-start gap-3">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                  {index + 1}
                </span>
                <span className="text-base font-medium text-foreground">
                  {beat}
                </span>
              </li>
            ))}
          </ol>

          <Button
            ref={ctaRef}
            className="w-full"
            onClick={() => {
              dismiss("cta");
              void navigate({ to: "/" });
            }}
          >
            {t("onboarding.miez.cta")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The sliced-disc motif: one disc split into the two camps (camp-a / camp-b)
 * with the neutral core (ring + dot) at the centre — the same mark as the
 * wordmark's "e", enlarged.
 */
function SlicedDisc() {
  return (
    <svg
      viewBox="0 0 120 120"
      className="size-24"
      role="img"
      aria-hidden="true"
    >
      <path d="M60 12 A48 48 0 0 0 60 108 Z" className="fill-camp-a" />
      <path d="M60 12 A48 48 0 0 1 60 108 Z" className="fill-camp-b" />
      {/* Core cut-out + ring + dot, in the page background so it reads on the
          split disc. */}
      <circle cx="60" cy="60" r="17" className="fill-background" />
      <circle
        cx="60"
        cy="60"
        r="17"
        fill="none"
        strokeWidth="5"
        className="stroke-core"
      />
      <circle cx="60" cy="60" r="6" className="fill-core" />
    </svg>
  );
}
