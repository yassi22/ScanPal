---
name: ScanPal
description: Quiet website security, SEO and AI-visibility scanning with evidence-backed next actions.
colors:
  ink: "#1a1c21"
  ink-soft: "#333640"
  action: "#0a0a0a"
  action-hover: "#1f1f1f"
  paper: "#ffffff"
  paper-cool: "#f6f8fb"
  atmosphere-blue: "#dfe5ee"
  atmosphere-blue-deep: "#c9d2e0"
  border: "#e0e0e0"
  text-muted: "#6b6b70"
  panel-dark: "#17171e"
  success: "#22c55e"
  success-wash: "#f0fdf4"
  success-ink: "#166534"
  info: "#3b82f6"
  info-wash: "#eff5ff"
  info-ink: "#1e40af"
  warning: "#f59e0b"
  warning-wash: "#fffaeb"
  warning-ink: "#92600a"
  danger: "#ef4444"
  danger-wash: "#fef2f2"
  danger-ink: "#b42318"
  high: "#fb7185"
  high-wash: "#fff1f2"
  high-ink: "#be123c"
  rose-base: "#f43f5e"
  border-soft: "#ececf0"
  panel-dark-2: "#1f1f28"
  selection: "#d7e0ef"
  shadow-slate: "#0f172a"
  # Dark diagnostic panel palette — evidence, code and status on the dark surface
  panel-fg: "#f4f4f6"
  panel-fg-soft: "#b9bcc6"
  panel-code: "#cbd2e0"
  panel-line: "#d7d9e0"
  panel-muted: "#9ea2ad"
  panel-muted-soft: "#8b8f99"
  panel-muted-dim: "#8b93a3"
  panel-muted-faint: "#7f8794"
  panel-hover: "#eaeaea"
  ev-pass: "#6ee7a8"
  ev-add: "#9ae6b4"
  ev-del: "#f2a4a4"
  ev-warn: "#f6c06a"
  ev-key: "#8ab4f8"
  ev-high: "#f6a5b0"
typography:
  scale:
    nano: "10px"
    micro-2: "11px"
    micro: "12px"
    caption: "14px"
    read: "17px"
    title-sm: "18px"
    subhead: "22px"
    score: "34px"
  display:
    fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "clamp(2.25rem, 5.6vw, 3.5rem)"
    fontWeight: 500
    lineHeight: 1.06
    letterSpacing: "-0.02em"
  headline-lg:
    fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "clamp(1.6rem, 3.4vw, 2.15rem)"
    fontWeight: 500
    lineHeight: 1.14
    letterSpacing: "-0.02em"
  lead:
    fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "clamp(1rem, 1.6vw, 1.125rem)"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  headline:
    fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "26px"
    fontWeight: 500
    lineHeight: 1.3333
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  body-muted:
    fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.375
    letterSpacing: "normal"
  label:
    fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "normal"
  data:
    fontFamily: "SF Mono, Fira Code, Roboto Mono, Menlo, monospace"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "normal"
rounded:
  xs: "6px"
  sm: "8px"
  tile: "12px"
  md: "14px"
  lg: "18px"
  pill: "999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  section: "56px"
  section-lg: "80px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "12px 24px"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "8px 12px"
  input-url:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px"
    height: "70px"
    width: "100%"
  card-light:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "24px"
  card-dark:
    backgroundColor: "{colors.panel-dark}"
    textColor: "{colors.paper}"
    rounded: "{rounded.lg}"
    padding: "24px"
  status-success:
    backgroundColor: "{colors.success-wash}"
    textColor: "{colors.success-ink}"
    typography: "{typography.data}"
    rounded: "{rounded.pill}"
    padding: "6px 10px"
---

# ScanPal Design System

## Overview

**Creative North Star: "Luminous Technical Calm."**

ScanPal is a security product, but its interface should not look like an alarm panel. The refreshed direction follows CheckVibe's quiet, editorial technical confidence: a luminous paper canvas, a cool blue-grey atmospheric field, compact black actions and dense technical detail revealed only when it helps the user decide what to fix.

Operate is the primary mode. The public first-scan surface also persuades, but it earns action through a clear promise, a single obvious input and visible proof. The report then becomes more technical through progressive disclosure: summary, score, finding, evidence and remediation.

### Key Characteristics

