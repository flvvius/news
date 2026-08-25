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

  test("camp tokens exist and stay perceptually symmetric (MIEZ-1)", () => {
    const css = readFileSync(join(SRC_DIR, "index.css"), "utf8");

    // Both camps + the neutral core must be defined.
    for (const token of ["--camp-a", "--camp-b", "--core"]) {
      expect(css, `${token} missing`).toContain(`${token}:`);
    }

    // Neither camp may reuse a party-colour hue accidentally: parse the base
    // camp tokens from each block and assert near-equal lightness/chroma so
    // one camp can't read louder or more saturated than the other.
    const parseOklch = (block: string, token: string) => {
      const m = block.match(
        new RegExp(`${token}:\\s*oklch\\(([0-9.]+)\\s+([0-9.]+)\\s+([0-9.]+)`),
      );
      if (!m) throw new Error(`could not parse ${token}`);
      return { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) };
    };

    for (const [name, block] of [
      [":root", css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? ""],
      [".dark", css.match(/\.dark\s*\{([\s\S]*?)\n\}/)?.[1] ?? ""],
    ] as const) {
      const a = parseOklch(block, "--camp-a");
      const b = parseOklch(block, "--camp-b");
      expect(Math.abs(a.l - b.l), `${name} camp lightness gap`).toBeLessThanOrEqual(0.04);
      expect(Math.abs(a.c - b.c), `${name} camp chroma gap`).toBeLessThanOrEqual(0.03);
    }
  });

  test("bias spectrum tokens exist (now the reformist–suveranist camp axis)", () => {
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

/**
 * Sections are not cards.
 *
 * The web app had drifted into wrapping every content zone in a
 * `bg-card` + border + shadow box, which made ordinary pages read like a
 * generated dashboard. Hierarchy now comes from typography, whitespace and
 * hairlines (DESIGN_SYSTEM.md "Surfaces — sections are not cards"), matching
 * the native app's editorial-calm direction.
 *
 * Surfaces survive only where they mean something: overlays that genuinely
 * float, media frames, interactive controls, and the internal /admin tooling.
 */
describe("surface enforcement — sections are not cards", () => {
  // Overlays float; the shared Card primitive is kept for /admin; the skeleton
  // primitive paints muted blocks by definition.
  const SURFACE_EXEMPT = [
    /^components\/ui\//,
    /^routes\/admin\./,
  ];

  const isExempt = (path: string) =>
    SURFACE_EXEMPT.some((pattern) => pattern.test(path));

  test("no <Card> on user-facing screens", () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC_DIR)) {
      const path = relative(SRC_DIR, file);
      if (isExempt(path)) continue;
      if (/<Card[\s/>]/.test(readFileSync(file, "utf8"))) {
        offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("no hand-rolled card surfaces (border + bg-card/bg-muted panel)", () => {
    // A rounded box that also paints a surface colour AND draws a border is a
    // card by any other name.
    //
    // `overflow-hidden` is the exemption: an element that clips its children
    // is a media frame (the muted fill is the placeholder behind an image, the
    // border is the frame). It is a heuristic, not a proof — but a content
    // panel has no child to clip, so in practice only frames carry it.
    const handRolledCard =
      /className=\{?["'`][^"'`]*\brounded-(?:lg|xl|2xl)\b[^"'`]*\bborder\b[^"'`]*\bbg-(?:card|muted)\b[^"'`]*["'`]/g;
    const reversed =
      /className=\{?["'`][^"'`]*\bbg-(?:card|muted)\b[^"'`]*\brounded-(?:lg|xl|2xl)\b[^"'`]*\bborder\b[^"'`]*["'`]/g;

    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC_DIR)) {
      const path = relative(SRC_DIR, file);
      if (isExempt(path)) continue;
      const content = readFileSync(file, "utf8");
      const matches = [
        ...(content.match(handRolledCard) ?? []),
        ...(content.match(reversed) ?? []),
      ].filter((match) => !match.includes("overflow-hidden"));
      if (matches.length > 0) {
        offenders.push(`${path}: ${matches.join(" | ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("no dashed-border empty states", () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC_DIR)) {
      const path = relative(SRC_DIR, file);
      if (isExempt(path)) continue;
      if (/\bborder-dashed\b/.test(readFileSync(file, "utf8"))) {
        offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
  });
});
