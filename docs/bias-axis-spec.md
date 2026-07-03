# Bias axis specification: reformist ↔ suveranist (BIV-301)

**Status:** Approved for launch · **Owner:** product · **Last updated:** 2026-07-02

## Why not left–right

The US-style left↔right economic/social axis explains Romanian media alignment
poorly. The live, legible cleavage in Romanian public debate — the one outlets
actually sort themselves along — is between a pro-European/reformist camp and a
suveranist (sovereigntist) camp. Mapping Romanian outlets onto left–right
produces scores nobody recognizes; mapping them onto reformist↔suveranist
matches how readers already perceive them.

## The axis

One axis. Score range **−5 … +5** (unchanged from the previous scale).

| Score | Pole | Reading |
|------:|------|---------|
| −5 | reformist | strongly pro-european/reformist framing |
| 0 | neutral | wire-style, framing not detectable |
| +5 | suveranist | strongly suveranist framing |

Machine name: `reformist_suveranist`. Negative = reformist, positive =
suveranist. The sign convention is arbitrary and carries **no** value judgment;
it exists so existing −5..+5 plumbing (thresholds, aggregation, the −100..+100
`biasBalance` stat) keeps working unchanged.

## Pole definitions — in each camp's own terms

Both labels are **self-adopted terms**, not exonyms, deliberately avoiding
virtue-loaded framing (e.g. "pro-democracy vs. anti-democracy",
"pro-West vs. pro-Russia" are all banned as labels).

### Reformist / pro-european (−)

Framing that foregrounds: EU and NATO integration as the default good;
rule-of-law institutions (DNA, CCR compliance, judicial independence) as
needing strengthening; anti-corruption as the central political problem;
alignment with Brussels policy directions (green transition, digitalization);
skepticism toward the traditional patronage parties and the Church's role in
policy.

### Suveranist (+)

Framing that foregrounds: national sovereignty against Brussels overreach;
skepticism of EU mandates (currency, migration quotas, green policy costs);
traditional and religious values as under threat; protection of national
capital and agriculture; "foreign interests" / multinationals / Soros-funded
NGOs as recurring antagonists; the anti-corruption apparatus as having been
abused ("binomul", "statul paralel").

### Neutral (0)

Wire-service style: symmetric attribution, descriptive language, no camp's
vocabulary adopted as the article's own voice. Agerpres straight news is the
anchor example.

## What the score measures

The score rates **framing of the coverage**, not the topic and not the outlet's
audience. An article about an AUR rally is not suveranist because of its
subject; it is scored by whose vocabulary and whose framing the article adopts
as its own voice. Signals: word choice adopted un-quoted ("statul paralel" vs.
"instituțiile de forță"), which voices are quoted and rebutted, what is
presupposed vs. attributed.

## Visual language

Keep the existing neutral **indigo ↔ amber** palette already used by the bias
UI: indigo = reformist pole, amber = suveranist pole. **No flag colors, no
red/blue, no good/bad connotation** (green/red is banned). Poles render with
equal visual weight.

## UI copy (finalized labels)

| Context | Label (ro) | Label (en) |
|---|---|---|
| Negative pole | Reformist | Reformist |
| Positive pole | Suveranist | Sovereigntist |
| Center | Neutru | Neutral |
| Perspective summary keys | `neutral` / `reformist` / `suveranist` | same |
| Perspective display names | „Neutru" / „Formulare reformistă" / „Formulare suveranistă" | "Neutral" / "Reformist framing" / "Sovereigntist framing" |

The perspective sections describe **framing**, not endorsement — copy must
always say "formulare/framing", never "the suveranist truth" or similar.
(BIV-805: the earlier „cadrare" was a literal calque of "framing" and is not
idiomatic Romanian in this sense; „formulare"/„mod de formulare" is the
correct term and is banned-term-tested in the i18n catalog.)

## Explicitly out of scope for launch

- **A second (economic) axis.** The schema stores the axis name
  (`{ axis: "reformist_suveranist", score }`, BIV-302) precisely so an
  additional axis later is additive, not a migration. No grid UI, no second
  axis until there is evidence the single axis is insufficient.
- **Diaspora/urban–rural or other cleavages** — not modeled.
- **Full political-compass placement of politicians** — we score coverage
  framing only.

## Downstream consumers

- BIV-302: `sources.bias` and `articles.aiBias` named-axis objects.
- BIV-303: `perspectiveSummaries.neutral/reformist/suveranist` + BiasIndicator
  labels.
- BIV-202: prompt templates define the axis for the scorer using the pole
  definitions above (translated to Romanian in the prompt).
- BIV-401: hand-assigned per-source axis scores with provenance notes.
