# Design Language & UX Requirements

This document encodes the project's design requirements so every implementation decision can be checked against them.

## Goals (from project owner)

1. **Works well on both computer and phone screens** — equal first-class support, not a shrunk desktop.
2. **Clean and very readable layout** for both large and small screens.
3. **Avoid visual styles over-used by AI** (see anti-patterns below).
4. **Visual language inspired by Cloudflare's Kumo component library, but not Cloudflare's brand colors.**
5. **Dark mode** follows the system preference by default, with a manual toggle that overrides it.
6. **Content-first speed** — static output, no framework tax, no layout shift.

## What we borrow from Kumo

Kumo is React + Base UI + Tailwind v4, but its *design system* is portable to any stack:

- **Semantic tokens only.** Colors are named by role (`canvas`, `surface`, `elevated`, `recessed`, `tint`, `control`, `line`, `hairline`, `ring`, `accent`, status colors), never by hue. Components never reference raw color values.
- **Automatic dark mode via `light-dark()`.** Each token carries both values; mode is set with a `data-mode="light|dark"` attribute. No `dark:`-style variant duplication.
- **Surface hierarchy.** `canvas → surface → elevated → recessed/tint`, used consistently to convey depth without decoration.
- **Hairline structure.** Borders and dividers come from `line` (edges of elevated surfaces) and `hairline` (flat separators); shadows are minimal and never colored.
- **Restrained geometry.** Tight, consistent radii; consistent spacing scale; no oversized rounding.
- **Role-based status colors** (`info`, `success`, `warning`, `danger`) in solid and tint variants.
- **Accessible focus rings** as a first-class token, plus keyboard and ARIA behavior in every component.
- **Component vocabulary**: Button (primary/secondary/ghost), Input + paste affordance, Badge (block type, randomized, VM), Banner (warnings/explanations), LayerCard-style result surfaces, Table/DescriptionList, Disclosure (FAQ), Tabs where needed, ThemeToggle.

## What we do NOT borrow

- React, Base UI, Tailwind, or Kumo's compiled CSS (our stack is vanilla static HTML/CSS/JS).
- Cloudflare's brand color: **#f6821f orange is explicitly out**.
- The FedRAMP theme and other Cloudflare-specific theming.
- Phosphor icon dependency; we use a handful of inline SVG icons instead.

## Anti-patterns (visual styles over-used by AI)

Explicitly banned:

- Purple/indigo/violet gradients, gradient text, "aurora" or mesh backgrounds.
- Glassmorphism, `backdrop-filter` blur panels, frosted cards.
- Neon glows, colored drop shadows, glowing focus effects.
- Floating 3D blobs, abstract spheres, isometric illustrations.
- Oversized radii (24px+) on every card and button; pill-shaped everything.
- Emoji as UI icons; "sparkles" symbols; robot/magic motifs.
- Centered marketing hero + three gradient feature cards + "AI-powered" copy.
- Auto-playing animations, parallax, scroll-jacking, gratuitous motion.
- Dark navy + violet "AI startup" default theme; unstyled default Tailwind/SaaS look.

Instead: neutral surfaces, hairline structure, color reserved for meaning, real data density, utilitarian clarity (Cloudflare-docs/Kumo-like), strong typographic hierarchy.

## Readability requirements

- Body text **≥ 16px**, line-height ~1.55; long-form text (FAQ, explainers) constrained to **65–75ch**.
- MAC addresses and hex input always in a **monospace font with tabular figures**, visually distinct from prose.
- Contrast: ≥ 4.5:1 for body text, ≥ 3:1 for large text and UI borders that carry meaning (WCAG 2.2 AA).
- Spacing on a 4px base scale (4/8/12/16/24/32/48/64) for vertical rhythm.
- Max content width ~46–52rem; no full-width text blocks.
- Labels/values aligned in definition-list style; addresses never wrap mid-octet when avoidable.

## Responsive requirements

- Mobile-first CSS; breakpoints at **640px** and **900px**, with fluid layouts between.
- Single-column reading layout on all sizes; no desktop-only features.
- Result tables collapse to stacked label/value lists under 640px — never horizontal scroll for content.
- Tap targets ≥ 44px on touch screens; inputs use `inputmode`/`enterkeyhint` appropriately for hex entry.
- Search field stays at top on mobile (not hidden behind menus); the URL-driven result renders without any interaction at every size.
- No layout shift when data hydrates (reserve space for result regions).

## Semantic token layer

Our token names map 1:1 to Kumo's roles so the reference is obvious. Values are defined with `light-dark()` in CSS custom properties; mode toggles via `data-mode` on `<html>`.

