# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js App Router + TypeScript in a pnpm monorepo. The webapp owns the frontend and REST API routes; scan work runs asynchronously in BullMQ workers and is persisted in PostgreSQL/Redis.

## Users

- Website owners and other non-technical users who want a clear answer to the question: “Is my website safe and healthy?”
- Developers, small teams, agencies and freelancers who need ranked technical findings, evidence and practical remediation steps.

They use ScanPal from a desktop or mobile browser, often after entering a website URL and waiting for a first scan to finish.

## Product Purpose

ScanPal scans a website and related sources with parallel security, SEO, performance, AI-visibility and compliance checks. It turns the results into a clear score, ranked findings, remediation guidance and exportable reports.

The first-run outcome is a completed free scan with a useful summary. A user can create an account afterwards to unlock the complete report, fixes and future scans.

## Positioning

ScanPal combines a low-friction public first scan with a product-grade, evidence-backed report. The product must serve both a non-technical summary view and a developer-ready detail view without splitting the experience into separate products.

## Operating Context

- Core path: enter a website URL → run a free scan → view a limited result → create an account → unlock the full report.
- Security is the primary report section.
- SEO, performance, AI visibility and compliance are additional report sections.
- A scan runs asynchronously and exposes progress, completion, failure and cancellation states.
- Authenticated users can manage sites, scans, reports, teams, billing, uptime and notifications.

## Capabilities and Constraints

- Login providers required by the product: Google, GitHub and e-mail/password.
- Free results should show the overall score, finding counts/severity summary and one complete finding; the remaining report content is visibly locked until account creation.
- The interface must work responsively on desktop and mobile.
- “Not scanned” is distinct from a zero score or “no issues found”.
- Security findings need severity, evidence, explanation and remediation without hiding important context behind technical jargon.
- The current repository already contains onboarding, authentication, dashboard and scan-result surfaces. The current `AuthForm` uses an e-mail magic-link flow; aligning it with the confirmed e-mail/password requirement is an implementation gap, not a change to the design-system direction.
- The current onboarding API is session-protected, while the confirmed product flow requires a free scan before account creation. Public-scan access and its abuse/rate-limit boundary remain implementation decisions to resolve.
- The live `apps/web` frontend still renders the superseded dark / near-black + teal + Geist styling (`apps/web/app/globals.css`). Migrating it to the committed "Luminous Technical Calm" direction (`DESIGN.md`) is an implementation gap, not a change to the design-system direction. The prototypes at `prototype/index.html` (v1) and `prototype/index-v2.html` (v2) are the reference for that direction.

## Brand Commitments

- Product name: ScanPal.
- Committed visual direction is "Luminous Technical Calm": a light-first paper canvas, a cool blue-grey hero atmosphere, compact black pill actions, and monospace plus dark diagnostic panels reserved for technical evidence. This direction is owned and specified by `DESIGN.md`.
- The earlier dark / near-black + teal + Geist reference screens are superseded. They remain useful as evidence of product flow and content structure, but they are anti-reference for visual direction, not a target.
- Launch language is English.
- Product copy should be direct, reassuring and specific. It must never imply that a scan proves absolute security.

## Evidence on Hand

- Repository implementation in `apps/web`: onboarding wizard, auth form, dashboard layout and scan-result components.
- Shared scan contracts and check catalog in `packages/shared`.
- Existing product description and architecture in `AGENTS.md` and `README.md`.
- User-provided visual references showing onboarding, scan completion, category selection and a gated free report (valid evidence for product flow and content structure; their dark/teal styling is superseded by the Luminous Technical Calm direction in `DESIGN.md`).
- No production brand asset package or final logo asset was supplied; do not fabricate one as a factual brand asset.

## Product Principles

1. Make the first scan useful before asking for commitment.
2. Translate technical evidence into a clear next action.
3. Lead with security while keeping the broader website-health model discoverable.
4. Show progress and limitations honestly; never turn missing data into a reassuring score.
5. Use one coherent experience for everyday users and developers, with progressive disclosure rather than separate modes.

## Accessibility & Inclusion

Design System v1 targets WCAG 2.2 AA as the baseline: keyboard-complete flows, visible focus, readable contrast, non-color severity labels, reduced-motion support, semantic form errors and touch targets appropriate for mobile use.

## Open Decisions

- Public free-scan architecture, rate limits and retention before account creation.
- Exact scope of “unlock”: full findings, remediation/fix prompts, scan history, monitoring and exports should be confirmed against the product plan.
