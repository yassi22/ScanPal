# ScanPal — Roadmap (fases + taken per fase)

Fasering van de feature-lijst (`docs/FEATURES.md`) richting MVP. MVP = features 1–10, 17–21, 27–39, 41–43, 46–50 + 51; de rest volgt daarna. Nummers verwijzen naar FEATURES.md.

**Volgorde-principe**: vertical slices — elke feature levert de API-route(s) én de UI samen op (de webapp bevat beide). De worker-pipeline (Fase 3) is de enige puur backend-fase; daarna vervangt de pipeline de inline-modus zonder dat de UI verandert (contract uit plan 06 blijft staan).

## Fase 0 — Fundering & account (MVP) · ✅ opgeleverd

- **Taken**: 1 registratie/login + onboarding · 2 team-uitnodigingen + rollen · 3 pricing/Stripe/credits · 17 auth-routes
- **Plannen**: 01, 02, 03 (✅ gebouwd) · 17-auth-api (✅)
- **Klaar als**: magic link + OAuth-login, onboarding met eerste scan, invites met rollen en checkout + credit-afdwinging end-to-end werken
- **Afhankelijkheden**: —

## Fase 1 — Sites & scans (MVP)

- **Taken**: 4 site toevoegen/validatie/statuslijst · 5 scan-triggers (direct/dagelijks/wekelijks, Pro-gating) · 6 live-progress via SSE · 18 sites-CRUD · 19 scans-routes (incl. cancel)
- **Plannen**: 04 (✅), 05, 06 (✅) · 18-sites-api (✅) · 19-scans-api (✅)
- **Klaar als**: site CRUD met statuslijst, drie trigger-manieren met credit-afdwinging, live-progress-UI (`/scans/[id]`)
- **Afhankelijkheden**: Fase 0 (credits, authz)

## Fase 2 — Resultaten & rapporten (MVP)

- **Taken**: 7 score-resultaatpagina · 8 findings (filter op ernst/categorie, details + remediatie, mark fixed/ignored) · 9 export PDF (react-pdf) + Markdown · 10 score-trend per site · 20/21 bijbehorende routes
- **Plannen te schrijven**: — (08-resultaten-score ✅, 09-findings en 10-export zijn ✅, feature 10 trend is ✅)
- **Klaar als**: resultaatpagina met overall + per-categorie scores, filterbare findings, PDF/Markdown-rapport, trendgrafiek per site
- **Afhankelijkheden**: Fase 1; trends hebben meerdere scans per site nodig (triggers uit Fase 1); exports bouwen op findings (08)

## Fase 3 — Scan-pipeline & workers (MVP)

- **Taken**: 27 dispatcher (fan-out, aggregatie, retry/timeout, progress-writes via plan 06-helper) · 28 security headers · 29 cookies audit · 30–34 http-security (rest) · 35–39 http-seo · 41–43 browser (CWV, axe, AEO) · 46–49 github (Semgrep, Gitleaks, OSV, repo-health)
- **Plannen te schrijven**: 30–34-http-security, 35–39-http-seo, 41–43-browser, 46–49-github
- **Klaar als**: scans lopen via BullMQ; per categorie de catalog-checks geïmplementeerd (AGENTS.md: check = catalog-entry + worker-implementatie); aggregatie berekent scores en updates `last_scan_*` (plan 04); progress_details wordt door workers geschreven
- **Afhankelijkheden**: Fase 0 (infra), contract uit plan 06; docker-compose + Redis staan in AGENTS.md
- **Notitie**: de pipeline-infra van 27 is opgeleverd (plan 27 ✅) — `scan.dispatcher` fanned uit naar `scan.http`/`scan.browser`/`scan.github`, de aggregator (`scan.aggregate`) finaliseert uit de `checks`-tabel; de webapp/scheduler zijn enqueue-only (202). De check-catalog in `packages/shared/src/check-catalog.ts` telt 67 entries (incl. 11 actieve-test-probes `active: true`, 5 compliance-checks, domain-watchtower, aeo-engine-matrix). Geïmplementeerd in `apps/worker/src/checks/registry.ts`: http-queue 28 (security-headers, 8 ids), 29 (cookies, 5 ids), 30 (cors), 31 (tls-cert), 32 (redirects-mixed), 33 (secrets-in-html), 34 (subresources), 35 (meta-tags), 36 (robots-sitemap), 37 (security-txt), 38 (mini-crawl), 39 (structured-data), 40 (stack-detection), plus secrets-in-bundles, active-tests, aeo-engine-matrix, compliance (5 ids), domain-watchtower, reachability, https; browser-queue 41 (core-web-vitals), 42 (accessibility), 43 (aeo-render), 44 (console-errors), 45 (mobile-responsive); github-queue 46 (semgrep), 47 (gitleaks), 48 (osv-scanner), 49 (repo-health). Alle 67 catalog-entries hebben een geregistreerde implementatie — geen open MVP-gap meer (feature 36 is opgeleverd op 2026-08-18: `apps/worker/src/checks/http/robots-sitemap.ts` + `packages/shared/src/robots-sitemap.ts`).

