// BIV-807: design-system enforcement.
// 1. No hardcoded Tailwind color utilities anywhere in the web app source —
//    semantic tokens only (DESIGN_SYSTEM.md "Color System").
// 2. Every color token defined for light mode has a dark-mode counterpart,
//    so dark mode works purely via .dark tokens with no conditional logic.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, test } from "vitest";

const SRC_DIR = resolve(process.cwd(), "src");

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSourceFiles(full));
      continue;
    }
    if (!/\.(tsx|ts|css)$/.test(entry)) continue;
    if (/\.test\.(tsx|ts)$/.test(entry)) continue;
    if (entry === "routeTree.gen.ts") continue;
    out.push(full);
  }
  return out;
}

const PALETTE =
  "(?:white|black|gray|grey|red|blue|green|yellow|amber|orange|slate|zinc|neutral|stone|indigo|purple|violet|emerald|sky|rose|pink|lime|teal|cyan|fuchsia)";

// Utility prefixes that take a color. Shade is optional so `bg-white`,
// `text-black`, `border-white/20` are caught too.
const HARDCODED_COLOR = new RegExp(
  `(?:^|[\\s"'\`:])(?:hover:|focus:|focus-visible:|active:|dark:|md:|sm:|lg:|xl:|data-\\[[^\\]]+\\]:)*` +
    `(?:bg|text|border|ring|outline|fill|stroke|from|via|to|divide|placeholder|caret|accent|decoration|shadow)-${PALETTE}(?:-[0-9]{2,3})?(?:/[0-9]{1,3})?(?=$|[\\s"'\`])`,
  "gm",
);

describe("design-system enforcement (BIV-807)", () => {
  test("no hardcoded Tailwind color utilities in web source", () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC_DIR)) {
      const content = readFileSync(file, "utf8");
      const matches = content.match(HARDCODED_COLOR);
      if (matches) {
        offenders.push(
          `${relative(SRC_DIR, file)}: ${[...new Set(matches)].map((m) => m.trim()).join(", ")}`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });

  test("every light color token has a dark-mode counterpart", () => {
    const css = readFileSync(join(SRC_DIR, "index.css"), "utf8");
    const rootBlock = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const darkBlock = css.match(/\.dark\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

    const tokenNames = (block: string) =>
      new Set(
        [...block.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)]
          .map((m) => m[1])
          // --radius is a shape token, not a color; it has no dark variant.
          .filter((name) => name !== "--radius"),
      );

    const light = tokenNames(rootBlock);
    const dark = tokenNames(darkBlock);
    expect(light.size).toBeGreaterThan(20);

    const missing = [...light].filter((token) => !dark.has(token));
    expect(missing, "tokens missing a .dark override").toEqual([]);
  });

  test("bias spectrum stays on the non-political indigo/amber tokens", () => {
    const css = readFileSync(join(SRC_DIR, "index.css"), "utf8");
    for (const token of [
      "--bias-left",
      "--bias-right",
      "--bias-center",
      "--bias-track",
    ]) {
      expect(css).toContain(`${token}:`);
    }
  });
});

describe("section-title typography enforcement (BIV-818)", () => {
  test("section headings do not use the old all-caps tracked label treatment", () => {
    const offenders: string[] = [];
    const oldTrackedHeading =
      /<h[2-6][^>]*className=["'`][^"'`]*\buppercase\b[^"'`]*\btracking-(?:\[|wide|widest)/g;
    const oldSectionTitleCombo =
      /text-xs\s+font-medium\s+uppercase\s+tracking-\[0\.14em\]\s+text-muted-foreground/g;

    for (const file of collectSourceFiles(SRC_DIR)) {
      const content = readFileSync(file, "utf8");
      if (oldTrackedHeading.test(content) || oldSectionTitleCombo.test(content)) {
        offenders.push(relative(SRC_DIR, file));
      }
      oldTrackedHeading.lastIndex = 0;
      oldSectionTitleCombo.lastIndex = 0;
    }

    expect(offenders).toEqual([]);
  });
});
