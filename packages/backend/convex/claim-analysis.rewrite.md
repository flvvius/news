# Claim analysis — rewritten prompt rules + divergence-adjudication pass

Targets the two failure modes diagnosed on 2026-06-22:
- **False positives**: prompt rule "different values = divergence" + a sanitizer that
  only checks value-distinctness, with no referent/satisfiability reasoning.
- **False negatives**: `statementSupportsClaim` bag-of-words filter silently dropping
  correct variants whose wording differs from the canonical.

Three changes, in leverage order: (1) rewrite the prompt's STATUS/RULES, (2) add a
divergence-adjudication pass over candidates, (3) loosen the support filter.

---

## 1. Rewritten prompt — `buildClaimAnalysisPrompt` system string

Replace the `STATUS DEFINITIONS` and `RULES` blocks (`prompts.ts:366-394`). Keep the
CLAIM TYPE DEFINITIONS and OUTPUT blocks as-is.

```text
STATUS DEFINITIONS:
Two facts belong to the SAME claim only if they describe the same REFERENT:
same subject, same scope/qualifier, and (for numbers) same unit and same thing
being counted. Different scope is a different claim, not a conflict.
  Examples of DIFFERENT referents (do NOT put in one claim):
    - "$300B reconstruction fund" (fund total) vs "$0 from the US" (one payer's share)
    - "5 dead" vs "5 hospitalized" (different outcome measured)
    - "6th PM in 7 years" vs "7th leader in a decade" (different time window)

- agreement: 2+ sources from 2+ lean groups assert the SAME referent with
  consistent values/details (rounding and vagueness-vs-precision still agree).
- divergence: 2+ sources assert the SAME referent but the assertions CANNOT BOTH
  BE TRUE AT ONCE (materially different value for the same quantity, contradictory
  date/outcome/attribution, or "X happened" vs "X did not happen"). Before choosing
  divergence, apply the JOINT-SATISFIABILITY TEST below. If both can be true, it is
  NOT divergence.
- framing: same referent, jointly-satisfiable facts, but materially different
  language that changes emphasis or characterization (e.g. "concession" vs "victory").
- exclusive_left / exclusive_right / exclusive_center: only sources of that one lean
  group report a substantive fact.

JOINT-SATISFIABILITY TEST (run for every candidate divergence):
- Ask literally: "Can all variant facts be true simultaneously in the real world?"
  If YES -> it is agreement (same value) or framing (different emphasis), NOT divergence.
- Money/resource claims are edges: type each as (payer -> payee, amount). Conflict
  ONLY when the SAME payer->payee pair disagrees on amount. A fund total and a single
  payer's contribution are different edges and are jointly satisfiable.
- A semantic or "just spin" surface does NOT downgrade a real contradiction. Strip the
  framing and test the underlying assertion: if the underlying facts cannot co-exist
  (e.g. "the fund is in the deal" vs "the fund is not in the deal"), it stays divergence.

RULES:
- A claim must be supported by >=1 input atomic fact. Never invent claims or values.
- Each variant must cite the exact articleIndex + factIndex of a supporting fact.
- RELEVANCE: ignore any fact not about THIS event (mis-clustered facts about other
  stories appear; do not group them, do not emit claims from them).
- Cluster by underlying referent, not surface wording. Synonyms and sentence-structure
  differences are agreement.
- Same outcome differing only in precision vs vagueness -> framing, not divergence.
- A story that advanced over time (earlier cautious report -> later confirmed update,
  by PublishedAt) is agreement on the latest state, NOT divergence. Classify by the
  most recent variant; you may lower confidence.
- divergence and framing each require >=2 variants from DISTINCT sources. agreement
  requires >=2 distinct sources. A lone substantive fact is exclusive_<lean>.
- Lower confidence when facts are sparse, hedged ("pledged to", "expected to", "could"),
  or when the referent match is uncertain. A hedged or contested divergence should have
  confidence <= 0.6.
- importance 1-5 = centrality to the event. Cap at 12 claims. Quality over quantity;
  fewer, well-grounded claims is correct.
- Do not mention URLs or article indexes in canonicalStatement.
```

