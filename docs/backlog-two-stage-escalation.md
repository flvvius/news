# Backlog spec: two-stage model escalation for perspective/bias (BIV-203 — deferred)

**Status:** Deferred (P2) · **Date:** 2026-07-02 · **Gate:** BIV-701 results

## What it is

A feature-flagged pipeline path that keeps **gemini-3.1-flash-lite** for the
neutral summary and per-article work, but escalates only the
perspective-synthesis + bias-score steps to **gemini-3.5-flash**. Framing and
spin detection is "nuanced analysis" — the weakest area for small models —
so escalation targets exactly the steps where Flash-Lite is most likely to
produce flat, undifferentiated per-side summaries.

## Build only if

BIV-701's eval shows a measurable gap on Flash-Lite, specifically:
per-side (reformist/suveranist) summaries that mostly restate the neutral
core, or bias-score sanity failures on the labeled set. If Flash-Lite
passes the eval bar, this never gets built.

## Sketch (when triggered)

- Config: `perspective_escalation_enabled` (default false) +
  `perspective_escalation_model` (default `gemini-3.5-flash` — pricing
  already in the aiBudget rate card).
- The current event-summary call produces neutral + reformist + suveranist +
  globalImpact in ONE request, so targeted escalation requires **splitting
  it**: a Flash-Lite call for the neutral core + globalImpact, and an
  escalation-model call that receives the neutral core and synthesizes the
  two framing perspectives. `enrichmentNode` bias scoring escalates as its
  own (already separate) call. If the split proves not worth the extra
  request, the fallback design is escalating the whole event-summary call —
  but then the cost delta covers the neutral summary too, and this doc must
  be updated to say so.
- Cost delta is visible per model in aiUsage (`by_date_model` index) — no
  new logging needed.

Acceptance when built: flag off by default; with the flag on, only the
perspective/bias steps use the escalation model; cost delta reviewable in
aiUsage.