## Fase 4 — Monitoring & MCP (MVP)

- **Taken**: 50 uptime-worker (60s-probe, Redis-lock, 2-failure alert) · 24 uptime-routes · 11 uptime-dashboard v1 (status + laatste metrics; grafiek later) · 51 MCP-server (run_scan, get_scan, get_findings, list_sites, get_uptime)
- **Plannen te schrijven**: 11-uptime-dashboard (klaar; dekt 24 + 50)
- **Klaar als**: poller draait met locks en alert-rule; dashboard toont status per site; MCP-tools werken over de REST API (API-key-auth op de webapp is via plan 14/25 opgeleverd)
- **Afhankelijkheden**: Fase 3 (worker-infra), Fase 1 (sites)
- **Notitie**: de uptime-slice (50 + 24 + 11) is al opgeleverd (plan 11 ✅) — de 60s-poller draait nog als eigen proces `apps/worker/src/uptime`; hij kan later naar de `uptime.check`-queue zonder contractwijziging. De MCP-server (51) is ook opgeleverd — `packages/mcp-server` implementeert alle 5 tools (run_scan, get_scan, get_findings, list_sites, get_uptime) **plus een 6e `generate_fix_prompt`** met zod-schema's, wrapper over de REST API met API-key-auth.

## Fase 5 — Platform-compleet (deels MVP-rand, deels na MVP)

- **Taken**: 13 notificatiehub (scan-done / site-down / kritieke finding) · 14 profiel + API-keys · 15 outbound webhooks · 16 facturen/abonnement-beheer · 22 stripe-webhooks (plan-sync) · 25 api-keys HMAC-auth · 26 rate limiting + usage per team
- **Plannen te schrijven**: 26-rate-limiting
- **Klaar als**: e-mailhub + webhooks configureerbaar, API-toegang met HMAC-keys, abonnementsbeheer via Stripe-portal, rate-limits actief
- **Notitie**: de notificatiehub (13) is al opgeleverd — `packages/notify` met in-app centrum + Resend-mail (scheduler, uptime-poller en scan-flow gaan erdoorheen); de rest van deze fase volgt apart
- **Notitie**: 14/25/26 (deels) zijn opgeleverd via plan 14 — bearer keys (`sp_live_`, owner-only, team-scoped) op alle data-routes + rate limiting per key/team en de MCP-server; HMAC blijft een latere uitbreiding op de swappable helper (`lib/api-auth.ts`)
- **Notitie**: 22 (stripe-webhooks + plan-sync) is opgeleverd — `api/webhooks/stripe` verwerkt events via `processStripeEvent` (plan-sync, credits, limits) + payment_failed-notificatie door de hub.
- **Afhankelijkheden**: Fase 2/4 (events om op te notificeren), Fase 4 (MCP-dekking voor API-keys)

## Fase 6 — v2

- **Taken**: 12 threat-alerts (honeypot + log-patroon-detectie) · 23 outbound webhook-delivery-service · 52–55, 61–62 worker-uitbreidingen (actieve vulnerability-tests, JS-bundle inspectie, route-discovery, AEO-engine matrix, compliance-pijler, CrUX field data) · 56–59 monitoring-uitbreidingen (domain watchtower, publieke statuspagina, on-deploy triggers, diff-gebaseerde monitoring) · 60 AI fix-prompts · 63 MCP-uitbreiding · 64 team seats/white-label · 76 DNS-eigendomsverificatie als live gate voor hoog-risico scans
- **Plannen**: 12-threat-alerts (klaar), 52–64 (klaar), 76-domain-ownership-verification (klaar)
- **Klaar als**: threat-paneel met honeypot-events, resterende checks uit de catalog geïmplementeerd, CheckVibe-gap-features (52–64) per plan opgeleverd
- **Afhankelijkheden**: Fase 3 (workers), Fase 4 (logging-onderlegger), Fase 5 (notificaties, api-keys, rate limiting); 60 heeft plan 09 nodig (findings + remediatie), 63 bouwt op 09/59/60

## Plan-overzicht

