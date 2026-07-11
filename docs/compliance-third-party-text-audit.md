# L2 — Third-party text audit (Romanian Art. 94¹ "very short extract")

Ceiling: **`MAX_SNIPPET_CHARS = 120`** — single source of truth in
`packages/backend/convex/lib/compliance.ts`, mirrored render-side in
`apps/web/src/lib/snippet.ts` (cross-checked by the L15 compliance suite).

No displayed **or stored** third-party text may exceed 120 characters.
Hyperlinks (headline + link to the canonical URL) are categorically outside
the press publishers' right (DSM art. 15), so every snippet renders with an
adjacent canonical link.

## Fields holding third-party text

| Field | Nature | Class | Enforcement |
|---|---|---|---|
| `articles.rssSnippet` | RSS description | **Display** | Truncated at write (`ingestion.insertArticles`), backfilled (`migrations.backfillSnippetCeiling`), re-truncated at render (`<Snippet>`) |
| `articles.summary` | Extracted meta description / body lead | **Display** | Truncated at write (`enrichment.markArticleEnriched`), backfilled, re-truncated at render |
| `articles.title` | Publisher headline | Display (headline+link pattern) | Rendered as-is next to the canonical link; headlines are the classic aggregator pattern and virtually always <120 chars |
| Heuristic `events.perspectiveSummaries.neutral` | Contains one representative snippet | Display (non-public: only `processing` events carry heuristic summaries) | Snippet component capped at 120 inside `clustering.ts` (`representativeSnippet`) |
| `articles.atomicFacts` | AI-extracted paraphrased facts | Processing/display | Our own paraphrase, not verbatim third-party text (L3 gate covers verbatim leakage) |
| Article body text | Full third-party text | **Processing only** | Never persisted (see `fetchArticleBodyText` + no-article-body-storage rule); fetched transiently for summarization and dropped. L5 gates which domains may be fetched at all |
| `articleEmbeddings` / `eventEmbeddings` | Numeric vectors | Processing | Not text |
| `contentFingerprint` | Hash | Processing | Not text |

## Render paths for third-party text (web)

- `apps/web/src/components/feed/articles-list.tsx` — via `<Snippet>`, canonical
  link ("Citește originalul") directly beneath.
- `apps/web/src/routes/source.$sourceId.tsx` — via `<Snippet>`, canonical link
  in the same card.

`<Snippet>` (`apps/web/src/components/ui/snippet.tsx`) is the only sanctioned
way to render third-party article text and hard-truncates regardless of what
is stored.

## Event/AI summaries

`events.perspectiveSummaries` written by the AI pipeline are our own text
(paraphrase enforced by the L3 verbatim-overlap gate), not third-party
extracts, and are not subject to the 120-char ceiling.
