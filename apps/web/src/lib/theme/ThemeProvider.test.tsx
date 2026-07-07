import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { THEME_STORAGE_KEY, type ThemePreference } from "@/lib/theme";
import { ThemeProvider, useTheme } from "@/lib/theme/ThemeProvider";

function installMatchMedia(initialDark: boolean) {
  let matches = initialDark;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: (_event: "change", listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
      removeEventListener: (
        _event: "change",
        listener: (event: MediaQueryListEvent) => void,
      ) => {
        listeners.delete(listener);
      },
      addListener: (listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
      removeListener: (listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
      dispatchEvent: () => true,
    })),
  });

  return {
    setDark(nextDark: boolean) {
      matches = nextDark;
      listeners.forEach((listener) =>
        listener({ matches } as MediaQueryListEvent),
      );
    },
  };
}

function ThemeProbe() {
  const { preference, resolvedTheme, setPreference } = useTheme();

  return (
    <div>
      <p data-testid="theme-state">
        {preference}:{resolvedTheme}
      </p>
      {(["system", "light", "dark"] satisfies ThemePreference[]).map(
        (option) => (
          <button
            key={option}
            type="button"
            onClick={() => setPreference(option)}
          >
            {option}
          </button>
        ),
      )}
    </div>
  );
}

function renderProvider() {
  return render(
    <ThemeProvider>
      <ThemeProbe />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("style");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ThemeProvider", () => {
  test("server render uses browser-stable defaults", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");

    const markup = renderToString(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    expect(markup).toContain("system");
    expect(markup).toContain("light");
    expect(markup).not.toContain("dark</p>");
  });

  test("uses prefers-color-scheme when no preference is stored", () => {
    installMatchMedia(true);
    renderProvider();

    expect(screen.getByTestId("theme-state").textContent).toBe("system:dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  test("persists explicit choices and keeps them across system changes", () => {
    const media = installMatchMedia(true);
    renderProvider();

    fireEvent.click(screen.getByRole("button", { name: "light" }));
    expect(screen.getByTestId("theme-state").textContent).toBe("light:light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    act(() => media.setDark(false));
    expect(screen.getByTestId("theme-state").textContent).toBe("light:light");
  });

  test("system preference updates live and clears the stored override", () => {
    const media = installMatchMedia(false);
    renderProvider();

    fireEvent.click(screen.getByRole("button", { name: "dark" }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    fireEvent.click(screen.getByRole("button", { name: "system" }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(screen.getByTestId("theme-state").textContent).toBe("system:light");

    act(() => media.setDark(true));
    expect(screen.getByTestId("theme-state").textContent).toBe("system:dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