| Document | Feature(s) | Status |
|---|---|---|
| `docs/plans/01-onboarding.md` | 1 | ✅ |
| `docs/plans/02-team-invites.md` | 2 | ✅ |
| `docs/plans/03-pricing-stripe-credits.md` | 3 | ✅ |
| `docs/plans/04-sites.md` | 4 | ✅ |
| `docs/plans/05-scan-triggers.md` | 5, 19 | ✅ |
| `docs/plans/06-scan-progress-sse.md` | 6, 19 | ✅ |
| `docs/plans/17-auth-api.md` | 17 | ✅ |
| `docs/plans/18-sites-api.md` | 18 | ✅ |
| `docs/plans/07-agents-md.md` | 8 AGENTS.md-bestanden (architectuur-diagrammen + scan-pipeline) | ✅ |
| `docs/plans/10-export.md` | 9, 21 | ✅ |
| `docs/plans/11-uptime-dashboard.md` | 11, 24, 50 | ✅ |
| `docs/plans/12-threat-alerts.md` | 12 | ✅ |
| `docs/plans/13-notificaties.md` | 13 | ✅ |
| `docs/plans/14-api-keys.md` | 14, 25, 26 (deels) | ✅ |
| `docs/plans/15-webhooks.md` | 15, 23 | ✅ |
| `docs/plans/16-billing-admin.md` | 16 | ✅ |
| `docs/plans/09-findings.md` | 8, 20 | ✅ |
| `docs/plans/19-scans-api.md` | 19 (cancel; create/get/list uit 05/06) | ✅ |
| trend (feature 10) | 10 | ✅ (`sites/[id]` + `api/sites/[id]/trend`) |
| `docs/plans/27-dispatcher.md` | 27 | ✅ |
| `docs/plans/28-security-headers.md` | 28 | ✅ |
| `docs/plans/65-cookies-audit.md` | 29 | ✅ |
| `docs/plans/08-resultaten-score.md` | 7 | ✅ |
| `docs/plans/52-active-vulnerability-tests.md` | 52 | ✅ |
| `docs/plans/53-js-bundle-inspection.md` | 53 | ✅ |
| `docs/plans/54-route-discovery-crawl.md` | 54 | ✅ |
| `docs/plans/55-aeo-engine-matrix.md` | 55 | ✅ |
| `docs/plans/56-domain-watchtower.md` | 56 | ✅ |
| `docs/plans/57-public-status-page.md` | 57 | ✅ |
| `docs/plans/58-on-deploy-triggers.md` | 58 | ✅ |
| `docs/plans/59-diff-monitoring.md` | 59 | ✅ |
| `docs/plans/60-ai-fix-prompts.md` | 60 | ✅ |
| `docs/plans/61-compliance-pillar.md` | 61 | ✅ |
| `docs/plans/62-crux-field-data.md` | 62 | ✅ |
| `docs/plans/63-mcp-expansion.md` | 63 | ✅ |
| `docs/plans/64-team-seats-white-label.md` | 64 | ✅ |
| `docs/plans/66-cors-misconfig.md` | 30 | 📝 |
| `docs/plans/67-tls-cert.md` | 31 | ✅ |
| features 32–34, 37, 39, 40, 41–45, 46–49 | rest | ✅ (direct in code + `registry.ts`; geen apart plan-doc) |
| feature 36 (robots-sitemap) | 36 | ✅ (`apps/worker/src/checks/http/robots-sitemap.ts` + `packages/shared/src/robots-sitemap.ts`, geregistreerd in `registry.ts`) |
| `docs/plans/68-dns-email-security.md` | 68 | 📝 |
| `docs/plans/69-hosting-fingerprint.md` | 69 | 📝 |
| `docs/plans/70-browser-storage-tokens.md` | 70 | 📝 |
| `docs/plans/71-client-dep-cve.md` | 71 | 📝 |
| `docs/plans/75-threat-intelligence.md` | 75 | ✅ |
| `docs/plans/76-domain-ownership-verification.md` | 76 | ✅ |
| `docs/plans/77-auth-flow-scanner.md` | G9 | ✅ (`apps/worker/src/checks/browser/auth-flow.ts`, ids `auth-*`, active-tests-gating) |
| `docs/plans/78-file-upload-scanner.md` | G10 | ✅ (`apps/worker/src/checks/browser/file-upload.ts`, ids `upload-*`, active-tests-gating) |
| `docs/plans/79-observability-signals.md` | 79 (G11) | ✅ (`packages/shared/src/observability.ts` + `apps/worker/src/checks/http/observability.ts`, geregistreerd; passief, info-only) |
| `docs/gap-analysis-checkvibe-security-checks.md` | 68–71 + Tier 2/3-gaten | 📝 (gap-analyse `/security-checks`, 2026-08-21) |

> **Update 2026-08-18 (geverifieerd tegen code)**: feature 36 (robots-sitemap) is opgeleverd — implementatie `apps/worker/src/checks/http/robots-sitemap.ts`, pure helpers + evidence-schema in `packages/shared/src/robots-sitemap.ts` (inspectRobotsTxt/inspectSitemap/evaluateRobotsSitemap), geregistreerd in `apps/worker/src/checks/registry.ts`; de check produceert findings over de geldigheid/kwaliteit van robots.txt en sitemap.xml zelf (los van de route-discovery-parse in plan 54). Alle 67 catalog-entries hebben nu een geregistreerde implementatie — geen open MVP-gap meer. Feature 54 (route-discovery) en 55 (aeo-engine-matrix) waren al eerder opgeleverd en staan nu ook ✅ in dit overzicht. Statussen hierboven zijn bijgewerkt.