- Light-first public surfaces with a soft, cool atmosphere rather than a flat white void.
- Black pill actions that feel decisive without becoming aggressive.
- Helvetica-like sans typography with tight display tracking and calm body copy.
- Rounded search fields and cards with restrained borders and diffuse depth.
- Dark diagnostic panels reserved for code, previews and dense technical evidence.
- Severity communicated through labels and icons as well as color.

**Visual authority.** This document is refreshed from the visible CheckVibe homepage inspected on 2026-08-18. Use ScanPal's own product name, copy and logo; borrow the visual grammar, not CheckVibe's brand assets or exact wording.

## Colors

The palette is organized around an ink-on-paper contrast. The blue-grey atmosphere is structural and ambient; it should never compete with a scan result. Status colors are reserved for measured scan state and severity.

### Primary and Neutral

- **Ink** (`{colors.ink}`): primary headings, navigation and high-confidence text.
- **Ink Soft** (`{colors.ink-soft}`): hover text and secondary emphasis.
- **Paper** (`{colors.paper}`): default canvas, cards and input surfaces.
- **Paper Cool** (`{colors.paper-cool}`): quiet page sections and separators.
- **Border** (`{colors.border}`): one-pixel structure around interactive surfaces.
- **Text Muted** (`{colors.text-muted}`): supporting copy, helper text and metadata.

### Atmosphere

- **Atmosphere Blue** (`{colors.atmosphere-blue}`) and **Atmosphere Blue Deep** (`{colors.atmosphere-blue-deep}`) form a low-contrast diagonal field behind the hero. Keep the center lighter than the edges.
- **Panel Dark** (`{colors.panel-dark}`) is an intentional contrast surface for code previews, scan evidence and media-like product demonstrations.

### Semantic Status

- **Success** (`{colors.success}`): completed, healthy or fixed.
- **Info** (`{colors.info}`): queued, scanning or informational.
- **Warning** (`{colors.warning}`): attention required or elevated risk.
- **Danger** (`{colors.danger}`): failed, critical or destructive.

Never make a security judgment through color alone. Pair every status with a readable label, icon, score, or explanatory sentence.

**The Quiet Atmosphere Rule.** Gradients and grain create space and orientation, not decoration. If removing the atmosphere improves legibility, remove it from the component rather than adding more contrast.

## Typography

### Family

**Primary:** Helvetica Neue, Helvetica, Arial, sans-serif. The observed CheckVibe surface uses a neutral grotesk with moderate weights and no ornamental personality.

**Technical:** SF Mono, Fira Code, Roboto Mono, Menlo, monospace. Use only for URLs, HTTP evidence, check identifiers, timestamps, API examples and code.

### Hierarchy

- **Display** (500, `clamp(2.25rem, 5.2vw, 3.25rem)`, `1.12`, `-0.02em`): hero promise and first-run statement.
- **Headline** (500, `26px`, `1.3333`, `-0.02em`): major section headings and product pillars.
- **Title** (500, `20px`, `1.3`): cards, report groups and focused states.
- **Body** (400, `16px`, `1.5`): explanatory copy and default interface text.
- **Body muted** (500, `15px`, `1.375`): supporting copy where a slightly firmer voice is useful.
- **Label** (500, `15px`, `1`): buttons and short navigation labels.
- **Data** (500, `13px`, `1.35`): technical evidence and compact metrics.

Do not use all caps for sentences. Use sentence case for actions and headings; reserve uppercase for short, non-essential metadata only.

**The Tight Headline Rule.** Display text is compact and confident, but never compressed enough to sacrifice the plain-language promise.

## Layout

Use a centered, wide composition with generous breathing room. The hero content is capped around `880px`; the primary URL field is capped around `672px` and sits directly under the promise. Global horizontal padding is `16px` on compact screens, `24px` on tablet and `32px` on desktop.

The public shell uses a transparent fixed navigation bar around `72px` high. On scroll, it may gain a thin border or faint shadow, but it should not become a heavy app chrome. Hero spacing begins around `40px` on mobile and `56px` on desktop. Follow the 8px rhythm, with larger section steps at `56px` and `80px`.

Use light sections for explanation and conversion. Use dark panels only when the content itself is technical, code-like or demonstrative. On mobile, stack the URL field and its action, keep the action full width, and preserve a minimum touch target of `44px`.

Responsive intent:

- Compact: below `640px`; one-column flow, stacked field and button, smaller display type.
- Tablet: `640px` to `1023px`; retain centered content and increase side padding.
- Desktop: `1024px` and up; allow wider product previews and two-column report reading where it improves scanning.

