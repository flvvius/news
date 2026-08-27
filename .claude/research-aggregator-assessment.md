# Turning Miez into a research-paper aggregator

Assessment for a **fresh repo starting from this one, without Convex**.
Numbers come from measuring this repo (see `repo-reference.md`).

## Verdict

**3–4 months solo for a solid v1; 6–8 weeks with scope cut hard.**

The trap is thinking you are forking a codebase. You are rewriting a backend
while copying a design. What survives the move is the architecture and the
operational lessons — not the source files.

Note the shape of the work: **the parts that took longest to build are the
parts you delete**, and the parts you keep are the generic ones.

## Transfers

- **The pipeline shape** — ingest → dedupe → embed → cluster → summarize →
  ground → publish. Maps to papers cleanly and is the real asset.
- **Operational lessons** — grounding gate, prompt versioning, budget caps,
  job leases, config-driven tuning, the enqueue ≤ batch invariant. Worth more
  than the code.
- **Frontend** — React + Tailwind, the editorial-calm system, feed/card/search
  anatomy. `EventCard` → `PaperCard` is a reskin. But all ~140 data call sites
  change.
- **i18n scaffolding**, prompt structure, grounding approach (conceptually —
  grounding matters *more* for papers, where a hallucinated finding is worse
  than a hallucinated news detail).

## Deleted

The entire bias axis: reformist/suveranist scoring, perspective summaries,
source reputation, bias outliers, camp colours — 38 files. Papers have no
political axis. Mapping it onto "methodology quality" or "replication status"
is a different product, not a rename. The Romanian editorial layer and the
MBFC/Veridica catalog go with it.

## New, and genuinely hard

Problems this codebase never solved:

- **Version dedup** — arXiv v1…v7, then the journal DOI. Not the same as news
  clustering. The riskiest single item.
- **Author disambiguation** — ORCID helps, does not solve.
- **Citation graph** — a dimension news lacks entirely.
- **PDF/LaTeX parsing** — news gives HTML bodies; papers give PDFs with
  figures, tables and math.
- Retraction tracking (Retraction Watch), venue metadata, math rendering.

## The no-Convex bill

Convex is not the database here. It is the database **plus** reactive queries,
vector search, the cron scheduler, transactional mutations,
`scheduler.runAfter`, file storage, and the pagination cursor protocol.
Replacing it:

| Convex feature | Replacement | Scale of change |
|---|---|---|
| Reactive queries | TanStack Query + SSE/polling | 48 files, ~140 call sites |
| Vector search | Postgres + pgvector | 149 usages |
| 17 crons + `runAfter` | Inngest / Temporal / pg-boss | whole scheduler layer |
| Job leases (`processingRunId`, `leaseExpiresAt`) | `SELECT FOR UPDATE SKIP LOCKED` | hand-rolled |
| Transactional mutations | Postgres transactions | throughout |
| File storage | S3/R2 | small |
| Auth | Better Auth (already used) | portable |

You go from one system to three. That is the thing that made this feasible
solo, given up deliberately. Cost lands similar (~$1–3/mo) on Neon/Supabase +
Inngest free tiers.

## Cheapest viable v1

**arXiv abstracts only.** Skips PDF parsing entirely — the arXiv API returns
clean structured metadata plus an abstract, which is exactly the input the
summarization pipeline wants. No citation graph, no author disambiguation;
cluster by embedding similarity within a category. That is the 6–8 week
version and it is a real product.

Sources worth considering beyond arXiv: OpenAlex (broad, free, good metadata),
Crossref (DOIs), Semantic Scholar (citations), PubMed (biomed).

## Open question

Not yet settled: what replaces the bias axis as the product thesis. Without an
opinionated angle this is "another paper feed". Candidates discussed nowhere
yet — replication/retraction status, methodology signals, cross-field impact.
Decide this before building, since it drives the schema.
