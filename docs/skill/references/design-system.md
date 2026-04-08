# tsuki Design System — Complete Reference

> This is the authoritative design token reference. All IDE and public website components must follow it. Never hardcode hex values.

---

## Fonts

```css
--font-sans: 'IBM Plex Sans', system-ui, sans-serif;  /* weights: 300 400 500 600 */
--font-mono: 'IBM Plex Mono', 'Fira Code', monospace;
--base-size:  clamp(11px, 0.85vw, 14px);              /* fluid — never fixed px in layout */
```

Always enable:
```css
-webkit-font-smoothing: antialiased;
-moz-osx-font-smoothing: grayscale;
```

---

## Color tokens — dark mode (default)

### Surfaces

| Token | Value | Use |
|-------|-------|-----|
| `--surface` | `#0a0a0a` | body, root background |
| `--surface-1` | `#111111` | sidebar, primary panels |
| `--surface-2` | `#171717` | cards, modals |
| `--surface-3` | `#1f1f1f` | inputs, dropdowns |
| `--surface-4` | `#282828` | toggles, chips |

### Text

| Token | Value | Use |
|-------|-------|-----|
| `--fg` | `#ededed` | primary text |
| `--fg-muted` | `#8c8c8c` | secondary text, labels |
| `--fg-faint` | `#484848` | placeholders, inactive icons |

### Borders and overlays

```css
--border:        #242424    /* primary border */
--border-subtle: #1c1c1c    /* internal separators */
--hover:  rgba(255,255,255,0.04)
--active: rgba(255,255,255,0.08)
```

### Semantic

```css
--ok:   #22c55e
--err:  #ef4444
--warn: #f59e0b
--info: #93c5fd
```

### Accent — critical rule

```css
--accent:     #ededed   /* white in dark, black in light */
--accent-inv: #0a0a0a   /* background for "solid" buttons */
```

The accent is **deliberately neutral** (black/white). There is no brand color. Identity comes from typography and density. **Never use blue, green, or purple as a brand color.**

---

## Light mode

Same tokens with inverted values. Activated by `html.light`. Default is `html.dark`.

---

## Global typographic classes (public web)

| Class | Description |
|-------|-------------|
| `.t-display` | `clamp(52px → 100px)` weight 600, tracking -0.04em — hero |
| `.t-h2` | `clamp(28px → 48px)` weight 600, tracking -0.03em |
| `.t-h3` | `17px` weight 600, tracking -0.02em |
| `.t-body` | `15px` weight 400, line-height 1.68, `--fg-muted` |
| `.t-label` | `10.5px` mono, uppercase, tracking 0.09em, `--fg-faint` |
| `.t-mono` | `13px` mono |

---

## Layout and global primitive classes

```css
.container  /* max-width 1100px, margin 0 auto, padding 0 28px */
.section    /* padding 120px 0 */
.card       /* surface-1, border, radius 8px, hover border lift */
.badge      /* mono 10.5px, border, radius 20px, surface ghost */
.btn / .btn-primary / .btn-secondary
.divider    /* 1px, rgba(255,255,255,0.07) */
```

---

## Syntax tokens (embedded editor)

```css
--syn-kw:  #ededed
--syn-fn:  #d4d4d4
--syn-str: #a0a0a0
--syn-num: #b0b0b0
--syn-com: #525252
--syn-typ: #c8c8c8
```

Classes: `.syn-kw .syn-fn .syn-str .syn-num .syn-com .syn-typ .syn-pkg .syn-op`

---

## Animations

Durations: **150–200 ms ease** for UI. 300 ms maximum. Never more.

```css
.animate-fade-up   /* fadeUp 200ms ease — entrance from below */
.animate-fade-in   /* fadeIn 150ms ease */
.animate-up        /* fadeUp 0.55s cubic-bezier(0.22,1,0.36,1) both — hero */
.reveal / .reveal.visible  /* scroll-triggered fade-up via IntersectionObserver */
```

---

## Surface hierarchy on a new screen

```
body             → var(--surface)    — background
sidebar / nav    → var(--surface-1)  — primary panel
cards / modals   → var(--surface-2)  — floating elements
inputs / dropdowns → var(--surface-3)  — controls
toggles / chips  → var(--surface-4)  — small elements
```

---

## Class writing pattern (Tailwind + CSS vars)

```tsx
// ✅ Correct
className="text-[var(--fg-muted)] bg-[var(--surface-2)]"
className="hover:bg-[color-mix(in_srgb,var(--err)_10%,transparent)]"

// ❌ Avoid
className="text-gray-400 bg-zinc-900"
```

---

## IDE component text sizes

Use these instead of Tailwind's generic size classes:

| Use | Class |
|-----|-------|
| Body / description | `text-[11px]` |
| Labels, tab text | `text-[10px]` |
| Section headers, micro labels | `text-[9px]` |
| Monospace / code | `text-[10px] font-mono` |

---

## Rules that must never be broken

1. No visible shadows between panels — use `border: 1px solid var(--border)` only.
2. No large radii: `border-radius` max 8–12px on cards, 4–6px on controls.
3. No decorative gradients in the IDE UI (allowed sparingly on the public website).
4. No hardcoded colors — always `var(--token)` or `color-mix(in srgb, var(--token) N%, transparent)`.
5. No animations > 300ms on functional UI transitions.
6. No `!important` or Tailwind `@apply` except with strong justification.
7. No fixed `px` in main layout sizes — use `clamp()`.