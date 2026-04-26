"use node";

import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type EventShareRenderData,
  SHARE_IMAGE_HEIGHT,
  SHARE_IMAGE_WIDTH,
} from "./shareAssets";

const BIVIANT_BLUE = "#5AA6F7";
const BIVIANT_BLUE_SOFT = "#87BBFF";
const USER_AGENT =
  "Mozilla/5.0 (compatible; BiviantBot/1.0; +https://biviant.com)";
const FETCH_TIMEOUT_MS = 8000;
const MAX_FETCH_BYTES = 8 * 1024 * 1024;
const RESVG_FONT_FAMILY = "Inter";
const FONT_FILES = [
  {
    url: "https://unpkg.com/inter-font@3.19.0/ttf/Inter-Regular.ttf",
    fileName: "biviant-inter-regular.ttf",
  },
  {
    url: "https://unpkg.com/inter-font@3.19.0/ttf/Inter-Medium.ttf",
    fileName: "biviant-inter-medium.ttf",
  },
  {
    url: "https://unpkg.com/inter-font@3.19.0/ttf/Inter-Bold.ttf",
    fileName: "biviant-inter-bold.ttf",
  },
  {
    url: "https://unpkg.com/inter-font@3.19.0/ttf/Inter-ExtraBold.ttf",
    fileName: "biviant-inter-extra-bold.ttf",
  },
] as const;

let cachedFontFilePathsPromise: Promise<string[]> | null = null;

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function truncate(value: string | undefined, maxChars: number): string {
  if (!value) return "";
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function formatUpdatedAt(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

function splitIntoLines(
  value: string,
  {
    maxCharsPerLine,
    maxLines,
  }: {
    maxCharsPerLine: number;
    maxLines: number;
  },
): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxCharsPerLine || current.length === 0) {
      current = next;
      continue;
    }

    lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) {
      break;
    }
  }

  const consumedWords = lines.join(" ").split(/\s+/).filter(Boolean).length;
  const consumedIncludingCurrent = Math.min(
    words.length,
    consumedWords + (current ? 1 : 0),
  );
  const remainingWords = words.slice(consumedIncludingCurrent);
  const finalLine =
    current || remainingWords.length > 0
      ? [current, ...remainingWords].filter(Boolean).join(" ")
      : "";

  if (finalLine) {
    lines.push(
      lines.length === maxLines
        ? truncate(finalLine, maxCharsPerLine)
        : finalLine,
    );
  }

  return lines
    .slice(0, maxLines)
    .map((line, index) =>
      index === maxLines - 1 ? truncate(line, maxCharsPerLine) : line,
    );
}

