# Backlog spec: Romanian NER microservice (BIV-603 — do not build yet)

**Status:** Backlog, spec only · **Date:** 2026-07-02

## Trigger — when to pull this off the backlog

Build this **only if** one of:

- BIV-501's measured clustering precision on Romanian data is inadequate and
  error analysis attributes it to entity confusion (the current
  capitalized-sequence matcher from BIV-601 conflating people/parties/places);
  or
- BIV-701's eval shows systematic named-entity errors (Romanian politicians,
  parties, counties) in summaries traced to bad entity inputs.

Until one of those fires, the regex entity matcher plus embedding similarity
is the entity layer. Do not build this speculatively.

## Design (option A — preferred): FastAPI sidecar

- **Model:** `dumitrescustefan/roner` / BERT-base Romanian NER, ~89–93 F1 on
  RONEC v2. Detects PERSON, ORG, GPE, LOC, NAT_REL_POL (nationality/
  religious/political affiliation — useful for the axis), DATETIME, MONEY, …
- **Service:** small FastAPI app, one `POST /ner` endpoint:
  `{ texts: string[] } → { entities: Array<Array<{ text, label, start, end }>> }`.
  CPU inference is fine at launch volume (batch 16, ~100ms/article on a
  small instance). Deploy as a single container (Fly/Railway/Cloud Run).
- **Integration point:** the enrichment step (`enrichmentNode.ts`) calls it
  over HTTP where `extractEntityCandidates` currently runs; merge results
  into `articles.entities` (same normalized lowercase form). Timeout 3s,
  fall back to the regex matcher on any failure — the service must never
  block ingestion.
- **Auth:** shared bearer token via env var on both sides.

## Design (option B): ONNX in-process

If operating a second service is undesirable, export the same model to ONNX
and run it via Transformers.js in the Node runtime ("use node" action).
Pros: no service to operate. Cons: model download/cold-start in Convex
actions, memory pressure, slower per call. Only pick B if A's operational
cost is the blocker.

## Non-goals

- No entity linking/disambiguation (no knowledge base).
- No replacement of embedding-based clustering — entities remain a
  tightening signal (`entityTokens` in eventCandidacy), not the primary
  matcher.
