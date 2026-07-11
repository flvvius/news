import { BRAND_NAME } from "./brand";

export type EventSummaryArticleInput = {
  title: string;
  sourceName: string;
  sourceBiasLabel: string;
  sourceReliability: number;
  publishedAt: string;
  summary?: string;
  rssSnippet?: string;
  atomicFacts: string[];
  // Fetched transiently at summarization time and already capped by the
  // caller — never persisted (copyright constraint).
  bodyText?: string;
  canonicalUrl: string;
};

export type EventSummaryPromptInput = {
  eventTitle: string;
  articles: EventSummaryArticleInput[];
};

export type EventSummaryOutput = {
  neutral: string;
  reformist: string;
  suveranist: string;
  globalImpact: string;
  // false = CASE D: the story has no reformist/suveranist dimension, so the
  // side fields are empty and the UI shows a note instead of a fake split.
  perspectiveApplicable: boolean;
};

export type ArticleFactExtractionInput = {
  id: string;
  title: string;
  sourceName?: string;
  publishedAt?: string;
  entities?: string[];
  summary?: string;
  rssSnippet?: string;
  bodyText?: string;
};

export type ArticleFactExtractionPromptInput = {
  maxFactsPerArticle: number;
  articles: ArticleFactExtractionInput[];
};

export type ArticleBiasScoringInput = {
  id: string;
  title: string;
  sourceName?: string;
  sourceLean: string;
  sourceReliability: number;
  publishedAt?: string;
  summary?: string;
  rssSnippet?: string;
  bodyText?: string;
};

export type ArticleBiasScoringPromptInput = {
  maxInputChars: number;
  articles: ArticleBiasScoringInput[];
};

export type ClaimDivergenceStatus =
  | "agreement"
  | "divergence"
  | "framing"
  | "exclusive_left"
  | "exclusive_right"
  | "exclusive_center";

export type ClaimType =
  | "quantitative"
  | "event"
  | "attribution"
  | "policy"
  | "characterization";

export type ClaimAnalysisArticleInput = {
  title: string;
  sourceName: string;
  sourceLean: string;
  sourceReliability: number;
  publishedAt: string;
  atomicFacts: string[];
};

export type ClaimAnalysisPromptInput = {
  eventTitle: string;
  articles: ClaimAnalysisArticleInput[];
};

function trimField(value: string | undefined, maxLength: number): string {
  return (value ?? "").trim().slice(0, maxLength);
}

/**
 * Bump when the summary prompt semantics change so existing events are
 * resummarized even with unchanged article inputs. Folded into the summary
 * signature (summarizationNode.ts) AND checked against
 * events.lastSummaryPromptVersion by shouldResummarize (summarization.ts) —
 * the signature alone only skips spend, it never re-enqueues.
 * v2 = Romanian-first neutral/reformist/suveranist prompt (BIV-202).
 * v3 = transient full-body input, CASE D (no political axis →
 * perspectiveApplicable=false), concrete emphasis/omission requirements for
 * the perspective fields, globalImpact must not restate neutral.
 * v4 = CASE D applies even with cross-lean coverage of apolitic stories
 * (dev eval: 0/17 fired, loto/meteo/sport got forced splits); case labels
 * must not leak into output text.
 * v5 = CASE D wired into the precomputed case lines + explicit step-0
 * decision order (v4 still fired 0/18 — the "tratează ca adevăr" case
 * lines left no D option at the point of writing).
 * v6 = L3 paraphrase mandate: never copy ≥8 consecutive source words or
 * sentence structure; quotes only inside quotation marks with attribution
 * (enforced post-generation by the verbatim-overlap gate).
 * v7 = perspective boxes must show a genuine difference or nothing: dropped
 * the old CASE B "reflected the shared factual core" boilerplate. A side with
 * ≥2 articles either diverges concretely (write it, lead with the difference)
 * or is materially identical to neutral (return empty string → UI hides the
 * tab). The phrase "nucleul factual comun" and any "reflected the common core"
 * meta-statement are banned. NOTE: pairs with the summarization.ts
 * `sidesComplete` relaxation — empty sides are now a valid terminal state.
 */
export const SUMMARY_PROMPT_VERSION = 7;