async function getFontFilePaths(): Promise<string[]> {
  if (!cachedFontFilePathsPromise) {
    cachedFontFilePathsPromise = Promise.all(
      FONT_FILES.map(async ({ url, fileName }) => {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Font fetch failed: ${response.status}`);
        }

        const fontBuffer = Buffer.from(await response.arrayBuffer());
        const fontFilePath = join(tmpdir(), fileName);
        await writeFile(fontFilePath, fontBuffer);
        return fontFilePath;
      }),
    );
  }

  return cachedFontFilePathsPromise;
}

async function fetchImageAsDataUri(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type");
    if (!contentType?.startsWith("image/")) {
      return null;
    }

    if (
      contentType.includes("icon") ||
      contentType.endsWith("/x-icon") ||
      contentType.endsWith("/vnd.microsoft.icon")
    ) {
      return null;
    }

    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_FETCH_BYTES) {
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);
    if (bytes.byteLength > MAX_FETCH_BYTES) {
      return null;
    }
    return `data:${contentType};base64,${bytes.toString("base64")}`;
  } catch (error) {
    console.error("[shareAssets] Failed to fetch image asset:", error);
    return null;
  }
}

async function fetchSourceLogoData(
  sources: EventShareRenderData["sources"],
): Promise<Array<{ name: string; logoDataUri?: string }>> {
  const topSources = sources.slice(0, 3);
  const logos = await Promise.all(
    topSources.map(async (source) => ({
      name: source.name,
      logoDataUri:
        (source.logoUrl ? await fetchImageAsDataUri(source.logoUrl) : null) ??
        undefined,
    })),
  );
  return logos;
}

function buildSourceStripSvg(
  sources: Array<{ name: string; logoDataUri?: string }>,
): string {
  return sources
    .map((source, index) => {
      const x = 72 + index * 194;
      const label = escapeXml(truncate(source.name, 16));
      const initials = escapeXml(
        source.name
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part.charAt(0).toUpperCase())
          .join("")
          .slice(0, 2) || "?",
      );

      return `
        <g transform="translate(${x} 122)">
          <rect width="178" height="48" rx="24" fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.16)" />
          ${
            source.logoDataUri
              ? `
                <rect x="8" y="8" width="32" height="32" rx="16" fill="rgba(255,255,255,0.92)" />
                <image href="${source.logoDataUri}" x="8" y="8" width="32" height="32" preserveAspectRatio="xMidYMid meet" />
              `
              : `
                <rect x="8" y="8" width="32" height="32" rx="16" fill="white" fill-opacity="0.12" stroke="white" stroke-opacity="0.12" />
                <text x="24" y="28" text-anchor="middle" font-family="${RESVG_FONT_FAMILY}, sans-serif" font-size="13" font-weight="700" fill="white">${initials}</text>
              `
          }
          <text x="50" y="29" font-family="${RESVG_FONT_FAMILY}, sans-serif" font-size="17" font-weight="700" fill="white">${label}</text>
        </g>
      `;
    })
    .join("");
}

function buildMultilineTextSpans(
  lines: string[],
  {
    x,
    startY,
    lineHeight,
  }: {
    x: number;
    startY: number;
    lineHeight: number;
  },
): string {
  return lines
    .map(
      (line, index) =>
        `<tspan x="${x}" y="${startY + index * lineHeight}">${escapeXml(line)}</tspan>`,
    )
    .join("");
}

function buildShareSvg(
  data: EventShareRenderData,
  {
    backgroundDataUri,
    sourceLogos,
  }: {
    backgroundDataUri: string | null;
    sourceLogos: Array<{ name: string; logoDataUri?: string }>;
  },
): string {
  const titleLines = splitIntoLines(truncate(data.title, 140), {
    maxCharsPerLine: 32,
    maxLines: 3,
  });
  const summaryLines = splitIntoLines(
    truncate(
      data.summary?.trim() ||
        "Compare the original reporting and see how this story is framed across sources.",
      200,
    ),
    {
      maxCharsPerLine: 54,
      maxLines: 3,
    },
  );
  const updated = escapeXml(formatUpdatedAt(data.lastUpdatedAt));
  const coverage = escapeXml(
    `${data.articleCount} ${data.articleCount === 1 ? "article" : "articles"} • ${data.sourceCount} ${
      data.sourceCount === 1 ? "source" : "sources"
    }`,
  );

  const backgroundLayer = backgroundDataUri
    ? `
      <image href="${backgroundDataUri}" x="0" y="0" width="${SHARE_IMAGE_WIDTH}" height="${SHARE_IMAGE_HEIGHT}" preserveAspectRatio="xMidYMid slice" />
      <rect x="0" y="0" width="${SHARE_IMAGE_WIDTH}" height="${SHARE_IMAGE_HEIGHT}" fill="url(#heroOverlay)" />
    `
    : `
      <rect x="0" y="0" width="${SHARE_IMAGE_WIDTH}" height="${SHARE_IMAGE_HEIGHT}" fill="url(#fallbackBg)" />
      <rect x="0" y="0" width="${SHARE_IMAGE_WIDTH}" height="${SHARE_IMAGE_HEIGHT}" fill="url(#heroOverlay)" />
    `;

  return `
    <svg width="${SHARE_IMAGE_WIDTH}" height="${SHARE_IMAGE_HEIGHT}" viewBox="0 0 ${SHARE_IMAGE_WIDTH} ${SHARE_IMAGE_HEIGHT}" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="fallbackBg" x1="0" y1="0" x2="${SHARE_IMAGE_WIDTH}" y2="${SHARE_IMAGE_HEIGHT}" gradientUnits="userSpaceOnUse">
          <stop stop-color="#111827" />
          <stop offset="0.45" stop-color="#0F172A" />
          <stop offset="1" stop-color="#05070B" />
        </linearGradient>
        <linearGradient id="heroOverlay" x1="0" y1="0" x2="0" y2="${SHARE_IMAGE_HEIGHT}" gradientUnits="userSpaceOnUse">
          <stop stop-color="rgba(5,8,14,0.18)" />
          <stop offset="0.35" stop-color="rgba(5,8,14,0.38)" />
          <stop offset="1" stop-color="rgba(5,8,14,0.88)" />
        </linearGradient>
        <linearGradient id="glass" x1="68" y1="72" x2="754" y2="508" gradientUnits="userSpaceOnUse">
          <stop stop-color="rgba(255,255,255,0.18)" />
          <stop offset="1" stop-color="rgba(255,255,255,0.08)" />
        </linearGradient>
        <linearGradient id="blueGlow" x1="774" y1="56" x2="1038" y2="196" gradientUnits="userSpaceOnUse">
          <stop stop-color="${BIVIANT_BLUE}" stop-opacity="0.42" />
          <stop offset="1" stop-color="${BIVIANT_BLUE_SOFT}" stop-opacity="0.08" />
        </linearGradient>
        <filter id="blurGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="24" />
        </filter>
      </defs>

      ${backgroundLayer}

      <circle cx="960" cy="96" r="132" fill="url(#blueGlow)" filter="url(#blurGlow)" />
      <circle cx="160" cy="68" r="92" fill="rgba(90,166,247,0.18)" filter="url(#blurGlow)" />

      <rect x="28" y="28" width="1024" height="510" rx="34" fill="rgba(3,6,12,0.22)" stroke="rgba(255,255,255,0.08)" />
      <rect x="48" y="48" width="740" height="470" rx="28" fill="url(#glass)" stroke="rgba(255,255,255,0.16)" />

      <g transform="translate(816 56)">
        <rect width="202" height="192" rx="34" fill="rgba(9,14,24,0.46)" stroke="rgba(255,255,255,0.10)" />
        <rect x="24" y="22" width="58" height="58" rx="18" fill="${BIVIANT_BLUE}" />
        <text x="53" y="59" text-anchor="middle" font-family="${RESVG_FONT_FAMILY}, sans-serif" font-size="30" font-weight="800" fill="#08111E">B</text>
        <text x="24" y="114" font-family="${RESVG_FONT_FAMILY}, sans-serif" font-size="26" letter-spacing="0.16em" font-weight="800" fill="white">BIVIANT</text>
        <text x="24" y="142" font-family="${RESVG_FONT_FAMILY}, sans-serif" font-size="15" font-weight="600" fill="rgba(255,255,255,0.72)">MULTI-SOURCE EVENT</text>
        <rect x="24" y="158" width="122" height="24" rx="12" fill="rgba(90,166,247,0.18)" stroke="rgba(90,166,247,0.34)" />
        <text x="85" y="175" text-anchor="middle" font-family="${RESVG_FONT_FAMILY}, sans-serif" font-size="11" font-weight="800" letter-spacing="0.10em" fill="#DDEEFF">UPDATED ${updated.toUpperCase()}</text>
      </g>

      ${buildSourceStripSvg(sourceLogos)}

      <text font-family="${RESVG_FONT_FAMILY}, sans-serif" font-size="56" font-weight="800" fill="white">
        ${buildMultilineTextSpans(titleLines, {
          x: 68,
          startY: 236,
          lineHeight: 64,
        })}
      </text>

      <text font-family="${RESVG_FONT_FAMILY}, sans-serif" font-size="24" font-weight="500" fill="rgba(255,255,255,0.90)">
        ${buildMultilineTextSpans(summaryLines, {
          x: 68,
          startY: 404,
          lineHeight: 34,
        })}
      </text>

      <rect x="68" y="480" width="236" height="30" rx="15" fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.12)" />
      <text x="186" y="501" text-anchor="middle" font-family="${RESVG_FONT_FAMILY}, sans-serif" font-size="15" font-weight="700" fill="white">${coverage}</text>

      <text x="816" y="494" font-family="${RESVG_FONT_FAMILY}, sans-serif" font-size="19" font-weight="700" fill="rgba(255,255,255,0.94)">See every side of the story</text>
      <text x="816" y="518" font-family="${RESVG_FONT_FAMILY}, sans-serif" font-size="15" font-weight="500" fill="rgba(255,255,255,0.70)">Shared from biviant.com</text>
    </svg>
  `;
}

async function renderSvgToPng(svg: string): Promise<Buffer> {
  const fontFilePaths = await getFontFilePaths();

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: SHARE_IMAGE_WIDTH },
    background: "rgba(0,0,0,0)",
    font: {
      fontFiles: fontFilePaths,
      defaultFontFamily: RESVG_FONT_FAMILY,
      loadSystemFonts: false,
    },
    logLevel: "off",
  });

  const pngBytes = resvg.render().asPng();
  return Buffer.from(pngBytes);
}

export const generateEventShareAsset = internalAction({
  args: {
    eventId: v.id("events"),
    renderSignature: v.string(),
  },
  handler: async (
    ctx,
    { eventId, renderSignature },
  ): Promise<
    | { generated: false; reason: "stale_or_missing" | "render_failed" }
    | {
        generated: true;
        storageId: Id<"_storage">;
        contentType: "image/png";
        bytes: number;
      }
  > => {
    const [data, asset]: [
      EventShareRenderData | null,
      Doc<"eventShareAssets"> | null,
    ] = await Promise.all([
      ctx.runQuery(internal.shareAssets.getEventShareRenderData, { eventId }),
      ctx.runQuery(internal.shareAssets.getEventShareAsset, { eventId }),
    ]);

    if (!data || !asset || asset.renderSignature !== renderSignature) {
      return { generated: false as const, reason: "stale_or_missing" };
    }

    try {
      const [backgroundDataUri, sourceLogos] = await Promise.all([
        data.imageUrl
          ? fetchImageAsDataUri(data.imageUrl)
          : Promise.resolve(null),
        fetchSourceLogoData(data.sources),
      ]);

      const svg = buildShareSvg(data, { backgroundDataUri, sourceLogos });
      const pngBytes = await renderSvgToPng(svg);

      const storageId = await ctx.storage.store(
        new Blob([Uint8Array.from(pngBytes)], { type: "image/png" }),
      );

      const {
        previousStorageId,
      }: {
        previousStorageId: Id<"_storage"> | null;
      } = await ctx.runMutation(internal.shareAssets.markEventShareAssetReady, {
        eventId,
        renderSignature,
        storageId,
        contentType: "image/png",
      });

      if (previousStorageId && previousStorageId !== storageId) {
        await ctx.storage.delete(previousStorageId);
      }

      return {
        generated: true as const,
        storageId,
        contentType: "image/png" as const,
        bytes: pngBytes.byteLength,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown share render error";
      console.error(
        "[shareAssets] Failed to generate event share asset:",
        error,
      );
      await ctx.runMutation(internal.shareAssets.markEventShareAssetFailed, {
        eventId,
        renderSignature,
        error: message,
      });
      return { generated: false as const, reason: "render_failed" };
    }
  },
});
