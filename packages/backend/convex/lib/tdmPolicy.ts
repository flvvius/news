/**
 * L5 — TDM opt-out signal parsing (pure, testable). Machine-readable rights
 * reservations decide what we may do with a domain's content:
 *
 *   full     — extraction + full-text summarization input allowed
 *   rss_only — headline + link + ≤120-char snippet from RSS metadata only;
 *              no page fetch, no full-text summarization input
 *   blocked  — nothing displayed at all (publisher opt-out request, L6)
 *
 * ANY machine-readable opt-out signal caps the domain at rss_only. `blocked`
 * is only ever set manually via the publisher opt-out flow.
 *
 * Signals checked (in the order the resolver fetches them):
 *  1. TDM-Reservation HTTP header (TDMRep, W3C CG final report)
 *  2. /.well-known/tdmrep.json
 *  3. <meta name="tdm-reservation"> HTML tag
 *  4. robots.txt per RFC 9309 — our own token, `*`, and AI-convention tokens
 *  5. noai robots meta / X-Robots-Tag
 *  6. /ai.txt (Spawning convention)
 */

export type DomainPermissionState = "full" | "rss_only" | "blocked";

/** Our crawler's robots.txt product token (see L6). */
export const BOT_UA_TOKEN = "MiezBot";

/**
 * AI-convention user-agent tokens: a publisher disallowing these expresses a
 * machine-readable AI/TDM opt-out we honor even though we are not that bot.
 */
export const AI_UA_TOKENS = [
  "ai",
  "machinelearning",
  "gptbot",
  "google-extended",
  "ccbot",
  "anthropic-ai",
  "claudebot",
  "claude-web",
  "perplexitybot",
  "bytespider",
  "cohere-ai",
  "omgilibot",
  "diffbot",
];

type RobotsGroup = {
  agents: string[];
  disallow: string[];
  allow: string[];
  crawlDelay?: number;
};

export function parseRobotsTxt(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "user-agent") {
      if (!lastWasAgent || !current) {
        current = { agents: [], disallow: [], allow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "disallow") current.disallow.push(value);
    else if (field === "allow") current.allow.push(value);
    else if (field === "crawl-delay") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) current.crawlDelay = parsed;
    }
  }
  return groups;
}

/** RFC 9309 group selection: exact token match wins over `*`. */
export function robotsGroupFor(
  groups: RobotsGroup[],
  token: string,
): RobotsGroup | null {
  const lower = token.toLowerCase();
  const exact = groups.find((group) => group.agents.includes(lower));
  if (exact) return exact;
  return groups.find((group) => group.agents.includes("*")) ?? null;
}

/**
 * Does this robots.txt fully disallow the given agent (Disallow: /)?
 * Path-specific disallows are respected at fetch time, not treated as a
 * domain-wide opt-out.
 */
export function robotsDisallowsAll(
  robotsTxt: string,
  token: string,
): boolean {
  const group = robotsGroupFor(parseRobotsTxt(robotsTxt), token);
  if (!group) return false;
  const disallowsRoot = group.disallow.some((path) => path.trim() === "/");
  const allowsRoot = group.allow.some((path) => path.trim() === "/");
  return disallowsRoot && !allowsRoot;
}

/** Crawl-delay for the given agent, if declared (used by the L6 limiter). */
export function robotsCrawlDelay(
  robotsTxt: string,
  token: string,
): number | undefined {
  return robotsGroupFor(parseRobotsTxt(robotsTxt), token)?.crawlDelay;
}

/** TDMRep well-known file: any policy covering the root reserving TDM. */
export function tdmrepReservesRights(json: string): boolean {
  try {
    const parsed = JSON.parse(json) as unknown;
    const policies = Array.isArray(parsed) ? parsed : [parsed];
    return policies.some((policy) => {
      if (!policy || typeof policy !== "object") return false;
      const record = policy as Record<string, unknown>;
      const reservation =
        record["tdm-reservation"] ?? record["tdm_reservation"];
      return reservation === 1 || reservation === "1" || reservation === true;
    });
  } catch {
    return false;
  }
}

/** TDM-Reservation HTTP header value ("1" = rights reserved). */
export function tdmHeaderReservesRights(
  headerValue: string | null | undefined,
): boolean {
  if (!headerValue) return false;
  return headerValue.trim().startsWith("1");
}

