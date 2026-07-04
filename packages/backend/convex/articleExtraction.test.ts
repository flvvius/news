import { describe, expect, test } from "vitest";

import {
  demoteRepeatedSourceBodies,
  extractBodyFromHtml,
  extractEntityCandidates,
} from "./lib/articleExtraction";

describe("entity extraction without wink-nlp (BIV-601)", () => {
  test("extracts Romanian proper-noun sequences from titles", () => {
    const entities = extractEntityCandidates(
      "Klaus Iohannis a promulgat legea bugetului",
      "Președintele Klaus Iohannis a promulgat marți legea. Klaus Iohannis a declarat că bugetul respectă țintele.",
    );
    expect(entities).toContain("klaus iohannis");
  });

  test("keeps connector-joined institutions like Curtea de Apel București", () => {
    const entities = extractEntityCandidates(
      "Curtea de Apel București a decis eliberarea",
      "Decizia Curtea de Apel București este definitivă.",
    );
    expect(
      entities.some((entity) => entity.includes("curtea de apel bucure")),
    ).toBe(true);
  });

  test("strips Romanian role prefixes", () => {
    const entities = extractEntityCandidates(
      "Premierul Marcel Ciolacu anunță noi măsuri fiscale",
      "Premierul Marcel Ciolacu a spus că măsurile se aplică imediat. Marcel Ciolacu a adăugat detalii.",
    );
    expect(entities).toContain("marcel ciolacu");
    expect(entities.some((entity) => entity.startsWith("premierul "))).toBe(
      false,
    );
  });

  test("keeps digit-bearing outlet and org names intact", () => {
    expect(
      extractEntityCandidates(
        "Digi24 anunță o dezbatere electorală",
        "Postul Digi24 a difuzat emisiunea aseară.",
      ),
    ).toContain("digi24");
    expect(
      extractEntityCandidates(
        "Antena 3 comentează protestul",
        "Postul Antena 3 a transmis imagini de la protest.",
      ),
    ).toContain("antena 3");
    expect(
      extractEntityCandidates(
        "Ancheta despre achiziții publice continuă",
        "G4Media a scris despre subiect. G4Media a revenit cu detalii.",
      ),
    ).toContain("g4media");
  });

  test("keeps numeric entities and acronyms", () => {
    const entities = extractEntityCandidates(
      "PSD propune un buget de $5 billion pentru 2026",
      "PSD a anunțat planul. Bugetul crește cu 12%.",
    );
    expect(entities).toContain("psd");
    expect(entities).toContain("12%");
  });

  test("filters weekday noise in both languages", () => {
    const entities = extractEntityCandidates(
      "Vineri se anunță proteste",
      "Protestele de Vineri au fost anunțate Monday.",
    );
    expect(entities).not.toContain("vineri");
    expect(entities).not.toContain("monday");
  });

  test("diacritics are preserved in extracted entities", () => {
    const entities = extractEntityCandidates(
      "Diana Șoșoacă cere ieșirea din UE",
      "Senatoarea Diana Șoșoacă a repetat cererea. Diana Șoșoacă a protestat.",
    );
    expect(entities).toContain("diana șoșoacă");
  });
});

// ---------------------------------------------------------------------------
// BIV-813: zf.ro false-merges. Every ZF page served the same paywall teaser
// widget as its highest-scoring content block, so 38 unrelated articles
// embedded near-identically and merged into one event. The real body sits in
// a NewsArticle JSON-LD block that ZF emits with raw control characters
// inside JSON strings (illegal JSON), so it never parsed.
// ---------------------------------------------------------------------------

/**
 * Mirrors zf.ro's real "Articole recomandate" carousel: every teaser is a
 * <p> whose text lives entirely inside an <a class="title"> anchor,
 * identical on every "page".
 */
const SHARED_TEASER_WIDGET = `
  <div class="latest-news-widget">
    <p><a class="title" href="/a">Business sportiv. Numărul mic de abonamente la sălile de fitness creează spațiu de dezvoltare pentru operatorii din piață, spun jucătorii.</a></p>
    <p><a class="title" href="/b">Olympus: Fabrica din România aduce 26% din vânzările regionale, iar exporturile continuă să crească de la an la an, potrivit companiei.</a></p>
    <p><a class="title" href="/c">Transformarea sistemului energetic a avut loc. În premieră, solarele și eolienele depășesc ca putere instalată Hidroelectrica, spun analiștii.</a></p>
    <p><a class="title" href="/d">Tendințe. Investitorii trec oficial de la modelul primul sosit, primul servit la licitații competitive pentru capacitățile de stocare noi.</a></p>
  </div>`;

