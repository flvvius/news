# Project working agreements

## Do the AI work yourself — don't pay another provider's API per-token

When a task needs an LLM to do reasoning/labeling/extraction/judgment work as part of the
*workflow* (e.g. drafting eval labels, classifying, summarizing, adjudicating), **do it yourself
(Claude)**. Do NOT call another provider's model (OpenAI/GPT, Gemini, etc.) over a pay-per-token
API to do work you can already do.

**Why:** those API calls cost real money (token billing, separate from the Claude subscription).
In the claim gold-set task the gpt-5 / o4-mini drafting calls were unnecessary and burned OpenAI
quota — Claude could (and ultimately did) produce those labels directly, for free, from the start.

**How to apply:**
- Default to doing LLM-shaped sub-steps inline with your own reasoning.
- Process at scale by batching over extracted records (read data → reason → write structured
  output), not by fanning out to a paid external model.
- Only call a paid third-party model if the user explicitly asks for it, or if it provides
  something you genuinely cannot (e.g. a required *independent* second opinion for cross-model
  disagreement) — and confirm the token spend first.
- This does NOT restrict the product's own pipeline code (which legitimately calls models). It's
  about how *I* carry out tasks.
