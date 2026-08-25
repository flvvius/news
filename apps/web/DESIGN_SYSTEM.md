# Biviant Design System

This document defines the visual language for Biviant's web app. Every new component, page, or feature **must** follow these conventions to keep the UI consistent and on-brand.

---

## Table of Contents

1. [Philosophy](#philosophy)
2. [Color System](#color-system)
3. [Bias Spectrum](#bias-spectrum)
4. [Typography](#typography)
5. [Layout & Spacing](#layout--spacing)
6. [Components](#components)
7. [Do's & Don'ts](#dos--donts)

---

## Philosophy

Biviant is a multi-perspective news platform. The design must feel **neutral, trustworthy, and calm** — never partisan, never loud. Users should focus on the content, not the chrome.

Key principles:

- **Warm neutrals** over pure grays — subtle warmth keeps the interface approachable without feeling cold or clinical.
- **Desaturated brand color** — a muted blue that conveys trust without political association.
- **Non-political bias colors** — indigo/gray/amber instead of blue/red to avoid reinforcing partisan framing.
- **Content-first typography** — readable line lengths, relaxed leading, clear hierarchy.
- **No chrome for its own sake** — sections live on the page background; boxes,
  tints and shadows are earned, not default.

---

## Color System

All colors are defined as CSS custom properties in `src/index.css` using **oklch** for perceptual uniformity. They are exposed as Tailwind classes via `@theme inline`.

### How to use colors

Always use semantic token classes. **Never use hardcoded Tailwind color classes** like `text-gray-500`, `bg-blue-600`, `text-red-500`, etc.

| Intent                        | Correct                      | Wrong                               |
| ----------------------------- | ---------------------------- | ----------------------------------- |
| Page background               | `bg-background`              | `bg-white`, `bg-gray-50`            |
| Primary text                  | `text-foreground`            | `text-gray-900`, `text-black`       |
| Secondary text                | `text-muted-foreground`      | `text-gray-500`, `text-gray-400`    |
| Card surface                  | `bg-card`                    | `bg-white`                          |
| Card text                     | `text-card-foreground`       | `text-gray-900`                     |
| Brand action (buttons, links) | `bg-primary`, `text-primary` | `bg-blue-600`, `text-blue-600`      |
| Borders                       | `border-border`              | `border-gray-200`                   |
| Form inputs                   | `border-input`, `bg-input`   | `border-gray-300`                   |
| Error text                    | `text-destructive`           | `text-red-500`, `text-red-600`      |
| Success text                  | `text-success`               | `text-green-600`, `text-green-500`  |
| Warning                       | `text-warning`               | `text-yellow-600`, `text-amber-500` |
| Subtle background             | `bg-muted`, `bg-muted/30`    | `bg-gray-50`, `bg-gray-100`         |
| Interactive hover             | `bg-accent`                  | `bg-gray-100`                       |

### Core palette (light mode)

| Token                | oklch Value      | Role                                        |
| -------------------- | ---------------- | ------------------------------------------- |
| `--background`       | `0.99 0.002 80`  | Page background — near-white with warm tint |
| `--foreground`       | `0.15 0.01 60`   | Primary text — warm near-black              |
| `--primary`          | `0.45 0.1 250`   | Brand blue — desaturated, trustworthy       |
| `--muted`            | `0.955 0.004 80` | Subtle background surfaces                  |
| `--muted-foreground` | `0.50 0.01 60`   | Secondary/helper text                       |
| `--border`           | `0.91 0.004 80`  | Borders — warm, not stark                   |
| `--destructive`      | `0.577 0.245 27` | Error/danger                                |
| `--success`          | `0.55 0.14 155`  | Success feedback                            |
| `--warning`          | `0.75 0.15 75`   | Warning feedback                            |

### Dark mode

Dark mode tokens are defined under `.dark` in `index.css`. They follow the same naming convention but with values adjusted for dark backgrounds:

- Backgrounds use a cool-tinted dark (`oklch 0.14 0.008 270`).
- Primary shifts lighter (`0.65 0.12 250`) so it remains visible.
- Bias colors are lifted slightly for contrast on dark surfaces.

All token classes automatically adapt — no conditional logic needed in components.

---

## Bias Spectrum

Biviant's bias indicator intentionally avoids the culturally loaded red/blue political palette.

| Bias Range             | Token                | Color         | Tailwind Class                     |
| ---------------------- | -------------------- | ------------- | ---------------------------------- |
| Strong Left (< -2)     | `--bias-left`        | Muted indigo  | `bg-bias-left`, `text-bias-left`   |
| Lean Left (-2 to -0.5) | `--bias-left-muted`  | Softer indigo | `bg-bias-left-muted`               |
| Center (-0.5 to 0.5)   | `--bias-center`      | Warm gray     | `bg-bias-center`                   |
| Lean Right (0.5 to 2)  | `--bias-right-muted` | Softer amber  | `bg-bias-right-muted`              |
| Strong Right (> 2)     | `--bias-right`       | Muted amber   | `bg-bias-right`, `text-bias-right` |
| Track background       | `--bias-track`       | Light neutral | `bg-bias-track`                    |

### Usage

Use the `<BiasIndicator>` component (`src/components/bias-indicator.tsx`). It accepts:

```tsx
<BiasIndicator bias={-3.5} size="sm" />  // "Left" in muted indigo
<BiasIndicator bias={0} size="md" />      // "Center" in warm gray
<BiasIndicator bias={2.5} size="lg" />    // "Right" in muted amber
```

**Never** use raw red/blue classes (`bg-red-500`, `bg-blue-500`) for anything related to political bias or perspective.

---

## Typography

### Font Stack

```
Inter → ui-sans-serif → system-ui → sans-serif
```

Inter is loaded as the primary font. No secondary or monospace font is currently needed for user-facing content.

### Scale & Hierarchy

| Element              | Size                                               | Weight          | Extra                   |
| -------------------- | -------------------------------------------------- | --------------- | ----------------------- |
| Page title (h1)      | `text-3xl` to `text-4xl` (md: `text-6xl` for hero) | `font-semibold` | `tracking-tight`        |
| Zone heading (h2)    | `text-base` via `<SectionTitle>`                   | `font-semibold` | —                       |
| Row title (h3)       | `text-lg`                                          | `font-semibold` | `leading-snug`          |
| Body text            | `text-sm` to `text-base`                           | `font-normal`   | `leading-relaxed`       |
| Helper/meta text     | `text-xs` to `text-sm`                             | `font-medium`   | `text-muted-foreground` |
| Labels               | `text-sm`                                          | `font-medium`   | —                       |

### Line Length

Body text blocks should be constrained for readability:

- **Prose / summaries**: `max-w-[65ch]`
- **Subtitles / descriptions**: `max-w-[55ch]`
- **Full-width layouts** (forms, lists): No `max-w` on the text itself — the container handles width.

### Body Base

The `<body>` has `leading-relaxed` applied globally via `@layer base` in `index.css`. You don't need to add it to every paragraph — only override when tighter leading is needed (e.g., `leading-snug` on row titles).

---

## Layout & Spacing

### Containers

| Context                        | Max Width                                                    | Padding      |
| ------------------------------ | ------------------------------------------------------------ | ------------ |
| Main content (feed, events)    | `max-w-4xl`                                                  | `px-4 py-8`  |
| Landing page sections          | `max-w-5xl` (hero), `max-w-4xl` (content), `max-w-3xl` (CTA) | `px-4 py-16` |
| Standalone pages (unsubscribe) | `max-w-md`                                                   | `p-10`       |

Always use `container mx-auto` for horizontal centering.

### Surfaces — sections are not cards

**Editorial calm.** Page content sits directly on `bg-background`. Typography,
whitespace and hairlines carry the hierarchy; a section does not get a box
around it to prove it is a section. This mirrors the native app's direction
(`apps/native/DESIGN_LOG.md`) — the web app follows the same rules.

A **zone** is built like this:

```tsx
<section className="mt-10 border-t border-border pt-6">
  <SectionTitle>Ce înseamnă asta</SectionTitle>
  <p className="mt-1 text-sm text-muted-foreground">Supporting line</p>
  <div className="mt-5">{content}</div>
</section>
```

Repeated items inside a zone are **hairline-separated rows**
(`divide-y divide-border`), the same anatomy the feed already uses — never a
grid of bordered tiles.

Figures are **typographic**, not tiles: a large `tabular-nums` numeral with a
small muted label under it. No icon-in-a-tinted-square next to it.

Empty states are **one line of muted text plus, at most, one action**. Dashed
boxes and icon circles are banned.

**A surface (`bg-card` + border + radius + shadow) is only for:**

| Allowed                                       | Why                                     |
| --------------------------------------------- | --------------------------------------- |
| Overlays: dialog, popover, dropdown, toast     | They genuinely float above the page     |
| Media frames: images, logos, thumbnails        | A border here frames media, not content |
| Interactive controls: inputs, buttons, options | The border is the hit target/affordance |
| `/admin/*` internal tooling                    | Dense operator screens, not the product |

Everything else — summaries, settings blocks, stats, activity panels, auth
forms, empty states, CTAs — renders on the page background. The `<Card>`
component still exists for the admin routes; **do not** reach for it on a
user-facing screen. The `design-system.test.ts` suite fails the build if a
card surface reappears outside the allowed list.

### Section separators

- Between zones: `mt-8`/`mt-10` + `border-t border-border` + `pt-6`.
- Between rows in a list: `divide-y divide-border`.
- Prefer `border-b` / `border-t` over `<hr>` inside content areas.

### Weight

Titles are `font-semibold`, never `font-bold`. All-caps tracked eyebrows
(`uppercase tracking-[0.2em]`) are reserved for the feed's topic kicker — a
plain `text-sm text-muted-foreground` line does the same job elsewhere without
shouting.

### Border Radius

| Token         | Value                       | Use Case             |
| ------------- | --------------------------- | -------------------- |
| `--radius-sm` | `calc(0.5rem - 2px)` (6px)  | Small chips, badges  |
| `--radius-md` | `0.5rem` (8px)              | Buttons, inputs      |
| `--radius-lg` | `calc(0.5rem + 2px)` (10px) | Cards inner elements |
| `--radius-xl` | `calc(0.5rem + 6px)` (14px) | Modals, large cards  |

---

## Components

### Buttons

Use the `<Button>` component from `src/components/ui/button.tsx`. Available variants:

| Variant       | When to Use                                  |
| ------------- | -------------------------------------------- |
| `default`     | Primary actions (submit, CTA)                |
| `outline`     | Secondary actions, topic filters             |
| `secondary`   | Alternative actions with less emphasis       |
| `ghost`       | Tertiary actions, icon buttons               |
| `destructive` | Dangerous/irreversible actions               |
| `link`        | Inline text links that need button semantics |

Sizes: `sm`, `default`, `lg`, `icon`.

For pill-shaped filter buttons, add `className="rounded-full"`.

### Form Feedback

```tsx
// Error messages
<p className="text-destructive text-sm">{errorMessage}</p>

// Success messages
<p className="text-success text-sm">{successMessage}</p>

// Inline conditional (like WaitlistForm)
<p className={`text-sm ${isError ? "text-destructive" : "text-success"}`}>
  {message}
</p>
```

### Links

- Navigation links: `text-sm font-medium hover:text-primary transition-colors`
- Inline text links: `text-primary underline` or `text-primary hover:underline`
- Never use hardcoded `text-blue-600` for links.

### Loading States

```tsx
// Inline text loading
<div className="text-sm text-muted-foreground">Loading...</div>

// Pulsing placeholder
<div className="animate-pulse text-muted-foreground">Loading...</div>
```

---

## Do's & Don'ts

### Do

- Render page sections on `bg-background` with a hairline + `SectionTitle`
- Use `divide-y divide-border` for repeated rows
- Use semantic token classes (`text-foreground`, `bg-muted`, `text-destructive`)
- Use the `<BiasIndicator>` component for all bias visualization
- Add `max-w-[65ch]` to prose blocks for readability
- Let `leading-relaxed` from the body base handle paragraph spacing
- Use `bg-linear-to-b` instead of `bg-gradient-to-b` (Tailwind v4 syntax)
- Test both light and dark mode when building new features
- Use `oklch` when defining any new color tokens

### Don't

- Wrap a page section in `bg-card` / `border` / `shadow-sm` (see [Surfaces](#surfaces--sections-are-not-cards))
- Use dashed-border empty states or icon-in-a-tinted-square decorations
- Use `font-bold` for titles — `font-semibold` is the app's heaviest weight
- Use raw Tailwind color classes (`text-gray-500`, `bg-red-500`, `bg-blue-600`)
- Use red and blue to represent political left/right
- Add custom hex or rgb colors inline
- Override `font-family` outside of the `@theme` block
- Use `text-black` or `text-white` directly — use `text-foreground` / `text-primary-foreground`
- Create one-off color variables — extend the token system in `index.css` if you need new semantic colors
- Use `bg-gradient-to-*` (deprecated in Tailwind v4 — use `bg-linear-to-*`)

---

## Adding New Tokens

If you need a new semantic color (e.g., `--info`):

1. Add the CSS variable in `:root` and `.dark` in `src/index.css`
2. Register it in the `@theme inline` block as `--color-info: var(--info)`
3. Use it in components as `bg-info`, `text-info`, etc.
4. Update this document

---

## File Reference

| File                                | Purpose                                                  |
| ----------------------------------- | -------------------------------------------------------- |
| `src/index.css`                     | All CSS custom properties, theme config, base styles     |
| `src/components/ui/button.tsx`      | Button variants (shadcn/ui)                              |
| `src/components/ui/card.tsx`        | Card component (shadcn/ui) — admin routes only            |
| `src/components/bias-indicator.tsx` | Bias spectrum visualization                              |
| `components.json`                   | shadcn/ui configuration (style: new-york, base: neutral) |
