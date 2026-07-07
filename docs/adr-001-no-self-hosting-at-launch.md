# ADR-001: Managed Gemini API at launch — no self-hosted models (BIV-204)

**Status:** Accepted · **Date:** 2026-07-02

## Decision

The Romanian launch uses **managed Gemini** (gemini-3.1-flash-lite via the
OpenAI-compatible API, see BIV-201) for all pipeline reasoning tasks, plus
OpenAI `text-embedding-3-small` for embeddings. **No self-hosted models, no
rented GPUs, no model-serving infrastructure** may be introduced for launch —
this ADR exists so no agent or contributor spins up GPU infra "to save costs."

## Rationale

- At launch volume (15 feeds, hundreds of articles/day, a $1/day AI budget
  cap), managed API costs are a rounding error. Self-hosting an open model
  (RoMistral, RoLlama) on a rented GPU costs more in fixed rent than the
  entire monthly API bill, before counting operations time.
- Managed Flash-Lite is stronger in Romanian than the open Romanian
  fine-tunes at comparable serving cost, and structured-output support is
  built in.
- The pipeline's provider abstraction (lib/modelRouting.ts) already makes
  the model id a config value; if the calculus ever changes, swapping is a
  config edit, not an architecture change.

## Scope

This ADR covers **generative LLM serving** (anything answering the
summarize/score/extract calls in the pipeline). It does **not** block the
BIV-603 Romanian NER sidecar if its quality trigger fires: that is a small
CPU-inference token classifier, not GPU LLM infrastructure, and it has its
own spec (docs/backlog-romanian-ner-microservice.md).

## Revisit conditions (V2, both documented, neither expected soon)

Self-hosting becomes a legitimate option only if at least one of:

1. **Data residency**: a legal/contractual requirement that article text
   must not leave a specific jurisdiction; or
2. **Volume**: sustained usage above **100M tokens/month**, where dedicated
   serving of a RoMistral/RoLlama-class model plausibly beats per-token
   pricing.

Any V2 self-hosting proposal must include a cost model against the then-
current managed pricing and a Romanian quality eval run through the BIV-701
harness.

## References

- roadmap.md (Epic B — AI model migration)
- BIV-201 (config-driven LLM client), BIV-701 (Romanian eval harness)