export const GLOBAL_IMPACT_FALLBACK =
  "Impactul concret nu este precizat în articolele furnizate.";

export const LIMITED_COVERAGE_FALLBACK: Record<
  "reformist" | "suveranist",
  string
> = {
  // BIV-805: user-visible fallback (stored as the perspective summary) — uses
  // "orientare", not the "cadrare" calque; the LLM-internal prompt vocabulary
  // is unchanged on purpose (model-facing, covered by the eval harness).
  reformist: "Acoperire limitată din partea surselor cu orientare reformistă.",
  suveranist: "Acoperire limitată din partea surselor cu orientare suveranistă.",
};

/**
 * User-visible fallback stored when the model omits a perspective field
 * (BIV-805: "perspectivă", not the "cadrare" calque). Lives here rather than
 * in summarizationNode.ts so the non-Node test suite can lint its wording.
 */
export const SIDE_COVERAGE_FALLBACK =
  "Acoperirea disponibilă nu oferă încă o perspectivă distinctă din această parte.";

/**
 * Map a source's stored bias label (left/left-center/center/right-center/
 * right — derived from the −5..+5 axis score) to the Romanian framing pole
 * shown to the model. Negative = reformist, positive = suveranist
 * (docs/bias-axis-spec.md).
 */
function framingLabelFor(sourceBiasLabel: string): string {
  const label = sourceBiasLabel.toLowerCase();
  if (label === "left" || label === "left-center") return "reformistă";
  if (label === "right" || label === "right-center") return "suveranistă";
  if (label === "center") return "neutră";
  return "necunoscută";
}

function perspectiveCaseFor(
  count: number,
  side: "reformist" | "suveranist",
): string {
  const sideLabel = side === "reformist" ? "reformistă" : "suveranistă";
  const fallback = LIMITED_COVERAGE_FALLBACK[side];
  if (count <= 1) {
    return `CAZUL A — ${count} articole cu cadrare ${sideLabel} în input; scrie exact "${fallback}". (Ignoră acest caz dacă ai stabilit CAZUL D: atunci câmpul rămâne șir gol.)`;
  }
  return `CAZUL C sau GOL — ${count} articole cu cadrare ${sideLabel} în input. Decide dacă acoperirea acestei părți diferă concret de nucleul neutral: cadrare, accent, omisiuni sau fapte exclusive proprii. Dacă DA, alege CAZUL C și scrie diferența. Dacă NU (acoperirea acestei părți repetă în esență faptele din neutral, fără un unghi propriu), lasă câmpul șir gol (""). NU scrie niciodată că sursele „au reflectat nucleul factual comun" sau o formulare echivalentă — dacă nu există o diferență de raportat, câmpul rămâne gol. (Lasă gol și în CAZUL D.)`;
}

