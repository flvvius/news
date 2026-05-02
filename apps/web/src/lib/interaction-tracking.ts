export function getClientDeviceType(): "mobile" | "tablet" | "desktop" {
  if (typeof window === "undefined") {
    return "desktop";
  }

  const width = window.innerWidth;
  if (width < 768) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
}

export function getScrollDepthPercentage(): number {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return 0;
  }

  const doc = document.documentElement;
  const scrollableHeight = doc.scrollHeight - window.innerHeight;
  if (scrollableHeight <= 0) return 1;

  return Math.max(0, Math.min(1, window.scrollY / scrollableHeight));
}
