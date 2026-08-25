# Worked examples

Real diffs from the web restyle. Read these when you can see that something is
boxy but can't picture what replaces it.

## 1. A content section that was a tinted panel

The event-detail "Ce înseamnă asta" impact block.

```tsx
// Before — the box was justified in a comment as giving the section
// "its own surface instead of being a fourth identical paragraph"
<section className={`${sectionBreak} space-y-3`}>
  <SectionTitle>{t("event.meaning")}</SectionTitle>
  <div className="rounded-lg border border-border bg-muted/40 p-4 sm:p-5">
    <SummaryBody … />
  </div>
</section>

// After — the zone title and the section hairline already separate it
<section className={`${sectionBreak} space-y-3`}>
  <SectionTitle>{t("event.meaning")}</SectionTitle>
  <SummaryBody … />
</section>
```

The lesson generalises: when you catch yourself writing a comment to justify a
surface, the surface is doing a job the layout should already be doing.

## 2. Stat tiles → figures

The activity page's four-tile "bento grid".

```tsx
// Before — bordered tile, tinted icon square, bold numeral
<div className="rounded-xl border border-border bg-card p-4 sm:p-5">
  <div className="flex items-center gap-3">
    <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
      <Flame className="size-5 text-primary" />
    </div>
    <div>
      <p className="text-2xl font-bold tabular-nums">{readingStreak}</p>
      <p className="text-xs text-muted-foreground">{t("activity.dayStreak")}</p>
    </div>
  </div>
</div>

// After — the numeral is the design
<div>
  <p className="text-3xl font-semibold tabular-nums tracking-tight">{value}</p>
  <p className="mt-1 text-sm text-muted-foreground">{label}</p>
  {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
</div>
```

The icons went entirely. Seven decorative icons on the native settings screen
"added noise, not scent" — the same held here.

## 3. Panel → zone

```tsx
// Before
<div className="rounded-xl border border-border bg-card p-6">
  <h2 className="font-semibold">{t("activity.biasBalance")}</h2>
  <p className="text-sm text-muted-foreground">{t("activity.biasMix")}</p>
  <div className="mt-5"><BiasBalanceMeter value={biasBalance} /></div>
</div>

// After
<section className="mt-10 border-t border-border pt-6">
  <SectionTitle>{t("activity.biasBalance")}</SectionTitle>
  <p className="mt-1 text-sm text-muted-foreground">{t("activity.biasMix")}</p>
  <div className="mt-6 max-w-xl"><BiasBalanceMeter value={biasBalance} /></div>
</section>
```

## 4. Dashed empty state → one line

```tsx
// Before
<div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
  {t("activity.readingHistoryEmpty")}
</div>

// After
<p className="text-sm text-muted-foreground">
  {t("activity.readingHistoryEmpty")}
</p>
```

## 5. Card-shaped nav → rows

```tsx
// Before — two bordered panels with coloured icon squares
<Link className="group flex items-center gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/50 hover:bg-primary/5">
  <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary …">
    <Newspaper className="size-6" />
  </div>
  <div>…</div>
</Link>

// After — navigation that reads as navigation
<nav className="mt-10 divide-y divide-border border-t border-border">
  <Link className="group flex items-center justify-between gap-4 py-4">
    <div>
      <p className="text-sm font-medium transition-colors group-hover:text-primary">{title}</p>
      <p className="mt-0.5 text-sm text-muted-foreground">{body}</p>
    </div>
    <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
  </Link>
</nav>
```

## 6. Settings as a card stack → hairline rows

The profile page was five stacked `<Card>`s in a two-column grid. It became one
column, `max-w-2xl`: identity header, then zones, with each setting a row —
label and description left, control right, `divide-y divide-border` between.

```tsx
<div className="mt-5 divide-y divide-border">
  <div className="flex flex-col gap-4 pb-5 sm:flex-row sm:items-center sm:justify-between">
    <div className="space-y-1">
      <p className="text-sm font-medium text-foreground">{t("settings.language")}</p>
      <p className="max-w-[55ch] text-sm text-muted-foreground">{t("profile.settingsBody")}</p>
    </div>
    <LanguagePicker />
  </div>
  …
</div>
```

## 7. Two tab languages → one

The event screen had pill-in-a-track tabs on the outside and underline tabs
inside. Two tab idioms on one screen is a tell. The outer bar adopted the inner
one's underline treatment; the perspective tabs keep their bias-token underline
colour, the outer bar uses `border-foreground`.

## 8. Pills → a meta line

The source profile carried three separate pill chips (bias label, reliability,
domain). They became one muted line with `·` separators, and the domain became
a plain link. Same information, a third of the ink.

## What was deliberately left boxed

- Quiz answer options keep `rounded-xl border` — there the border is the
  control, and selection state needs somewhere to land.
- Image frames keep `rounded-lg border border-border bg-muted` with
  `overflow-hidden` — that's a frame with a placeholder behind it.
- Form inputs keep their borders, obviously.
- `/admin/*` still uses `<Card>`. Dense operator screens have different needs,
  and they're not the product.

That list is the point: the rule isn't "no borders ever", it's "a border has to
be doing a job".