function zfLikePage(options: {
  headline: string;
  articleBody?: string;
  brokenJsonLd?: boolean;
}): string {
  // ZF emits raw newlines/tabs INSIDE JSON string literals; a template
  // literal with real newlines reproduces that byte-for-byte.
  const body = options.articleBody
    ? options.brokenJsonLd
      ? options.articleBody.slice(0, 40) + "\n\t" + options.articleBody.slice(40)
      : options.articleBody
    : undefined;
  const jsonLd = body
    ? `<script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "NewsArticle",
          "headline": "${options.headline}",
          "articleBody": "${body}"
        }
      </script>`
    : "";

  return `<!doctype html><html><head><title>${options.headline}</title>${jsonLd}</head>
    <body>${SHARED_TEASER_WIDGET}</body></html>`;
}

const FUEL_BODY =
  "Având în vedere variațiile de prețuri ale carburanților din ultima perioadă, șoferii au la îndemână o aplicație prin care pot afla care este cel mai bun preț la benzină sau motorină din zona în care se află. Aplicația Monitorul Prețurilor a fost lansată în anul 2016 pentru București și Ilfov, iar în anul 2019 a fost extinsă la nivel național, potrivit Consiliului Concurenței.";

const DATACENTER_BODY =
  "Furnizorul de conectivitate cu centre de date în București și Brașov a raportat afaceri în creștere cu 18% în primul semestru, pe fondul cererii pentru servicii cloud și colocare. Compania operează două centre de date certificate și estimează investiții suplimentare de zece milioane de euro în capacitate nouă până la finalul anului viitor, potrivit reprezentanților.";

describe("JSON-LD articleBody extraction (BIV-813)", () => {
  test("regression: malformed JSON-LD (raw control chars) still yields the per-article body", () => {
    const page = zfLikePage({
      headline: "Motorină versus benzină",
      articleBody: FUEL_BODY,
      brokenJsonLd: true,
    });
    const { text, method } = extractBodyFromHtml(page);
    expect(method).toBe("jsonld");
    expect(text).toContain("Monitorul Prețurilor");
    expect(text).not.toContain("Business sportiv");
  });

  test("regression: two ZF-like pages produce distinct embedding bodies, not the shared widget", () => {
    const a = extractBodyFromHtml(
      zfLikePage({
        headline: "Motorină versus benzină",
        articleBody: FUEL_BODY,
        brokenJsonLd: true,
      }),
    );
    const b = extractBodyFromHtml(
      zfLikePage({
        headline: "Afacerile M247 Europe",
        articleBody: DATACENTER_BODY,
        brokenJsonLd: true,
      }),
    );
    expect(a.text).not.toBe(b.text);
    expect(a.text).toContain("carburanților");
    expect(b.text).toContain("centre de date");
  });

  test("link-only teaser widgets never qualify as a body, even without JSON-LD", () => {
    const { text } = extractBodyFromHtml(zfLikePage({ headline: "Titlu unu" }));
    expect(text).not.toContain("Business sportiv");
  });

  test("longer-wins: a teaser-length JSON-LD articleBody does not preempt a substantially fuller DOM body", () => {
    // Some publishers put only the lede in articleBody; the full prose lives
    // in the DOM. The JSON-LD preference must not truncate those articles.
    const lede = FUEL_BODY; // ~380 chars, over MIN_EXTRACTED_BODY_CHARS
    const fullProse = Array.from(
      { length: 6 },
      (_, i) =>
        `<p>Paragraful ${i + 1} al articolului despre carburanți detaliază evoluția prețurilor la benzină și motorină în marile orașe, cu comparații între rețelele de distribuție și estimări pentru trimestrul următor, potrivit datelor oficiale.</p>`,
    ).join("");
    const page = `<!doctype html><html><head>
      <script type="application/ld+json">{"@type":"NewsArticle","articleBody":"${lede}"}</script>
      </head><body><div class="article-content">${fullProse}</div></body></html>`;

    const { text, method } = extractBodyFromHtml(page);
    expect(method).toBe("body");
    expect(text).toContain("Paragraful 6");
  });
});