/** <meta name="tdm-reservation" content="1"> in the page head. */
export function htmlDeclaresTdmReservation(html: string): boolean {
  const metaRegex =
    /<meta[^>]+name=["']tdm-reservation["'][^>]*content=["']?([^"'>\s]+)/gi;
  for (const match of html.matchAll(metaRegex)) {
    if (match[1]?.startsWith("1")) return true;
  }
  // Attribute order can be reversed.
  const reversedRegex =
    /<meta[^>]+content=["']?1["']?[^>]*name=["']tdm-reservation["']/gi;
  return reversedRegex.test(html);
}

/** noai/noimageai in a robots meta tag or X-Robots-Tag header. */
export function declaresNoAi(
  html: string | undefined,
  xRobotsTag: string | null | undefined,
): boolean {
  if (xRobotsTag && /\bnoai\b/i.test(xRobotsTag)) return true;
  if (!html) return false;
  const metaRegex =
    /<meta[^>]+name=["']robots["'][^>]*content=["']([^"']*)["']/gi;
  for (const match of html.matchAll(metaRegex)) {
    if (/\bnoai\b/i.test(match[1] ?? "")) return true;
  }
  return false;
}

/** ai.txt (Spawning): a Disallow covering everything or text media. */
export function aiTxtDisallowsText(aiTxt: string): boolean {
  const lines = aiTxt.split(/\r?\n/).map((line) => line.trim().toLowerCase());
  return lines.some(
    (line) =>
      line.startsWith("disallow:") &&
      ["/", "*", "/*", "*.txt", "text"].includes(
        line.slice("disallow:".length).trim(),
      ),
  );
}

export type TdmSignalInputs = {
  tdmReservationHeader?: string | null;
  tdmrepJson?: string | null;
  homepageHtml?: string | null;
  xRobotsTag?: string | null;
  robotsTxt?: string | null;
  /** robots.txt could not be fetched (network/5xx) — restrict until known. */
  robotsTxtUnreachable?: boolean;
  aiTxt?: string | null;
};

export type TdmEvaluation = {
  state: DomainPermissionState;
  signals: string[];
};

/**
 * Combine every signal into the domain's permission state. Fail closed:
 * any opt-out → rss_only; unreachable robots.txt → rss_only until resolved.
 */
export function evaluateTdmSignals(inputs: TdmSignalInputs): TdmEvaluation {
  const signals: string[] = [];

  if (tdmHeaderReservesRights(inputs.tdmReservationHeader)) {
    signals.push("tdm_reservation_header");
  }
  if (inputs.tdmrepJson && tdmrepReservesRights(inputs.tdmrepJson)) {
    signals.push("tdmrep_json");
  }
  if (inputs.homepageHtml && htmlDeclaresTdmReservation(inputs.homepageHtml)) {
    signals.push("tdm_reservation_meta");
  }
  if (declaresNoAi(inputs.homepageHtml ?? undefined, inputs.xRobotsTag)) {
    signals.push("noai");
  }
  if (inputs.robotsTxtUnreachable) {
    signals.push("robots_txt_unreachable");
  } else if (inputs.robotsTxt) {
    if (robotsDisallowsAll(inputs.robotsTxt, BOT_UA_TOKEN)) {
      signals.push(`robots:${BOT_UA_TOKEN}`);
    }
    for (const token of AI_UA_TOKENS) {
      if (robotsDisallowsAll(inputs.robotsTxt, token)) {
        // Only count AI tokens with a DEDICATED group (the `*` fallback
        // already surfaces via our own token above).
        const group = robotsGroupFor(parseRobotsTxt(inputs.robotsTxt), token);
        if (group && !group.agents.includes("*")) {
          signals.push(`robots:${token}`);
        }
      }
    }
  }
  if (inputs.aiTxt && aiTxtDisallowsText(inputs.aiTxt)) {
    signals.push("ai_txt");
  }

  return {
    state: signals.length > 0 ? "rss_only" : "full",
    signals,
  };
}

/** Normalize a URL or hostname to the sources.domain format. */
export function normalizeDomain(urlOrHost: string): string {
  let host = urlOrHost.trim().toLowerCase();
  try {
    if (host.includes("/") || host.includes(":")) {
      host = new URL(host.startsWith("http") ? host : `https://${host}`)
        .hostname;
    }
  } catch {
    // keep as-is
  }
  return host.replace(/^www\./, "");
}

/** May we fetch and extract full page content from this domain? */
export function extractionAllowed(state: DomainPermissionState): boolean {
  return state === "full";
}

/** May headline+link+snippet from the RSS feed itself be shown? */
export function rssDisplayAllowed(state: DomainPermissionState): boolean {
  return state !== "blocked";
}
