"use node";

import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
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

const require = createRequire(import.meta.url);
let wasmInitPromise: Promise<void> | null = null;

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
  return new Intl.DateTimeFormat(undefined, {
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
  const remainingWords = words.slice(consumedWords);
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

  return lines.slice(0, maxLines).map((line, index) =>
    index === maxLines - 1 ? truncate(line, maxCharsPerLine) : line,
  );
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

async function ensureResvgReady(): Promise<void> {
  if (!wasmInitPromise) {
    wasmInitPromise = (async () => {
      const wasmPath = require.resolve("@resvg/resvg-wasm/index_bg.wasm");
      const wasmBytes = await readFile(wasmPath);
      await initWasm(wasmBytes);
    })();
  }

  await wasmInitPromise;
}

function buildSourceStripSvg(
  sources: Array<{ name: string; logoDataUri?: string }>,
): string {
  return sources
    .map((source, index) => {
      const x = 76 + index * 216;
      const label = escapeXml(truncate(source.name, 18));
      const initials = escapeXml(
        source.name
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part.charAt(0).toUpperCase())
          .join("")
          .slice(0, 2) || "?",
      );

      return `
        <g transform="translate(${x} 132)">
          <rect width="196" height="52" rx="26" fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.16)" />
          ${
            source.logoDataUri
              ? `
                <rect x="8" y="8" width="36" height="36" rx="18" fill="rgba(255,255,255,0.88)" />
                <image href="${source.logoDataUri}" x="8" y="8" width="36" height="36" preserveAspectRatio="xMidYMid meet" />
              `
              : `
                <rect x="8" y="8" width="36" height="36" rx="18" fill="rgba(255,255,255,0.14)" stroke="rgba(255,255,255,0.12)" />
                <text x="26" y="31" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="white">${initials}</text>
              `
          }
          <text x="56" y="31" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="white">${label}</text>
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
  const titleLines = splitIntoLines(truncate(data.title, 150), {
    maxCharsPerLine: 34,
    maxLines: 3,
  });
  const summaryLines = splitIntoLines(
    truncate(
      data.summary?.trim() ||
        "Compare the original reporting and see how this story is framed across sources.",
      220,
    ),
    {
      maxCharsPerLine: 56,
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
        <linearGradient id="fallbackBg" x1="0" y1="0" x2="1200" y2="630" gradientUnits="userSpaceOnUse">
          <stop stop-color="#111827" />
          <stop offset="0.45" stop-color="#0F172A" />
          <stop offset="1" stop-color="#05070B" />
        </linearGradient>
        <linearGradient id="heroOverlay" x1="0" y1="0" x2="0" y2="630" gradientUnits="userSpaceOnUse">
          <stop stop-color="rgba(5,8,14,0.18)" />
          <stop offset="0.35" stop-color="rgba(5,8,14,0.36)" />
          <stop offset="1" stop-color="rgba(5,8,14,0.88)" />
        </linearGradient>
        <linearGradient id="glass" x1="72" y1="84" x2="834" y2="560" gradientUnits="userSpaceOnUse">
          <stop stop-color="rgba(255,255,255,0.18)" />
          <stop offset="1" stop-color="rgba(255,255,255,0.08)" />
        </linearGradient>
        <linearGradient id="blueGlow" x1="848" y1="68" x2="1162" y2="236" gradientUnits="userSpaceOnUse">
          <stop stop-color="${BIVIANT_BLUE}" stop-opacity="0.42" />
          <stop offset="1" stop-color="${BIVIANT_BLUE_SOFT}" stop-opacity="0.08" />
        </linearGradient>
        <filter id="blurGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="48" />
        </filter>
      </defs>

      ${backgroundLayer}

      <circle cx="1060" cy="110" r="150" fill="url(#blueGlow)" filter="url(#blurGlow)" />
      <circle cx="180" cy="70" r="110" fill="rgba(90,166,247,0.18)" filter="url(#blurGlow)" />

      <rect x="36" y="36" width="1128" height="558" rx="36" fill="rgba(3,6,12,0.20)" stroke="rgba(255,255,255,0.08)" />
      <rect x="56" y="56" width="812" height="518" rx="30" fill="url(#glass)" stroke="rgba(255,255,255,0.16)" />

      <g transform="translate(904 68)">
        <rect width="212" height="212" rx="36" fill="rgba(9,14,24,0.44)" stroke="rgba(255,255,255,0.10)" />
        <rect x="26" y="24" width="64" height="64" rx="20" fill="${BIVIANT_BLUE}" />
        <text x="58" y="65" text-anchor="middle" font-family="Arial, sans-serif" font-size="32" font-weight="800" fill="#08111E">B</text>
        <text x="26" y="124" font-family="Arial, sans-serif" font-size="28" letter-spacing="0.18em" font-weight="800" fill="white">BIVIANT</text>
        <text x="26" y="155" font-family="Arial, sans-serif" font-size="16" font-weight="600" fill="rgba(255,255,255,0.72)">MULTI-SOURCE EVENT</text>
        <rect x="26" y="173" width="118" height="26" rx="13" fill="rgba(90,166,247,0.18)" stroke="rgba(90,166,247,0.34)" />
        <text x="85" y="191" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" font-weight="800" letter-spacing="0.12em" fill="#DDEEFF">UPDATED ${updated.toUpperCase()}</text>
      </g>

      ${buildSourceStripSvg(sourceLogos)}

      <text font-family="Arial, sans-serif" font-size="60" font-weight="800" fill="white">
        ${buildMultilineTextSpans(titleLines, {
          x: 76,
          startY: 260,
          lineHeight: 70,
        })}
      </text>

      <text font-family="Arial, sans-serif" font-size="26" font-weight="500" fill="rgba(255,255,255,0.90)">
        ${buildMultilineTextSpans(summaryLines, {
          x: 76,
          startY: 458,
          lineHeight: 36,
        })}
      </text>

      <rect x="76" y="526" width="258" height="34" rx="17" fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.12)" />
      <text x="205" y="548" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" font-weight="700" fill="white">${coverage}</text>

      <text x="904" y="530" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="rgba(255,255,255,0.94)">See every side of the story</text>
      <text x="904" y="556" font-family="Arial, sans-serif" font-size="16" font-weight="500" fill="rgba(255,255,255,0.70)">Shared from biviant.com</text>
    </svg>
  `;
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
      await ensureResvgReady();
      const [backgroundDataUri, sourceLogos] = await Promise.all([
        data.imageUrl ? fetchImageAsDataUri(data.imageUrl) : Promise.resolve(null),
        fetchSourceLogoData(data.sources),
      ]);

      const svg = buildShareSvg(data, { backgroundDataUri, sourceLogos });
      const pngBytes = new Resvg(svg, {
        fitTo: { mode: "width", value: SHARE_IMAGE_WIDTH },
      })
        .render()
        .asPng();
      const pngBytesCopy = Uint8Array.from(pngBytes);

      const storageId = await ctx.storage.store(
        new Blob([pngBytesCopy], { type: "image/png" }),
      );

      const {
        previousStorageId,
      }: {
        previousStorageId: Id<"_storage"> | null;
      } = await ctx.runMutation(
        internal.shareAssets.markEventShareAssetReady,
        {
          eventId,
          renderSignature,
          storageId,
          contentType: "image/png",
        },
      );

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
      console.error("[shareAssets] Failed to generate event share asset:", error);
      await ctx.runMutation(internal.shareAssets.markEventShareAssetFailed, {
        eventId,
        renderSignature,
        error: message,
      });
      return { generated: false as const, reason: "render_failed" };
    }
  },
});