describe("demoteRepeatedSourceBodies (BIV-813 boilerplate guard)", () => {
  // A prose-shaped boilerplate body (e.g. an identical paywall teaser
  // paragraph) that the link-density filter can't catch.
  const widgetBody =
    "Acest articol este disponibil integral pentru abonații Ziarul Financiar. Aboneaza-te ca să citești analiza completă, plus toate știrile zilei din economie, burse, bănci, companii, energie și imobiliare. Primele două săptămâni sunt gratuite, iar abonamentul se poate anula oricând din contul tău de utilizator, fără costuri suplimentare ascunse. Ai acces nelimitat la arhiva publicației și la edițiile digitale ale ziarului.";

  function prepared(
    title: string,
    body: string,
    sourceName = "Ziarul Financiar",
  ) {
    return {
      sourceName,
      title,
      rssSnippet: `${title} — detalii pe site.`,
      embeddingText: `${title}\n\n${body}`,
      extractedSummary: body.slice(0, 100),
      extractionMethod: "body",
      bodyChars: body.length,
      extractionQuality: "strong" as const,
      entities: [],
    };
  }

  test("guard: different-topic articles sharing only boilerplate lose the shared body", () => {
    const result = demoteRepeatedSourceBodies([
      prepared("Motorină versus benzină", widgetBody),
      prepared("Afacerile M247 Europe", widgetBody),
    ]);

    for (const article of result) {
      expect(article.extractionMethod).toBe("rss_fallback");
      expect(article.extractionQuality).toBe("weak");
      expect(article.bodyChars).toBe(0);
      expect(article.embeddingText).not.toContain("Business sportiv");
    }
    // After demotion the two embedding inputs share no body text at all, so
    // boilerplate similarity alone can no longer push them over the merge
    // threshold.
    expect(result[0]!.embeddingText).not.toBe(result[1]!.embeddingText);
    expect(result[0]!.embeddingText).toContain("Motorină versus benzină");
    expect(result[1]!.embeddingText).toContain("Afacerile M247 Europe");
  });

  test("guard is not evaded by MAX_EMBEDDING_CHARS truncation under different-length titles", () => {
    // buildEmbeddingText caps title+body at 5000 chars, so the SAME
    // boilerplate body gets different tail lengths depending on title
    // length. The guard groups on a body prefix, so it must still fire.
    const longBoilerplate = widgetBody.repeat(13); // ~5.5k chars
    const shortTitle = "Titlu scurt";
    const longTitle =
      "Un titlu considerabil mai lung despre un subiect complet diferit din energie și infrastructură";

    const truncated = (title: string) => {
      const article = prepared(title, longBoilerplate);
      return {
        ...article,
        embeddingText: article.embeddingText.slice(0, 5000),
      };
    };

    const result = demoteRepeatedSourceBodies([
      truncated(shortTitle),
      truncated(longTitle),
    ]);
    for (const article of result) {
      expect(article.extractionMethod).toBe("rss_fallback");
      expect(article.extractionQuality).toBe("weak");
    }
  });

  test("unique bodies from the same source are untouched", () => {
    const input = [
      prepared("Motorină versus benzină", FUEL_BODY),
      prepared("Afacerile M247 Europe", DATACENTER_BODY),
    ];
    expect(demoteRepeatedSourceBodies(input)).toEqual(input);
  });

  test("the same body under the SAME title is a duplicate item, not boilerplate", () => {
    const input = [
      prepared("Motorină versus benzină", FUEL_BODY),
      prepared("Motorină versus benzină", FUEL_BODY),
    ];
    expect(demoteRepeatedSourceBodies(input)).toEqual(input);
  });

  test("identical bodies across DIFFERENT sources are not demoted (wire copy)", () => {
    const input = [
      prepared("Titlu unu", FUEL_BODY, "Sursa A"),
      prepared("Titlu doi", FUEL_BODY, "Sursa B"),
    ];
    expect(demoteRepeatedSourceBodies(input)).toEqual(input);
  });
});
