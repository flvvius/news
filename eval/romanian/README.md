# Romanian output eval harness (BIV-701)

Repeatable eval that gates the Romanian launch and triggers BIV-203
(two-stage escalation) / BIV-603 (NER microservice) if it fails. It runs
the **production prompts** (`packages/backend/convex/prompts.ts`) against
the configured model and scores three things.

## Metrics and pass/fail bars

| Metric | How it's scored | Pass bar | Hard fail |
|---|---|---|---|
| Language + schema | deterministic (`looksRomanian` on every output field + strict schema parse) | **100%** Romanian and schema-valid | any English leakage or invalid JSON |
| Summary faithfulness | judge model lists unsupported claims vs the supplied articles | ≥ **95%** of checked claims supported | < 90% → block launch, consider BIV-203 |
| Named-entity accuracy | judge model lists entity errors (politicians, parties, counties) | ≥ **95%** entities correct | < 90% → block launch, consider BIV-603 |
| Bias-score sanity | deterministic: side summaries must be backed by sources on that pole of the reformist↔suveranist axis (reputation seed), and 2+ articles on a pole must not yield the fallback | ≥ **80%** of events with zero sanity issues | < 80% → review prompts / BIV-203 |

The judge model defaults to `gemini-3.5-flash` (stronger than the
generator, still managed — ADR-001). Judge outputs are spot-checked by a
human on the first baseline run; unsupported-claim lists are stored
verbatim in the results file for that purpose.

## Workflow

```bash
# 1. After a few days of Romanian ingestion, export a read-only snapshot:
npx convex export --path /tmp/snapshot.zip && unzip /tmp/snapshot.zip -d /tmp/snapshot
mkdir -p eval/romanian/data
for t in events articles sources topics eventTopics; do
  cp /tmp/snapshot/$t/documents.jsonl eval/romanian/data/$t.jsonl
done

# 2. Build the sample (50-100 articles across topics):
pnpm exec tsx eval/romanian/build-sample.ts --events 25

# 3. Estimate before spending (no API calls):
pnpm exec tsx eval/romanian/run-eval.ts --dry-run

# 4. Run in small batches (default 10 events/run; keep batches small):
pnpm exec tsx eval/romanian/run-eval.ts --limit 10
pnpm exec tsx eval/romanian/run-eval.ts --limit 10 --offset 10   # next batch
pnpm exec tsx eval/romanian/run-eval.ts --limit 10 --offset 20   # and so on
```

Requires `GEMINI_API_KEY` (and `OPENAI_API_KEY` for gpt-* comparisons) in
env or `eval/romanian/.env.local` (gitignored).

## Baseline record

Re-run and append here whenever the model or the prompts change
(`SUMMARY_PROMPT_VERSION` bumps in summarizationNode.ts are the usual
trigger).

| Date | Model | Judge | Events | RO+schema | Faithfulness | Entity acc. | Bias sanity | Verdict |
|---|---|---|---|---|---|---|---|---|
| — | gemini-3.1-flash-lite | gemini-3.5-flash | — | — | — | — | — | pending first Romanian data |

## Files

- `build-sample.ts` — snapshot → `out/sample.json` (round-robin across topics).
- `run-eval.ts` — generate → deterministic checks → judge → `out/results-*.json`.
- `data/` and `out/` are gitignored working directories except this README
  and the committed baseline results once reviewed.
