import { useEffect, useRef, useState } from "react";

type ScrollListener = (scrollY: number) => void;

const listeners = new Set<ScrollListener>();
let frameId = 0;

function emitScrollPosition() {
  frameId = 0;
  const scrollY = window.scrollY || window.pageYOffset || 0;

  listeners.forEach((listener) => {
    listener(scrollY);
  });
}

function scheduleEmit() {
  if (frameId !== 0) {
    return;
  }

  frameId = window.requestAnimationFrame(emitScrollPosition);
}

function subscribeToScroll(listener: ScrollListener) {
  listeners.add(listener);

  if (listeners.size === 1) {
    window.addEventListener("scroll", scheduleEmit, { passive: true });
    window.addEventListener("resize", scheduleEmit, { passive: true });
  }

  listener(window.scrollY || window.pageYOffset || 0);

  return () => {
    listeners.delete(listener);

    if (listeners.size === 0) {
      window.removeEventListener("scroll", scheduleEmit);
      window.removeEventListener("resize", scheduleEmit);

      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
        frameId = 0;
      }
    }
  };
}

export function useScrollVisibility({
  deltaThreshold = 12,
  topOffset = 24,
}: {
  deltaThreshold?: number;
  topOffset?: number;
} = {}) {
  const [isVisible, setIsVisible] = useState(true);
  const isVisibleRef = useRef(true);
  const lastScrollYRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    return subscribeToScroll((currentScrollY) => {
      const previousScrollY = lastScrollYRef.current;
      const delta = currentScrollY - previousScrollY;

      if (Math.abs(delta) < deltaThreshold) {
        return;
      }

      const nextVisible =
        currentScrollY <= topOffset ? true : delta < 0;

      lastScrollYRef.current = currentScrollY;

      if (isVisibleRef.current === nextVisible) {
        return;
      }

      isVisibleRef.current = nextVisible;
      setIsVisible(nextVisible);
    });
  }, [deltaThreshold, topOffset]);

  return isVisible;
}
