---
name: editorial-calm
description: Miez's UI design language — content sits on the page background, hierarchy comes from typography, whitespace and hairlines, never from boxes. Use this whenever you build, restyle or review any user-facing screen or component in apps/web or apps/native — a new page, a new section, a settings panel, a stats display, an empty state, a form, a loading state — and whenever the user says a screen looks cheap, generic, "AI-made", boxy, or asks you to make the UI look better, more tasteful, or more designed. Also consult it before reaching for the shared Card component, a `bg-card` panel, a tinted box, a dashed-border empty state, or an icon-in-a-coloured-square, so you can check whether that surface is actually earned.
---

# Editorial calm

The house style for Miez, on web and native. The app reads like a serious
broadsheet: **typography and whitespace carry the design.** Colour encodes
meaning in exactly one place — the bias distribution — and nowhere else.

## The problem this exists to prevent

Default LLM-authored UI reaches for a box. Every section becomes
`rounded-xl border bg-card shadow-sm p-6`, every number becomes a tile with a
tinted icon square, every empty state becomes a dashed rectangle. Nothing is
individually wrong, and the result still reads as cheap and machine-made —
because the boxes are doing work that hierarchy should be doing. When every
zone is equally boxed, the boxes stop meaning anything; they're just noise
between the reader and the text.

Real hierarchy is cheaper and reads better: a heading, a hairline, and space.

## The rule

**Sections are not surfaces.** Page content sits directly on `bg-background`.
A section does not get a box around it to prove that it is a section.

A surface — `bg-card` + border + radius + shadow — is only earned by:

| Earned                                         | Why                                     |
| ---------------------------------------------- | --------------------------------------- |
| Overlays: dialog, popover, dropdown, toast      | They genuinely float above the page     |
| Media frames: images, logos, thumbnails         | The border frames media, not content    |
| Interactive controls: inputs, selectable options| The border *is* the affordance          |
| `/admin/*`                                      | Operator tooling, not the product       |

Everything else — summaries, settings, stats, activity, forms, CTAs, empty
states, loading states — renders on the page.

If you're unsure whether a box is earned, ask what breaks without it. If the
answer is "nothing, it just looks less designed", delete it.

## Patterns

### A zone

```tsx
<section className="mt-10 border-t border-border pt-6">
  <SectionTitle>Ce înseamnă asta</SectionTitle>
  <p className="mt-1 text-sm text-muted-foreground">Supporting line</p>
  <div className="mt-5">{content}</div>
</section>
```

Rhythm: `mt-8`/`mt-10` + hairline + `pt-6`. That's the separator. Not a box.

### Repeated items

Hairline-separated rows, the same anatomy the feed uses — never a grid of
bordered tiles. Recognition over novelty: a saved story and a feed story
should look like the same kind of thing.

```tsx
<div className="divide-y divide-border">
  {items.map((item) => <Row key={item.id} item={item} />)}
</div>
```

### Figures

A numeral carries its own weight. It does not need a tile or an icon chip.

```tsx
<div>
  <p className="text-3xl font-semibold tabular-nums tracking-tight">{value}</p>
  <p className="mt-1 text-sm text-muted-foreground">{label}</p>
</div>
```

`tabular-nums` on anything numeric, always — figures that change shouldn't
make the layout twitch.

### Empty states

One typographic line, and at most one action. Dashed boxes and icon circles
are banned outright — they're the single loudest "generated" tell in a UI.

```tsx
<p className="text-sm text-muted-foreground">{t("activity.savedEmpty")}</p>
```

### Loading states

Skeletons mirror the geometry of the content they stand in for, so nothing
shifts when data lands — and so the loading screen doesn't promise card chrome
the loaded page doesn't have.

### Navigation

Links look like links or like rows, not like cards. A "quick action" is a row
with a chevron, not a bordered panel with a coloured icon square.

## Type

- Titles are `font-semibold`. `font-bold` is not used — the app has no weight
  above semibold, and reaching for one is usually a sign that the hierarchy
  around it is too weak.
- Zone headings go through `<SectionTitle>` (`text-base font-semibold`).
  Five competing 25px headlines on one screen is not hierarchy, it's a shouting
  match; hierarchy runs label → content.
- All-caps tracked eyebrows (`uppercase tracking-[0.2em]`) are reserved for the
  feed's topic kicker. Elsewhere a plain `text-sm text-muted-foreground` line
  does the same job without shouting.
- Prose `max-w-[65ch]`, descriptions `max-w-[55ch]`. Body leading comes from
  the global base — don't re-declare it per paragraph.

## Colour

Semantic tokens only (`text-foreground`, `bg-muted`, `text-destructive`, …) —
never raw Tailwind palette classes. A test enforces this.

Status reads as coloured *text*, not as a tinted chip: `text-success` with a
glyph beats a `bg-success/10 rounded-full` pill. Tinted-panel backgrounds
(`bg-primary/5`, `bg-muted/40`) are the card habit wearing a different hat — if
something genuinely needs setting apart inside a zone, a `border-l-2` rule with
padding does it more quietly than a fill.

## Motion

Press scale 0.97 at 120–160ms, content swaps 150ms opacity, sheets and toasts
200–250ms. Nothing over 300ms. Springs only on gestures. Scroll-linked chrome
motion on high-frequency screens is rejected on purpose — the masthead holds
still.

## Before you call a screen done

Look at it and ask:

1. Could any box here be deleted with nothing lost? Delete it.
2. Is anything `font-bold`, dashed, or an icon-in-a-tinted-square? Fix it.
3. Do repeated items read as rows, or as a pile of tiles?
4. Does the same kind of content look the same as it does elsewhere in the app?
5. Does colour appear anywhere it isn't carrying meaning?

Then run the design-system tests — they fail the build on card surfaces,
dashed empty states, hardcoded palette classes and the old heading treatment:

```bash
cd apps/web && npx vitest run src/design-system.test.ts
```

## Where the details live

- `apps/web/DESIGN_SYSTEM.md` — tokens, scale, containers, the surfaces rule
- `apps/native/DESIGN_LOG.md` — the native pass, and the rejected alternatives
  with reasons. Read it when a decision feels arbitrary; it usually records
  why the obvious thing was tried and dropped.
- `references/before-after.md` — worked examples from the web restyle