Why this fixes FPs: the referent definition + joint-satisfiability test directly
target the `$300B`-vs-`$0` class, and the anti-spin clause prevents over-correcting
into "everything semantic is framing" (which would bury real text-vs-claim conflicts).
The RELEVANCE rule handles clustering contamination the prompt currently ignores.

---

## 2. Divergence-adjudication pass

A cheap second model call that runs **only on the divergence candidates** the first
pass produced. This is the highest-precision lever: it isolates the exact decision the
small model is worst at and gives it one focused, well-scoped question.

### Where it slots in

In `detectEventClaimsForInput` (`claimDivergenceNode.ts:504-570`), after
`sanitizeClaims`, before returning:

```
parsed -> sanitizeClaims -> adjudicateDivergences -> return
```

Operate on `StoredClaim[]`; only touch entries with `status === "divergence"`.
Non-divergence claims pass through untouched (no extra cost).

### Model

`gpt-5-mini` (not nano). It only sees the candidate claims, not the full event, so
input is small and the per-event cost is bounded (often 0 calls; 1 short call when
divergences exist). Worth the upgrade precisely because this is the reasoning step.

### Output schema (`json_schema`, strict)

```ts
const DIVERGENCE_ADJUDICATION_SCHEMA = {
  name: "DivergenceAdjudication",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            claimIndex: { type: "integer", minimum: 0 },
            sameReferent: { type: "boolean" },
            jointlySatisfiable: { type: "boolean" },
            // what it really is once the test is applied:
            verdict: {
              type: "string",
              enum: ["divergence", "agreement", "framing", "split"],
            },
            // confidence the adjudicator has in keeping it a divergence, 0-1;
            // used to down-weight hedged/contested conflicts.
            divergenceConfidence: { type: "number", minimum: 0, maximum: 1 },
            reason: { type: "string" }, // 1 sentence, for logs/QA
          },
          required: [
            "claimIndex",
            "sameReferent",
            "jointlySatisfiable",
            "verdict",
            "divergenceConfidence",
            "reason",
          ],
        },
      },
    },
    required: ["verdicts"],
  },
} as const;
```

### Prompt (system)

```text
You are a fact-conflict adjudicator. For each candidate claim, decide whether its
variants are a REAL divergence or a false positive.

Apply this test to every claim:
1. sameReferent: do all variants describe the same subject + same scope/qualifier +
   (for numbers) same unit and same thing measured? A fund total vs one payer's share,
   or two different time windows, are DIFFERENT referents.
2. jointlySatisfiable: can all variant facts be true at the same time in the real world?
   For money, type each as (payer -> payee, amount); only the same edge can conflict.
   Ignore rhetorical spin — test the underlying assertions.

Decide verdict:
- "divergence": sameReferent AND NOT jointlySatisfiable. Set divergenceConfidence;
  use <= 0.6 when any variant is hedged ("pledged to", "expected to", "could") or contested.
- "agreement": jointlySatisfiable AND values/outcomes effectively match.
- "framing": jointlySatisfiable but materially different emphasis/characterization.
- "split": the variants mix referents (e.g. a fund-total fact + a payer-share fact)
  and should be separated into more than one claim; explain the split in reason.

Return only JSON matching the schema. One verdict per claim, in input order.
```

### User payload builder

```ts
function buildAdjudicationUser(divergences: StoredClaim[]): string {
  return divergences
    .map((c, i) =>
      [
        `Claim ${i}: ${c.canonicalStatement}`,
        ...c.variants.map(
          (v) =>
            `  - [${v.sourceLean}] value=${v.value ?? "n/a"} :: ${v.statement}`,
        ),
      ].join("\n"),
    )
    .join("\n\n");
}
```

### Adjudicator + apply