export function buildEventSummaryPrompt(input: EventSummaryPromptInput): {
  system: string;
  user: string;
} {
  const reformistArticleCount = input.articles.filter((article) => {
    const label = article.sourceBiasLabel.toLowerCase();
    return label === "left" || label === "left-center";
  }).length;
  const suveranistArticleCount = input.articles.filter((article) => {
    const label = article.sourceBiasLabel.toLowerCase();
    return label === "right" || label === "right-center";
  }).length;
  const reformistCase = perspectiveCaseFor(reformistArticleCount, "reformist");
  const suveranistCase = perspectiveCaseFor(
    suveranistArticleCount,
    "suveranist",
  );
  const articleBlocks = input.articles
    .map((article, index) => {
      const facts = article.atomicFacts
        .slice(0, 6)
        .map((fact) => `- ${trimField(fact, 220)}`)
        .join("\n");

      return [
        `Articolul ${index + 1}`,
        `sursa: ${article.sourceName}`,
        `cadrareaSursei: ${framingLabelFor(article.sourceBiasLabel)}`,
        `fiabilitateaSursei: ${article.sourceReliability}/10`,
        `publicatLa: ${article.publishedAt}`,
        `Titlu: ${trimField(article.title, 220)}`,
        article.bodyText
          ? `Textul articolului: ${trimField(article.bodyText, 6000)}`
          : "",
        article.summary
          ? `Rezumat extras: ${trimField(article.summary, 900)}`
          : "",
        article.rssSnippet
          ? `Fragment RSS: ${trimField(article.rssSnippet, 700)}`
          : "",
        facts ? `Fapte atomice:\n${facts}` : "",
        `URL canonic: ${article.canonicalUrl}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");

  return {
    system: [
      `Ești motorul de sinteză a evenimentelor al platformei ${BRAND_NAME}, un agregator de știri românesc.`,
      "Citești articole de presă grupate pe același eveniment și scrii un rezumat strict factual, cu perspective multiple.",
      "",
      "LIMBA (regulă absolută):",
      "- Scrie TOT textul EXCLUSIV în limba română, cu diacritice corecte (ș, ț, ă, â, î).",
      "- Nu folosi engleza sau altă limbă în niciun câmp, indiferent de limba articolelor sursă. Citatele rămân în limba originală doar dacă sunt marcate ca citat.",
      "",
      "AXA DE CADRARE (reformist ↔ suveranist):",
      "- Cadrarea reformistă pune accent pe: integrarea europeană și NATO, statul de drept, lupta anticorupție, alinierea la politicile UE.",
      "- Cadrarea suveranistă pune accent pe: suveranitatea națională față de Bruxelles, scepticismul față de mandatele UE, valorile tradiționale și religioase, protejarea capitalului național, criticile la adresa instituțiilor anticorupție.",
      "- Ambele etichete sunt descriptive, nu evaluative. Nu prezenta niciuna dintre cadrări ca fiind corectă sau greșită.",
      "",
      "REGULI DE BAZĂ:",
      "- Folosește DOAR materialul din articolele furnizate. Nu inventa niciodată fapte, cifre, citate, motivații, rezultate sau efecte ulterioare.",
      '- Când un articol are câmpul "Textul articolului", acela este materialul principal — extrage din el detaliile concrete (cifre, nume, locuri, termene, declarații). "Rezumat extras" și "Fragment RSS" sunt doar rezerve pentru articolele fără text.',
      "- Rezumatul neutral trebuie să rețină detaliile specifice care fac știrea utilă: sume, procente, date, locuri, instituții și persoane numite de surse. Nu le înlocui cu formulări generale.",
      "- Preferă faptele confirmate de 2 sau mai multe surse. Dacă un fapt-cheie apare într-un singur articol, atribuie-l numelui sursei.",
      "- Tratează câmpurile de fapte atomice ca afirmații verificabile pre-extrase. Folosește-le pentru a identifica faptele comune, dezacordurile și faptele raportate de o singură parte.",
      "- Dacă sursele se contrazic asupra unui fapt, semnalează dezacordul cu atribuire. Nu alege în tăcere una dintre variante.",
      '- Grupează articolele după câmpul cadrareaSursei: "reformistă" informează câmpul reformist; "suveranistă" informează câmpul suveranist; toate sursele fiabile pot informa câmpul neutral.',
      "- Preferă sursele cu fiabilitateaSursei >= 7 pentru nucleul factual. Atribuie explicit afirmațiile surselor cu fiabilitateaSursei < 5.",
      "- Când articolele intră în conflict, folosește cel mai recent publicatLa drept stare curentă doar dacă abordează direct conflictul.",
      "- Scrie proză neutră, ancorată în surse. Fără liste cu puncte. Fără limbaj de marketing. Fără editorializare.",
      "",
      "PARAFRAZARE (regulă absolută — încălcarea blochează publicarea):",
      "- Reformulează integral în propriile tale cuvinte. NU copia niciodată o secvență de 8 sau mai multe cuvinte consecutive din vreun articol furnizat.",
      "- NU copia structura frazelor sursă: schimbă ordinea ideilor, topica și construcția propozițiilor, nu doar câteva cuvinte.",
      "- Citatele directe sunt permise NUMAI între ghilimele („...”), cu numele sursei atașat, și au maxim 10 cuvinte. Orice text preluat literal fără ghilimele este interzis.",
      "- Numele proprii, instituțiile, cifrele și datele se preiau exact — acestea nu sunt parafrazabile.",
      "",
      "VERIFICAREA AXEI POLITICE (CAZUL D — are prioritate față de A/C):",
      "- Înainte de a scrie câmpurile reformist și suveranist, decide dacă subiectul are o dimensiune reformist↔suveranistă reală în acoperirea furnizată: poziții politice divergente, dispute instituționale, teme legate de UE/NATO/suveranitate, justiție sau valori.",
      '- Dacă subiectul este apolitic (meteo, sport, loterie, rezultate sportive, sondaje de divertisment, accidente, avarii utilitare, sănătate publică de rutină, fapt divers, decizii tehnice fără dispută politică), setează perspectiveApplicable la false și lasă câmpurile reformist și suveranist ca șiruri goale ("").',
      "- Aplică CAZUL D chiar dacă ambele părți au articole în input: faptul că surse cu orientări diferite au relatat aceeași știre apolitică NU creează o axă politică. Întrebarea decisivă este: conțin articolele poziționări politice divergente? Dacă nu, este CAZUL D.",
      "- NU folosi CAZUL D pentru subiecte despre politică, partide, guvern, parlament, justiție, corupție, UE/NATO, buget, alegeri sau declarații ale politicienilor — acelea au întotdeauna o axă.",
      "- Când perspectiveApplicable este true, execută cazurile precalculate de mai jos.",
      "",
      "NUMĂRUL DE ARTICOLE PE PERSPECTIVĂ (precalculat; tratează ca adevăr):",
      `- articole cu cadrare reformistă: ${reformistArticleCount}`,
      `- articole cu cadrare suveranistă: ${suveranistArticleCount}`,
      "- Numără după cadrareaSursei a articolului, nu după numele distinct al sursei.",
      `CAZUL REFORMIST: ${reformistCase}`,
      `CAZUL SUVERANIST: ${suveranistCase}`,
      "",
      "DEFINIȚIILE CAZURILOR:",
      "- CAZUL A: folosește exact textul de rezervă furnizat mai sus. Nu adăuga explicații.",
      "- CAZUL C: scrie 50-100 de cuvinte care ÎNCEP cu diferența concretă a acestei părți: ce accentuează (și celelalte surse nu), ce omite, ce fapte exclusive raportează, sau ce au pus în titlu/prim-plan. Numește sursele. Poți cita expresii scurte (maxim 10 cuvinte) din articole, între ghilimele, cu numele sursei — citatul rămâne în limba originală.",
      '- CÂMP GOL: dacă acoperirea acestei părți nu diferă concret de neutral (repetă aceleași fapte, fără un unghi propriu), lasă câmpul șir gol (""). Este un rezultat valid și preferabil unei umpluturi.',
      '- INTERZIS ca text de perspectivă: sintagma „nucleul factual comun" și orice afirmație că sursele „au reflectat / au preluat / au oglindit" faptele comune. Dacă asta ai vrea să scrii, câmpul rămâne gol în loc.',
      '- Nu scrie o diferență de ton pe care articolele nu o susțin. Fără o diferență reală, câmpul este gol — nu inventa una.',
      '- Nu folosi niciodată un text de rezervă "Acoperire limitată..." pentru o parte cu 2 sau mai multe articole.',
      '- Etichetele "CAZUL A/C/D" sunt doar instrucțiuni interne: nu scrie niciodată "CAZUL" sau litera cazului în textul câmpurilor.',
      "",
      "REGULI PENTRU globalImpact:",
      "- globalImpact trebuie să exprime o semnificație concretă a evenimentului, susținută de surse.",
      "- globalImpact NU repetă rezumatul neutral. Nu re-povesti evenimentul: începe direct cu cine sau ce este afectat și cu ce consecință. Dacă o informație apare deja în neutral, în globalImpact apare doar consecința ei, nu faptul în sine.",
      "- Forme valide de impact, în ordinea priorității: o consecință specifică ulterioară; un efect deja declarat (reacții de piață, victime, diplomație, sancțiuni, prețuri); sau mize directe numite de un articol.",
      "- O miză există când orice articol menționează un risc specific pentru o persoană, un grup, o piață, o regiune, un tratat, alegeri, aprovizionare, prețuri sau o instituție.",
      "- Dacă nu ești sigur că o mențiune este o miză concretă, consider-o validă și scrie impactul.",
      "- Citează numele sursei când exprimi impactul.",
      `- Folosește exact "${GLOBAL_IMPACT_FALLBACK}" doar când articolele sunt pur procedurale sau informative și nu conțin niciun risc, efect, consecință sau miză.`,
      "",
      "OUTPUT:",
      "- Returnează DOAR JSON cu exact aceste chei: neutral, reformist, suveranist, globalImpact, perspectiveApplicable.",
      "- perspectiveApplicable este boolean: false doar în CAZUL D, altfel true.",
      "- Fără proză, markdown sau delimitatori de cod în afara JSON-ului.",
      "",
      "INTERZIS:",
      "- Să faci referire la articole prin index. Folosește numele surselor.",
      "- Să menționezi URL-uri în proză.",
      '- Să folosești limbaj evaluativ despre motivațiile surselor sau cuvântul "manipulare".',
      '- Să folosești "ar putea", "posibil" sau "s-ar putea" dacă niciun articol furnizat nu exprimă acea incertitudine.',
      '- Să folosești cuvinte de marketing precum "transformator", "fără precedent", "istoric", "crucial" sau "critic", cu excepția citatelor sau a mizelor literale de siguranță, medicale sau de urgență.',
    ].join("\n"),
    user: [
      `Eveniment: ${input.eventTitle}`,
      "",
      "Scrie:",
      "- Pasul 0, înainte de orice: stabilește perspectiveApplicable aplicând VERIFICAREA AXEI POLITICE. Pentru știri despre loterie, sport, meteo, sondaje de divertisment sau fapt divers fără poziționări politice divergente, răspunsul corect este false — chiar dacă ambele părți au articole în input.",
      "- neutral (70-120 cuvinte): nucleul factual comun, cu detaliile specifice (cifre, nume, locuri, termene), preferând faptele confirmate de mai multe surse. Notează dezacordurile cu atribuire.",
      '- reformist (50-100 de cuvinte în CAZUL C; șir gol "" dacă nu diferă concret de neutral sau în CAZUL D): execută CAZUL REFORMIST indicat mai sus.',
      '- suveranist (50-100 de cuvinte în CAZUL C; șir gol "" dacă nu diferă concret de neutral sau în CAZUL D): execută CAZUL SUVERANIST indicat mai sus.',
      "- globalImpact (50-100 de cuvinte): aplică REGULILE PENTRU globalImpact. Începe cu consecința, nu repeta neutral. Preferă efectele sau mizele concrete declarate în locul textului de rezervă.",
      "- perspectiveApplicable (boolean): false doar dacă ai aplicat CAZUL D.",
      "",
      "Respectă limita de cuvinte a fiecărui câmp. Evită listele cu puncte. Evită certitudinile nesusținute. Scrie exclusiv în limba română.",
      "",
      "Articole:",
      articleBlocks,
    ].join("\n"),
  };
}

export type GroundingPromptInput = {
  sentences: Array<{ index: number; sentence: string }>;
  articles: Array<{
    index: number;
    sourceName: string;
    title: string;
    excerpt: string;
  }>;
};

/**
 * L4 — decisive entailment pass of the grounding check. One call verifies
 * every summary sentence against the event's source excerpts and names the
 * supporting article indexes. A sentence unsupported by every source must
 * come back supported=false — publication strips or blocks it.
 */
export function buildGroundingVerificationPrompt(input: GroundingPromptInput): {
  system: string;
  user: string;
} {
  const articleBlocks = input.articles
    .map((article) =>
      [
        `[Articolul ${article.index}]`,
        `sursa: ${article.sourceName}`,
        `titlu: ${trimField(article.title, 220)}`,
        `extras: ${trimField(article.excerpt, 1600)}`,
      ].join("\n"),
    )
    .join("\n\n");
  const sentenceBlocks = input.sentences
    .map(({ index, sentence }) => `${index}. ${trimField(sentence, 400)}`)
    .join("\n");

  return {
    system: [
      "Ești un verificator strict de fapte pentru un agregator de știri românesc.",
      "Primești propoziții dintr-un rezumat generat automat și extrase din articolele de presă pe care rezumatul PRETINDE că se bazează.",
      "Pentru FIECARE propoziție decide: este afirmația susținută explicit de cel puțin unul dintre extrasele furnizate?",
      "",
      "REGULI:",
      '- "Susținută" înseamnă că un cititor găsește informația în extras — direct sau printr-o reformulare fidelă. Deducțiile, generalizările și detaliile care nu apar în niciun extras NU sunt susținute.',
      "- Cifrele, datele, numele și atribuirile trebuie să corespundă extraselor. O cifră diferită sau un nume greșit = nesusținută.",
      "- Formulările prudente de tip agregare (\"mai multe surse relatează...\") sunt susținute dacă esența apare în extrase.",
      "- Nu folosi cunoștințe externe. Doar extrasele furnizate contează.",
      "- Returnează DOAR JSON: {\"results\": [{\"index\": <număr propoziție>, \"supported\": <boolean>, \"articleIndexes\": [<indexurile articolelor care susțin>]}]} pentru TOATE propozițiile primite.",
    ].join("\n"),
    user: [
      "Extrase din articole:",
      articleBlocks,
      "",
      "Propoziții de verificat:",
      sentenceBlocks,
    ].join("\n"),
  };
}

export function buildArticleFactExtractionPrompt(
  input: ArticleFactExtractionPromptInput,
): {
  system: string;
  user: string;
} {
  const articleBlocks = input.articles
    .map((article) =>
      [
        `id: ${article.id}`,
        article.sourceName ? `sourceName: ${article.sourceName}` : "",
        article.publishedAt ? `publishedAt: ${article.publishedAt}` : "",
        `title: ${trimField(article.title, 240)}`,
        article.entities?.length
          ? `detectedEntities: ${article.entities.slice(0, 16).join(", ")}`
          : "",
        article.summary ? `summary: ${trimField(article.summary, 900)}` : "",
        article.rssSnippet
          ? `rssSnippet: ${trimField(article.rssSnippet, 700)}`
          : "",
        article.bodyText ? `bodyText: ${trimField(article.bodyText, 2600)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n---\n\n");

  return {
    system: [
      `You are ${BRAND_NAME}'s atomic fact extraction engine.`,
      "You extract short, standalone factual claims from individual news articles.",
      "",
      "LANGUAGE (absolute rule):",
      "- Write every fact EXCLUSIVELY in Romanian, with correct diacritics (ș, ț, ă, â, î), regardless of the article's language.",
      "",
      "CORE RULES:",
      "- Use ONLY the supplied article material. Never infer, complete, or add facts from outside knowledge.",
      "- Each fact must be a single verifiable claim with a clear subject, action/state, and object or consequence.",
      "- Preserve specific numbers, dates, places, named actors, votes, charges, amounts, and deadlines when supplied.",
      "- Use detectedEntities to normalize entity names. When extracting a fact about an entity, prefer the most specific supported form found in detectedEntities or the article text.",
      "- If the article attributes a claim to an official, company, filing, court, witness, or other source, keep that attribution in the fact.",
      "- Exclude opinions, predictions, vague context, rhetoric, duplicate facts, and generic background that is not central to the article.",
      "- Do not mention article IDs, URLs, or source indexes in facts.",
      "",
      "OUTPUT:",
      '- Return ONLY JSON with exactly one key: "articles".',
      '- Each item must contain "id" and "facts".',
      "- facts must contain concise strings only.",
      "- If an article has no extractable factual claims, return an empty facts array for that id.",
    ].join("\n"),
    user: [
      `Cap at ${input.maxFactsPerArticle} atomic facts per article.`,
      "Output only facts the article actually supports. Do not pad to a target count.",
      "Facts should be understandable without reading the original article.",
      "",
      "Articles:",
      articleBlocks,
    ].join("\n"),
  };
}

export function buildArticleBiasScoringPrompt(
  input: ArticleBiasScoringPromptInput,
): {
  system: string;
  user: string;
} {
  const articleBlocks = input.articles
    .map((article) =>
      [
        `id: ${article.id}`,
        `sourceName: ${article.sourceName ?? "Unknown"}`,
        article.publishedAt ? `publishedAt: ${article.publishedAt}` : "",
        `title: ${trimField(article.title, 240)}`,
        article.summary ? `summary: ${trimField(article.summary, 900)}` : "",
        article.rssSnippet
          ? `rssSnippet: ${trimField(article.rssSnippet, 700)}`
          : "",
        article.bodyText
          ? `bodyText: ${trimField(article.bodyText, input.maxInputChars)}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n---\n\n");

  return {
    system: [
      `Ești motorul de scorare a biasului la nivel de articol al platformei ${BRAND_NAME}, un agregator de știri românesc.`,
      "Evaluează fiecare articol pe axa reformist↔suveranist plus trei sub-dimensiuni. Returnează doar JSON conform schemei.",
      "",
      "LIMBA (regulă absolută):",
      "- Scrie câmpul rationale EXCLUSIV în limba română, cu diacritice corecte.",
      "",
      "REGULI DE BAZĂ:",
      "- Evaluează textul articolului, nu reputația publicației. Numele sursei este doar metadată de atribuire; nu îl folosi ca indicator al cadrării.",
      "- Folosește doar materialul furnizat. Nu deduce intenția autorului sau fapte dincolo de text.",
      "- Tratează atribuirea de tip știre factuală ca opinie redusă, chiar și când sursele citate folosesc limbaj partizan.",
      "- Rationale trebuie să citeze formulări, surse sau structuri specifice din articol.",
      "",
      'AXA DE CADRARE (bias.axis = "reformist_suveranist", bias.score de la -5 la +5):',
      "-5: Puternic reformist. Cadrează evenimentele prin lentila pro-europeană/reformistă ca voce proprie: statul de drept, anticorupția, integrarea europeană prezentate ca bine implicit; vocile suveraniste apar doar pentru a fi combătute.",
      "-2: Moderat reformist. Cadrare reformistă subtilă în alegerea cuvintelor; citează preponderent voci pro-europene și neutre.",
      " 0: Stil agenție de presă. Știre factuală în stil de agenție: atribuire simetrică și limbaj descriptiv, fără vocabularul niciunei tabere adoptat ca voce proprie.",
      '+2: Moderat suveranist. Cadrare suveranistă subtilă; preia necitat termeni precum "dictatul Bruxelles-ului" sau prezintă instituțiile anticorupție drept abuzive.',
      '+5: Puternic suveranist. Cadrează evenimentele prin lentila suveranistă ca voce proprie: "statul paralel", "interese străine", "globaliști", valorile naționale sub asediu; vocile pro-europene apar doar pentru a fi combătute.',
      "- Scorul măsoară cadrarea TEXTULUI, nu subiectul. Un articol despre un miting suveranist nu este suveranist din cauza subiectului; contează al cui vocabular îl adoptă articolul ca voce proprie.",
      "",
      "LIMBAJ EMOȚIONAL (0 la 5):",
      '0: Limbaj pur neutru, de tipul "Legea a trecut cu 60 de voturi la 40."',
      '2: Limbaj ușor evaluativ, de tipul "Legea controversată a trecut la limită."',
      '5: Limbaj puternic încărcat, de tipul "Legea dezastruoasă a fost trecută cu forța în ciuda opoziției vehemente."',
      "",
      "DIVERSITATEA SURSELOR (0 la 5):",
      "0: Doar surse anonime sau o singură voce numită.",
      "2: Două sau trei surse dintr-o singură perspectivă.",
      "5: Patru sau mai multe surse din perspective politice sau de expertiză multiple, cu citate directe.",
      "",
      "RAPORT FAPTE/OPINIE (0 la 5):",
      "0: Relatare pură: cine, ce, când, unde și cum. Doar afirmații atribuite.",
      "3: Relatare cu cadrare interpretativă ușoară.",
      "5: Editorial, analiză sau judecată explicită a autorului.",
      "",
      "OUTPUT:",
      '- Returnează doar JSON cu exact o cheie: "articles".',
      '- Fiecare element include id-ul original, obiectul bias { axis: "reformist_suveranist", score } și cele trei sub-scoruri.',
      "- Fără proză, markdown sau delimitatori de cod în afara JSON-ului.",
    ].join("\n"),
    user: [
      "Evaluează aceste articole pentru componentele de bias la nivel de articol.",
      "Limitează fiecare rationale la 1-2 propoziții concise, în limba română, citând formulări, surse sau structura articolului.",
      "",
      "Articole:",
      articleBlocks,
    ].join("\n"),
  };
}

export function buildClaimAnalysisPrompt(input: ClaimAnalysisPromptInput): {
  system: string;
  user: string;
} {
  const articleBlocks = input.articles
    .map((article, index) => {
      const facts = article.atomicFacts
        .slice(0, 10)
        .map((fact, factIndex) => `  [${factIndex}] ${trimField(fact, 260)}`)
        .join("\n");

      return [
        `Article ${index}`,
        `Source: ${article.sourceName}`,
        `Lean: ${article.sourceLean}`,
        `Reliability: ${article.sourceReliability}/10`,
        `PublishedAt: ${article.publishedAt}`,
        `Title: ${trimField(article.title, 220)}`,
        `Facts:\n${facts || "  - No atomic facts supplied."}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");

  return {
    system: [
      `You are ${BRAND_NAME}'s claim divergence engine.`,
      "",
      "Given atomic facts extracted from multiple articles covering the same news event, group facts that refer to the same underlying claim and classify how sources relate.",
      "",
      "LANGUAGE (absolute rule): write every canonical statement and variant statement EXCLUSIVELY in Romanian, with correct diacritics.",
      "",
      "STATUS DEFINITIONS:",
      "- agreement: 2 or more sources from 2 or more different lean groups state the same fact with the same values/details.",
      "- divergence: 2 or more sources state the same underlying claim with materially different values, numbers, dates, attributions, outcomes, or current status.",
      "- framing: 2 or more sources state the same fact but use materially different language that changes perspective, emphasis, or characterization.",
      "- exclusive_left: only left or left-center sources report a substantive fact.",
      "- exclusive_right: only right or right-center sources report a substantive fact.",
      "- exclusive_center: only center sources report a substantive fact.",
      "",
      "CLAIM TYPE DEFINITIONS:",
      "- quantitative: numbers, money, dates, vote counts, percentages, timelines, casualty counts, or other measurable values.",
      "- event: concrete occurrence, action, decision, filing, vote, arrest, appointment, meeting, statement release, or outcome.",
      "- attribution: who said, alleged, accused, reported, confirmed, denied, ordered, or promised something.",
      "- policy: laws, regulations, executive actions, court orders, program rules, institutional policies, or implementation effects.",
      "- characterization: descriptive labels or assessments such as peaceful/violent, legal/illegal, historic/routine, or success/failure.",
      "",
      "RULES:",
      "- A claim must be supported by at least one atomic fact from the input. Do not invent claims.",
      "- Each variant must reference the exact articleIndex and factIndex of an input atomic fact that supports it.",
      "- Cluster facts by their underlying assertion, not by surface wording.",
      "- Quantitative claims with different values are divergence, not framing.",
      "- Different dates, attributions, outcomes, or current status are divergence, not framing.",
      "- If variants describe the same outcome and differ only in precision versus vagueness, classify as framing, not divergence.",
      "- Trivial wording differences, synonyms, and sentence structure differences are agreement, not framing.",
      "- Do not classify a claim as agreement unless it has support from at least 2 distinct sources.",
      "- Do not classify a claim as divergence or framing unless it has at least 2 variants from distinct sources.",
      "- Do not reference a factIndex unless that atomic fact directly supports the canonical claim.",
      "- Do not mention URLs or article indexes in the canonical statement.",
      "- Importance rates how central the claim is to the news event, 1-5. Cap output at 12 claims total. If an event has fewer than 5 importance-3-or-higher claims, that is fine; quality over quantity.",
      "- Confidence is your certainty in the grouping and classification, 0-1. Lower it when facts are sparse or ambiguous.",
      "",
      "OUTPUT:",
      "- Return only JSON matching the schema. No prose, markdown, or code fences.",
    ].join("\n"),
    user: [
      `Event: ${input.eventTitle}`,
      "",
      `Articles (${input.articles.length}):`,
      articleBlocks,
      "",
      "Analyze claims across all articles and return the most important grouped claims per the schema.",
    ].join("\n"),
  };
}
