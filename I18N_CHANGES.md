# I18N_CHANGES — Romanian static-text audit (BIV-805)

Audit of every static Romanian string in `packages/i18n/src/strings.ts` (the
single catalog consumed by web + native) plus the two user-visible Romanian
fallback strings produced by the backend. Each change lists old → new with a
one-line rationale. A native-speaker review checklist is at the bottom.

## The framing term ("cadrare" → "formulare")

"Cadrare" is a literal calque of English *framing*; in Romanian it reads as
photography/carpentry vocabulary, not media analysis. The idiomatic term for
"how a story is phrased" is **formulare** (or *mod de formulare*); when
describing a *source's* leaning, **orientare** is the natural word.

| Key | Old | New | Rationale |
|---|---|---|---|
| `event.left` | Cadrare reformistă | **Formulare reformistă** | framing calque; tab label on event detail |
| `event.right` | Cadrare suveranistă | **Formulare suveranistă** | same |
| `claim.framing` | Încadrare | **Formulare** | same calque, claims UI badge |
| `claim.framings` | Diferențe de încadrare | **Diferențe de formulare** | matches `claim.framingBody` ("fapte comune descrise cu limbaj diferit") |
| `event.biasDistribution` | Distribuția cadrărilor surselor: … | **Distribuția orientării surselor: …** | describes source leanings, not article phrasing |
| `onboarding.promise.cardSummary` | …compară cum **încadrează stânga, centrul și dreapta** același rezultat. | …compară cum **prezintă sursele reformiste, neutre și suveraniste** același rezultat. | removes the calqued verb AND the left/right vocabulary (axis is reformist↔suveranist) |

Also updated `docs/bias-axis-spec.md` (perspective display names table + the
"always say cadrare/framing" note) so spec and UI vocabulary match.

## Axis vocabulary (left/right → reformist/suveranist)

The bias axis is reformist↔suveranist (docs/bias-axis-spec.md); "stânga /
dreapta" in UI copy contradicts the product's own vocabulary.

| Key | Old | New |
|---|---|---|
| `claim.leftExclusive` | Exclusiv din stânga | **Exclusiv reformist** |
| `claim.leftExclusives` | Exclusive din stânga | **Exclusive reformiste** |
| `claim.leftExclusiveBody` | …doar în surse de stânga sau centru-stânga. | …doar în surse reformiste sau apropiate de polul reformist. |
| `claim.rightExclusive` | Exclusiv din dreapta | **Exclusiv suveranist** |
| `claim.rightExclusives` | Exclusive din dreapta | **Exclusive suveraniste** |
| `claim.rightExclusiveBody` | …doar în surse de dreapta sau centru-dreapta. | …doar în surse suveraniste sau apropiate de polul suveranist. |
| `claim.centerExclusive` | Exclusiv din centru | **Exclusiv neutru** |
| `claim.centerExclusives` | Exclusive din centru | **Exclusive neutre** |
| `claim.centerExclusiveBody` | …doar în surse de centru. | …doar în surse neutre. |

(The claims UI is currently hidden — BIV-804 — but the strings ship in the
catalog and the native app references the same concepts.)

## Anglicisms and awkward literals

| Key | Old | New | Rationale |
|---|---|---|---|
| `source.rollingSample` | Eșantion AI rolling | **Eșantion AI glisant** | "fereastră glisantă" is the standard RO term for a rolling window |
| `scroll.depth` | {count}% profunzime | **{count}% derulat** | "profunzime" is depth-of-water; scrolled-percentage reads naturally as "derulat" |
| `unsubscribe.goHome` | Mergi la început | **Mergi la pagina principală** | "la început" reads as "to the beginning (of the text)" |
| `quiz.type.factCheck` | Fact check | **Verificare factuală** | untranslated anglicism (quiz currently hidden, string kept correct) |

## Orthography and consistency

| Key(s) | Old | New | Rationale |
|---|---|---|---|
| `auth.resetSendingStatus`, `unsubscribe.errorBody` | emailul | **e-mailul** | the catalog standard everywhere else is "e-mail" |
| `auth.signUpSubtitle`, `saved.browseFeed`, `activity.feedCard`, `native.feed.errorTitle` | feed-ul | **feedul** | DOOM3: adapted loanwords whose spelling reads natively attach the article directly (cf. existing "feedul" in `auth.accountIntro`, `onboarding.topics.*`) |
| `activity.empty.body`, `activity.loading.body` | streak-urile | **streakurile** | same rule; catalog already uses "streakul" unhyphenated |

## Backend user-visible fallbacks (stored as perspective summaries)

| Location | Old | New |
|---|---|---|
| `packages/backend/convex/prompts.ts` `LIMITED_COVERAGE_FALLBACK` | Acoperire limitată din partea surselor cu **cadrare** reformistă/suveranistă. | …cu **orientare** reformistă/suveranistă. |
| `SIDE_COVERAGE_FALLBACK` (moved from `summarizationNode.ts` into `prompts.ts` so tests can lint it) | Acoperirea disponibilă nu oferă încă o **cadrare** distinctă din această parte. | …o **perspectivă** distinctă din această parte. |

**Deliberately unchanged:** the LLM-internal prompt vocabulary in
`prompts.ts` (`cadrareaSursei`, "AXA DE CADRARE", case instructions). It is
model-facing, never rendered to users, and pinned by `prompts.test.ts` and
the BIV-701 eval harness; renaming it is prompt-engineering churn with no
user-visible benefit. Existing DB rows that contain the *old* fallback
sentences keep them until the pipeline regenerates those events.

## Reviewed and left as-is (deliberate)

- **"bias"** (activity/bias meter, source profiles): kept as the product term;
  "părtinire" is heavier and the axis labels carry the meaning.
- **"streak"** (gamification): kept; no natural short RO equivalent
  ("serie de zile" is wordy), and it is used consistently.
- `coverage.left` "Reformist / pro-european": matches the pole definition
  heading in the axis spec.
- Placeholder footer strings (`page.*.body` "Pagina este în lucru…"): real
  content lands in BIV-803, not rephrased here.

## Enforcement

`apps/web/src/lib/i18n/strings.test.ts` fails if any RO value matches the
banned-term list (`cadrare`, `încadrare`, `exclusiv din stânga/dreapta/centru`,
`rolling`, `feed-ul`, `streak-ur…`), and pins the corrected labels.

## Native-speaker review checklist

- [ ] `event.left` / `event.right`: does „Formulare reformistă/suveranistă"
      read naturally as a tab label next to „Neutru"? (Alternatives
      considered: „Unghi reformist", „Perspectivă reformistă".)
- [ ] `event.biasDistribution`: „Distribuția orientării surselor" — natural?
- [ ] `claim.*Exclusive*`: „Exclusiv reformist/suveranist/neutru" — clear
      without the „din stânga/dreapta" spatial metaphor?
- [ ] `scroll.depth`: „{count}% derulat" — acceptable as a compact stat?
- [ ] `source.rollingSample`: „Eșantion AI glisant" — or prefer „Eșantion AI
      recent"?
- [ ] Hyphenation normalization („feedul", „streakurile") — agree with DOOM3
      attached forms?
- [ ] Backend fallbacks: „…surselor cu orientare reformistă." and „…nu oferă
      încă o perspectivă distinctă din această parte." — natural?
- [ ] Anything in the "left as-is" list you would still change?
