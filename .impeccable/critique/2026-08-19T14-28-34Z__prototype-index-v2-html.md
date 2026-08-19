---
target: prototype/index-v2.html
total_score: 25
max_score: 32
na_heuristics: 7,10
p0_count: 1
p1_count: 2
timestamp: 2026-08-19T14-28-34Z
slug: prototype-index-v2-html
---
# Critique — ScanPal homepage (prototype/index-v2.html)

Method: dual-agent (A: aaae152ea733c4c7b · B: aeda666f78a890bae). Surface: Persuade (public first-scan landing).

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | "Scan complete" + 63/GRADE C animate for a scan that never ran — false status |
| 2 | Match System / Real World | 4 | Every acronym paired with plain-language meaning |
| 3 | User Control & Freedom | 3 | Auto-scroll-on-submit moves the user unasked; nothing destructive |
| 4 | Consistency & Standards | 2 | Green hero + green "security" diverge from documented blue-grey atmosphere & reserved status colors |
| 5 | Error Prevention | 4 | normalize() validates host, prepends https, inline error with example |
| 6 | Recognition over Recall | 4 | Placeholder, reassurance row, worked example all visible |
| 7 | Flexibility & Efficiency | n/a | First-touch Persuade surface |
| 8 | Aesthetic & Minimalist | 3 | Dense hero: badge + 45-word lead + field + 3 meta + tall report card before first break |
| 9 | Error Recovery | 3 | One clear error state; no real scan-failure state |
| 10 | Help & Documentation | n/a | Docs not expected pre-signup |
| Total | | 25/32 (78%) | Good |

## Design Specificity Verdict
Specific where it counts (report preview, developer nginx evidence — authored for a security scanner), generic where seen first (headline "Know exactly what's wrong with your website" is category-agnostic; green hero borrows a wellness signal that dilutes the quiet-technical identity).
Detector: exit 0 clean, 1 advisory (em-dash-overuse, 17). DEGRADED regex-only mode — no contrast/custom-property/selector analysis; clean is an undercount. Independently confirmed muted #86868a on white ≈ 3.6:1 (under AA), matching the design review.
Visual overlays: not run (browser deferred in subagent; dev server torn down).

## Overall Impression
Strong evidence-driven page with one credibility bug (staged "real" result) and one self-inflicted brand contradiction (green pre-scan hero). Biggest opportunity: make the peak earned and let the hero create productive unease.

## What's Working
1. Report preview (donut + severity legend + real HSTS/CSP/cookie findings with dark evidence) — the conversion engine, deeply on-brand.
2. Reassurance row under the field (No account · ~15s · No card) at the anxiety point, muted so it doesn't fight the CTA.
3. Progressive disclosure + developer panel (nginx.conf fix) serving owner + developer on one page.

## Priority Issues
[P0] Preview masquerades as a real scan result. On submit #scannedUrl becomes the visitor's own origin while SCORE=63/donut/findings stay hardcoded and dev panel still says acme-store.com; "Scan complete" fires for a non-scan. Violates PRODUCT.md principle 4 ("never turn missing data into a reassuring score") + trust/legal risk. Fix: real partial scan OR unmistakable static example ("Sample report — acme-store.com"), never inject visitor URL, never "Scan complete" for a non-scan. Command: harden.
[P1] Green hero contradicts design system + reverses persuasive arc. Atmosphere overridden with rgba(34,197,94)/--success-wash and "security" painted --success-ink; green = healthy/fixed in ScanPal semantics; DESIGN.md names blue-grey atmosphere twice + reserves status colors. Pre-reassures then contradicts GRADE C report; governance gap (live edit diverged from DESIGN.md). Fix: restore --atmos, "security" ink+bold, reserve green for post-scan, re-sync DESIGN.md. Command: colorize/quieter.
[P1] Free tier under-delivers committed "one complete finding." Preview findings show explanation+evidence but no remediation (locked), though overlay promises step-by-step fix; PRODUCT.md line 41 commits one complete finding free. Fix: promote one finding to fully complete free. Command: clarify/onboard.
[P2] Hero over-density + generic non-security headline. ~45-word lead re-lists categories; headline never signals security. Fix: cut lead to one sentence+clause; test security-forward headline. Command: distill.
[P3] Accessibility below product's own AA baseline. --muted #86868a on paper ≈3.6:1 on 12-14px metadata (both assessments agree); nav .btn-sm primary mobile action ~32px < 44px. Fix: darken muted for sub-15px; raise .btn-sm to >=44px mobile. Command: harden.

## Persona Red Flags
- Jordan (first-timer): after submit sees their domain + "Scan complete" + "2 criticals" but findings/dev panel are acme-store's — cannot tell example from real result.
- Riley (stress tester): validation solid, but every input yields identical 63/GRADE C/same findings (canned); final CTA re-dispatches hero submit, partial double-submit guard.
- Casey (mobile): correct field-wrap, but very tall hero before "how it works"; nav primary action ~32px < 44px.
- Non-technical owner: no plain-language safety verdict; dark wall of header names; green hero answers "safe?" with false calm then report contradicts.

## Minor Observations
- Fabricated social proof "1.2M pages scanned this month" — don't fabricate brand claims.
- .sec-demo evidence aria-hidden — meaningful content hidden from SR.
- em-dash-overuse (17) advisory.
- Off-token inline hexes (#bbf7d0, #c7cfda, #eceef2, #a3a3a8, #eaeaea).
- Positives: all inline SVG (no img), hidden labels on inputs, prefers-reduced-motion respected, non-color-alone severity, viewport + mobile-first breakpoints correct.

## Questions to Consider
1. Real partial scan of the visitor's own site instead of swapping their URL onto a canned report?
2. What should a pre-scan hero feel like if green means healthy/fixed elsewhere?
3. One complete finding (fix included) vs three partial + wall — which converts better?
4. A one-line plain-English safety verdict atop the report, demoting the donut?