## Elevation & Depth

Depth comes from tonal atmosphere, white cards and diffuse shadows rather than hard outlines or dramatic glow. The canonical URL field uses a quiet resting shadow and a broader, softer focus-within shadow. Dark diagnostic cards use a subtle inset highlight plus a deep downward shadow.

### Shadow Vocabulary

- **Field rest** (`0 4px 12px rgba(15, 23, 42, 0.06), 0 28px 64px -22px rgba(15, 23, 42, 0.28)`): default URL input shell.
- **Field focus** (`0 36px 90px -24px rgba(15, 23, 42, 0.24), 0 8px 24px -12px rgba(0, 0, 0, 0.12)`): focus-within state for the primary search field.
- **Diagnostic panel** (`inset 0 1px 0 rgba(255, 255, 255, 0.07), 0 1px 2px rgba(4, 6, 14, 0.5), 0 32px 64px -32px rgba(4, 7, 18, 0.95)`): dark technical previews and evidence blocks.

**The No-Neon Depth Rule.** Do not add colored glows to make a security interface feel more technical. Contrast, layering and evidence create the authority.

## Shapes

Pills are the signature action silhouette. Use `999px` for primary actions, compact status chips and navigation controls. Use gently curved rectangles (`14px`) for forms and light cards; use `18px` for larger dark diagnostic panels. Borders remain one pixel and low contrast. Avoid sharp corners on primary product surfaces and avoid excessive nested rounding inside an already rounded card.

Images, demos and technical previews clip to their containing radius. Icons sit optically centered and should not force extra padding around short labels.

## Components

### Buttons

Buttons are compact, tactile and sentence-case.

- **Primary:** black fill, white text, pill shape, `12px 24px` padding.
- **Hover:** move from `{colors.action}` to `{colors.action-hover}`; no scale or glow.
- **Active:** compress subtly (`scale(0.98)`) for direct actions.
- **Focus:** use a visible 2px ink or blue focus ring with an offset against the paper canvas.
- **Secondary:** transparent or white pill with ink text; use for navigation and low-commitment actions.
- **Disabled:** lower contrast and remove depth; retain readable text and a clear disabled state.

### URL Scan Field

The URL field is the hero's focal control: a white, `14px` rounded shell with a one-pixel border, `8px` internal padding and a black pill action embedded on the right. The field label remains available to assistive technology even when the visual placeholder is compact. On narrow screens the button moves below the input and becomes full width.

### Cards / Containers

Light cards are white with a thin neutral border, restrained rounding and a soft shadow only when they are interactive or focal. Dark cards are reserved for technical previews and use `18px` rounding with an inset highlight. Do not turn every report row into a floating card; use separators and tonal grouping for dense lists.

### Navigation

Navigation is transparent over the hero, uses neutral ink text and compact pill actions. Links use sentence case and quiet hover backgrounds. The mobile shell collapses links without changing the primary action's position or label.

### Status Chips and Findings

Status chips are compact pills with readable text and an icon or shape. Finding rows lead with severity, then a plain-language explanation, then evidence and remediation. Use the dark diagnostic surface for raw evidence only; keep the decision and next action on paper.

### Motion

Use `150ms` to `220ms` ease-out transitions for color, shadow and opacity. Use a single upward fade for hero content and a one-time score reveal when scan results arrive. Respect `prefers-reduced-motion` by removing transforms, count animation and non-essential transitions.

## Do's and Don'ts

### Do:

- **Do** keep the public experience light, calm and centered.
- **Do** use a soft cool atmosphere behind the hero and let the content remain the highest-contrast layer.
- **Do** make the URL field the clearest first action.
- **Do** use black pill buttons for decisive actions and white or transparent pills for secondary actions.
- **Do** reveal technical depth progressively: summary, finding, evidence, remediation.
- **Do** pair severity colors with words, icons or scores.
- **Do** keep ScanPal's own copy, product name and identity distinct from CheckVibe.

### Don't:

- **Don't** restore the old near-black-and-teal shell as the default public surface while this direction is active.
- **Don't** use neon cyan, purple gradients, cyberpunk decoration or colored glows.
- **Don't** copy CheckVibe's logo, wordmark, exact copy or proprietary imagery.
- **Don't** use color alone to communicate security, uptime or severity.
- **Don't** bury the scan action in a dashboard-like toolbar or a multi-step form.
- **Don't** make dark panels, heavy borders or large shadows compete with the score and next fix.