| Kumo reference | Our token | Role |
| --- | --- | --- |
| `kumo-canvas` | `--color-canvas` | Outermost page background |
| `kumo-base` | `--color-surface` | Default component background |
| `kumo-elevated` | `--color-elevated` | Slightly raised surfaces |
| `kumo-recessed` | `--color-recessed` | Recessed surfaces (code blocks, wells) |
| `kumo-tint` | `--color-tint` | Subtle hover/table backgrounds |
| `kumo-control` | `--color-control` | Form control backgrounds |
| `kumo-contrast` | `--color-contrast` | Inverted high-contrast surfaces |
| `kumo-overlay` | `--color-overlay` | Overlays/popovers |
| `kumo-line` | `--color-line` | Borders around elevated surfaces |
| `kumo-hairline` | `--color-hairline` | Flat separators |
| `kumo-ring` | `--color-ring` | Focus rings |
| `kumo-brand` | `--color-accent` | Primary action color (**custom, not #f6821f**) |
| `kumo-info/success/warning/danger` | `--color-{status}` (+ `-tint`) | Status colors |
| `text-kumo-default` | `--text-default` | Body text |
| `text-kumo-strong` | `--text-strong` | Headings/emphasis |
| `text-kumo-subtle` | `--text-subtle` | Secondary text |
| `text-kumo-placeholder` | `--text-placeholder` | Placeholders |
| `text-kumo-link` | `--text-link` | Links |
| `text-kumo-inverse` | `--text-inverse` | Text on inverted surfaces |

### Resolved palette & type policy

- **Monochrome base.** `--color-accent` resolves to the high-contrast neutral (near-black in light mode, near-white in dark mode). Primary buttons, links, and focus rings use it. No brand hue.
- **Color only carries meaning.** Status colors are reserved for semantics:
  - `warning` (amber): locally administered / likely randomized address notices.
  - `danger` (red): invalid input, failed parse.
  - `success` (green): transient confirmations (e.g., "copied").
  - `info` (blue): explanatory notes that are neither errors nor warnings.
  - Everything else — block-type badges, VM badges, buttons, links, cards — stays neutral.
- **High contrast first.** Body text targets near-maximum contrast against its surface in both modes (light: near-black on white; dark: near-white on near-black). Structural borders meet ≥ 3:1, and status tints are backgrounds only, always paired with text that meets 4.5:1.
- **Links are identifiable without color**: underline plus the neutral accent; never color alone.
- **Typography (system stack).** Sans: `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`. Mono: `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`.

Typography scale (px): 12 / 13 / 14 / 16 / 18 / 20 / 24 / 30 with paired line heights. Spacing: 4px base scale. Radii: 6px (controls), 10px (cards), 999px (pills).

## Component inventory (hand-rolled)

- Header: wordmark + theme toggle; sticky optional (must not shift layout).
- Search input with paste/clear affordance and inline validation.
- Result surface: vendor name, block badge, addresses in all formats, copy buttons.
- Badges: block type (MA-L/MA-M/MA-S/IAB/CID), "randomized", "VM/hypervisor".
- Banner: randomization explanation, invalid input, spoofing caveat.
- Description list for block details (type, range, count, country, registered org).
- Batch results table (collapses to cards on mobile).
- Summary line: compact counts under result headings (vendors, randomized, virtual machines) in subtle text — no color, no extra chrome.
- Lineage timeline: chronological list of organization names with observed dates; neutral styling with an "observed dates" caveat and source credit; rendered only for exact prefixes that changed hands.
- FAQ disclosures (`details`/`summary`) with prose styling.
- Recent history list (localStorage) with clear action.
- Footer with data source attribution and last-updated date.

## Accessibility

- Semantic landmarks, one `h1` per page, logical heading order.
- Keyboard operable everywhere; visible `:focus-visible` rings using the ring token.
- `prefers-reduced-motion` respected; animations limited to small state transitions.
- Result updates announced via `aria-live="polite"`; errors via `role="alert"`.
- Theme toggle exposes state (`aria-pressed` or labeled control) and works without JS (system default applies regardless).

## Dark mode behavior

1. Default: `prefers-color-scheme` decides (`data-mode` absent → CSS `light-dark()` follows the OS).
2. Toggle explicitly sets `data-mode="light|dark"` on `<html>` and persists in `localStorage`.
3. Hard-coded system-follow behavior is the fallback if JS is unavailable.
4. No flash of wrong theme: tiny inline script sets `data-mode` before first paint.

## Prefix lineage display

When a prefix has lineage (scope and provenance: [architecture](architecture.md#prefix-lineage)):

- Neutral, ordered timeline: organization name + observed date, oldest first. No color coding; this is information, not status.
- Dates labeled as observed, with source credit to runZero mac-tracker (MIT).
- Timeline entries are plain text using the default text token; dates use the subtle token and tabular figures.

## Resolved design decisions

- [x] Styling: vanilla CSS + semantic token layer (no Tailwind, no React).
- [x] Palette: monochrome base + status colors only when meaningful; high contrast in both modes.
- [x] Typography: system UI stack; system monospace for addresses.
- [x] Short partials (< 6 hex): list matching prefixes, capped at 200, with total count.
- [x] Data ops: Cloudflare Workers Builds triggered by push; manual refresh via a committed refresh date; no analytics initially.