```ts
async function adjudicateDivergences(
  ctx: ActionCtx,
  eventId: Id<"events">,
  claims: StoredClaim[],
  model: string, // e.g. "gpt-5-mini"
): Promise<StoredClaim[]> {
  const idx = claims
    .map((c, i) => (c.status === "divergence" ? i : -1))
    .filter((i) => i >= 0);
  if (idx.length === 0) return claims; // no cost when nothing to check

  const divergences = idx.map((i) => claims[i]);
  const resp = await callOpenAI<{ verdicts: AdjudicationVerdict[] }>({
    kind: "chat",
    model,
    temperature: 0,
    maxTokens: 700,
    responseFormat: { type: "json_schema", json_schema: DIVERGENCE_ADJUDICATION_SCHEMA },
    messages: [
      { role: "system", content: ADJUDICATION_SYSTEM },
      { role: "user", content: buildAdjudicationUser(divergences) },
    ],
    context: { callType: "claim_divergence_adjudication", eventId },
    runtime: ctx,
  });
  if (!resp.result) return claims; // fail-open to first-pass result

  const next = [...claims];
  for (const v of resp.result.verdicts) {
    const target = idx[v.claimIndex];
    if (target === undefined) continue;
    const claim = next[target];
    if (v.verdict === "divergence") {
      // keep, but never let confidence exceed the adjudicator's certainty
      next[target] = {
        ...claim,
        confidence: Math.min(claim.confidence, v.divergenceConfidence),
      };
    } else if (v.verdict === "agreement" || v.verdict === "framing") {
      next[target] = { ...claim, status: v.verdict };
    } else if (v.verdict === "split") {
      // v1: demote to agreement so we never ship a wrong conflict; flag for review.
      // v2: re-run a scoped decomposition call to emit multiple claims.
      next[target] = { ...claim, status: "agreement" };
      console.warn(`[claimDivergence] split candidate ${eventId}: ${v.reason}`);
    }
  }
  return next;
}
```

Notes:
- **Fail-open**: if the adjudicator errors, return the first-pass claims unchanged —
  never worse than today.
- **Demote-don't-delete** on `split` in v1: shipping a correct agreement beats shipping
  a wrong divergence. The log line surfaces split candidates for the v2 decomposition
  work (the manual event-2 rebuild is the worked example).
- **`agreement`/`framing` reclassification** can drop a claim below the 2-distinct-lean
  bar for agreement; run the existing status re-derivation (`sanitizeClaims` tail logic)
  once more after adjudication, or inline the same checks.

### Cost

Zero extra calls on events with no divergence candidate (the majority). One ~700-token
mini call otherwise. This is the cheapest place to spend a stronger model because it
runs rarely and on a tiny, focused input.

---

## 3. Loosen `statementSupportsClaim` (fix the false negatives)

`claimDivergenceNode.ts:294-344` deletes correct variants on surface-token mismatch
("US" vs "Washington", "funds" vs "provide"). The `factIndex` reference already prevents
hallucination, so this gate is redundant and over-aggressive.

Options, least to most invasive:
- **a.** Make it recall-oriented: keep a variant if `overlap >= 1` OR `valueMatch`
  (drop the `overlap >= 2 && ratio >= 0.25` requirement). Catches paraphrase.
- **b.** Trust the model's citation: keep any variant whose `factIndex` exists on the
  cited article; rely on the adjudication pass (#2) for correctness instead of a string
  filter. Simplest and removes the brittle heuristic entirely.
- **c.** If a semantic guard is still wanted, replace token-overlap with an embedding
  cosine between canonicalStatement and the fact (you already run embeddings elsewhere).

Recommend **(b)** + the adjudication pass: grounding is enforced by index reference,
classification correctness by the adjudicator. The bag-of-words filter goes away.

---

## Rollout / verification

- Gate all of this behind config keys (mirror `claim_analysis_*`): e.g.
  `claim_analysis_adjudication_enabled`, `claim_analysis_adjudication_model`.
- Build a small labeled set from the 4 hand-authored overrides in `/claim-overrides`
  (those are the ground truth) and diff pipeline output against them before/after.
- Watch the `claim_divergence_adjudication` callType in aiUsage for cost; expect it
  near-zero on agreement-heavy events.
```
