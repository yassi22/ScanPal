# ScanPal — Feature-overzicht

Volledige feature-lijst met MVP-afbakening en plan-koppeling. Legenda:

- **MVP**: ✅ = MVP-voorstel · 🔶 = na MVP / v2
- **Status**: ✅ klaar · 🚧 in uitvoering · 📝 plan klaar (niet gestart) · 💡 nog geen plan

## Onboarding & account

| # | Feature | MVP | Plan | Status |
|---|---|---|---|---|
| 1 | Registratie/login (magic link + OAuth), onboarding-flow met eerste scan | ✅ | 01-onboarding | ✅ |
| 2 | Team-uitnodigingen + rollen (owner/member) | ✅ | 02-team-invites | ✅ |
| 3 | Pricing-pagina + Stripe checkout, plan-beperkingen (credits) | ✅ | 03-pricing-stripe-credits | ✅ |

## Sites & scans

| # | Feature | MVP | Plan | Status |
|---|---|---|---|---|
| 4 | Site toevoegen (URL + GitHub-repo), validatie, lijst met status | ✅ | 04-sites | ✅ |
| 5 | Scan triggeren (direct / dagelijks / wekelijks) | ✅ | 05-scan-triggers | ✅ |
| 6 | Scan-progress live (SSE): % per check-categorie met spinner-lijst | ✅ | 06-scan-progress-sse | ✅ |
| 7 | Resultatenpagina: overall score + scores per categorie (HTTP, SEO, AEO, GitHub) | ✅ | 08-resultaten-score | ✅ |
| 8 | Findings: gefilterde lijst op ernst/categorie, per finding details + remediatie | ✅ | 09-findings | ✅ |
| 9 | Export: PDF (react-pdf) en Markdown rapport | ✅ | 10-export | ✅ |
| 10 | Historische scans vergelijken (score-trend per site) | ✅ | `app/(dashboard)/sites/[id]` + `api/sites/[id]/trend` | ✅ |
| 60 | AI fix-prompts: per finding én per scan een copy-paste prompt (Cursor/Claude/Windsurf) met locatie + remediatie | 🔶 | 60-ai-fix-prompts | ✅ |

## Monitoring

| # | Feature | MVP | Plan | Status |
|---|---|---|---|---|
| 11 | Uptime-dashboard: status per site, 60s-metrics, geschiedenis (30/90 dagen grafiek) | 🔶 | 11-uptime-dashboard | ✅ |
| 12 | Threat-alerts paneel (honeypot + log-patroon-detectie) | 🔶 v2 | 12-threat-alerts | ✅ |
| 13 | Notificaties: e-mail bij scan-done / site-down / kritieke finding | 🔶 | 13-notificaties (mail-basis in 05) | ✅ |
| 56 | Domain watchtower: expiry, transfer-lock, nameserver-drift, DNSSEC, CAA, cert-runway — dagelijks, alert bij verandering | ✅ | 56-domain-watchtower | ✅ |
| 57 | Publieke statuspagina per site: uptime-badge + 30/90-dagen-geschiedenis, no-login | 🔶 | 57-public-status-page | ✅ |
| 58 | On-deploy triggers: GitHub/Vercel webhook → automatische re-scan (HMAC-verified) | 🔶 | 58-on-deploy-triggers | ✅ |
| 59 | Diff-gebaseerde monitoring: wat-veranderd-view, dismissed-then-returned (regressed), snooze-rules | 🔶 | 59-diff-monitoring | ✅ |

## Settings & admin

| # | Feature | MVP | Plan | Status |
|---|---|---|---|---|
| 14 | Profiel, API-keys genereren (voor API/MCP gebruik) | 🔶 | 14-api-keys | ✅ |
| 15 | Webhooks instellen (outbound, JSON payload) | 🔶 | 15-webhooks | ✅ |
| 16 | Facturen/abonnement-beheer | 🔶 | 16-billing-admin | ✅ |
| 64 | Team seats + client-workspaces + klantportaal + white-label rapporten (Max-plan) | 🔶 | 64-team-seats-white-label | ✅ |

## Backend (app-laag, API routes)

| # | Feature | MVP | Plan | Status |
|---|---|---|---|---|
| 17 | auth/* — sessies, oauth, rollen | ✅ | 17-auth-api | ✅ |
| 18 | sites CRUD — URL-normalisatie, duplicate-check, GitHub-repo detectie | ✅ | 18-sites-api | ✅ |
| 19 | scans — create (202 + job), get (progress), list, cancel | ✅ | 05/06 (create/get/list) · 19-scans-api (cancel) | ✅ |
| 20 | findings — query met filters, mark as fixed/ignored | ✅ | 09-findings | ✅ |
| 21 | reports — PDF/Markdown generatie | ✅ | 10-export | ✅ |
| 22 | billing + stripe webhooks — plan-sync, credits, limits | 🔶 | 03 (checkout) + `api/webhooks/stripe` (plan-sync ✅) | ✅ |
| 23 | notifications — Resend-emails, outbound webhooks | 🔶 | 13-notificaties (mail+in-app ✅) · 15-webhooks (outbound ✅) | ✅ |
| 24 | uptime — poller worker elke 60s, Redis-lock per site, 2-failure alert | 🔶 | 11-uptime-dashboard | ✅ |
| 25 | api-keys — bearer-auth voor API + MCP | 🔶 | 14-api-keys | ✅ |
| 26 | Rate limiting (Redis) + usage-tracking per team | 🔶 | 14-api-keys (deel) | ✅ |

## Workers-laag

| # | Feature | MVP | Plan | Status |
|---|---|---|---|---|
| 27 | Dispatcher: fan-out http/browser/github, aggregatie + score, retry/timeout, progress-updates | ✅ | 27-dispatcher | ✅ |
| 28 | Security headers check (CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP/COEP) | ✅ | 28-security-headers | ✅ |
| 29 | Cookies audit (HttpOnly, Secure, SameSite, prefixes, expiry) | ✅ | 65-cookies-audit | ✅ |
| 30 | CORS-misconfiguratie detectie (origin-reflectie, null, `*`+credentials) | ✅ | 66-cors-misconfig | ✅ |
| 31 | TLS/SSL-certificaat (geldigheid, SAN/CN, self-signed, expiry-runway) | ✅ | 67-tls-cert | ✅ |
| 32–34 | HTTP-worker security (rest): redirects + mixed content, secrets-in-HTML, subresources | ✅ | nieuw (32–34) | ✅ (32 `redirects-mixed` · 33 `secrets-in-html` · 34 `subresources` — allen geregistreerd in `registry.ts`) |
| 35–39 | HTTP-worker SEO: meta/OG/canonical/hreflang, robots+sitemap, security.txt/favicon/404, mini-crawler, structured data | ✅ | nieuw (35–39) | ✅ (35 `meta-tags` ✅ · 36 `robots-sitemap` ✅ · 37 `security-txt` ✅ · 38 `mini-crawl` ✅ · 39 `structured-data` ✅ — allen geregistreerd in `registry.ts`) |
| 40 | Stackdetectie (CMS/framework uit headers + HTML) | 🔶 | — | ✅ (`stack-detection` geregistreerd in `registry.ts`) |
| 41–43 | Browser-worker: Core Web Vitals, accessibility (axe-core), AEO-scan (JS-render, LLM-parsability) | ✅ | nieuw (41–43) | ✅ (41 `core-web-vitals` · 42 `accessibility` · 43 `aeo-render` — allen geregistreerd; plus `aeo-engine-matrix` in http-queue) |
| 44 | Console-errors + netwerk-failures vangen | 🔶 | — | ✅ (`console-errors` geregistreerd) |
| 45 | Mobile/responsive basis-check | 🔶 | — | ✅ (`mobile-responsive` geregistreerd) |
| 46–49 | GitHub-worker: Semgrep (SAST), Gitleaks (secrets), OSV-Scanner (deps), repo-health | ✅ | nieuw (46–49) | ✅ (46 `semgrep` · 47 `gitleaks` · 48 `osv-scanner` · 49 `repo-health` — allen geregistreerd) |
| 50 | Uptime-worker: HTTP-probe elke 60s, latency-metrics, 2-failure = alert | ✅ | 11-uptime-dashboard | ✅ |
| 52 | Actieve vulnerability-tests (SQLi, XSS, CSRF, open redirect, IDOR, tenant-isolatie, GraphQL, JWT, webhook-signature) — opt-in + Pro | 🔶 | 52-active-vulnerability-tests | ✅ |
| 53 | JS-bundle inspectie: sourcemap-aware secrets-extractie uit client-bundles | 🔶 | 53-js-bundle-inspection | ✅ |
| 54 | Route-discovery + per-route checks: SPA-aware crawl (sitemap/links/chunks), plan-limiet routes | 🔶 | 54-route-discovery-crawl | ✅ (`route-discovery` als info-finding in `queues/crawl.ts` + helpers in `scan-core/routes.ts`) |
| 55 | AEO per-engine matrix: GPTBot/ClaudeBot/PerplexityBot/Copilot/Meta/Mistral-toegang + llms.txt | 🔶 | 55-aeo-engine-matrix | ✅ (`aeo-engine-matrix` in http-worker, geregistreerd in `registry.ts`) |
| 61 | Compliance-pijler: cookie-banner/CMP, privacy-policy, legal-pagina's, GDPR-signalen (nieuwe score-categorie) | 🔶 | 61-compliance-pillar | ✅ |
| 62 | CrUX field data: p75 + fracties naast lab-CWV, lab/field-divergentie-flag | 🔶 | 62-crux-field-data | ✅ |

## MCP-server

| # | Feature | MVP | Plan | Status |
|---|---|---|---|---|
| 51 | Tools: run_scan, get_scan, get_findings, list_sites, get_uptime — wrapper over REST API | ✅ | `packages/mcp-server` (5 + 1 bonus `generate_fix_prompt`, zod-schema's) | ✅ |
| 63 | MCP-uitbreiding: findings-filters, finding-detail, dismiss, scan-diff, uptime-historie, fix-prompts, check-catalog (14 tools) | 🔶 | 63-mcp-expansion | ✅ |

## MVP-afbakening (voorstel)

**MVP**: 1–10, 17–21, 27–39, 41–43, 46–50 + 51.

- Kan vooraf gedaan worden (1–3, 17 nu ✅ gebouwd)
- Noot 11/24/50: uptime-worker (50) en 60s-poller zitten in MVP; het volledige dashboard (11) met grafieken kan in een simpele eerste versie (status + laatste metrics) al mee — daarna pas 30/90-dagen-geschiedenis
- Noot 13: een minimale mail-notificatie bij score-daling van geplande scans zat in plan 05; de volledige notificatiehub (scan-done, site-down, kritieke finding, in-app centrum, voorkeuren) is met plan 13 ✅ klaar (features 11/12 events gaan er ook doorheen)
- Noot 12: threat-alerts, honeypot en log-patroon-detectie zijn expliciet **v2**

**Na MVP / v2**: 11 (dashboard-uitbreidingen), 12, 13 (hub), 14, 15, 16, 22, 23, 25, 26, 40, 44, 45, 52–64.

> **Status-synchronisatie 2026-08-18 (geverifieerd tegen code)**: MVP-features 1–10, 17–21, 27–39, 41–43, 46–50 + 51 zijn volledig gebouwd — feature 36 `robots-sitemap` is opgeleverd (implementatie in `apps/worker/src/checks/http/robots-sitemap.ts`, pure helpers in `packages/shared/src/robots-sitemap.ts`, geregistreerd in `registry.ts`; produceert findings over de geldigheid/kwaliteit van robots.txt en sitemap.xml zelf, los van de route-discovery-parse in plan 54). Ook de na-MVP-features 54 (route-discovery: `queues/crawl.ts` + `scan-core/routes.ts`) en 55 (aeo-engine-matrix: http-worker, geregistreerd) zijn opgeleverd; 40/44/45 waren oorspronkelijk na-MVP (🔶) maar zijn evengoed al opgeleverd en geregistreerd. De MVP-check-catalog telt 67 entries die allemaal een geregistreerde worker-implementatie hebben; MCP-server levert 6 tools (5 + bonus `generate_fix_prompt`). Geen open MVP-werk meer.

## CheckVibe-vergelijking (2026-08-16)

Features 52–64 komen uit een feature-vergelijking met [checkvibe.dev](https://checkvibe.dev/) (41 scanners / 200+ checks, AEO per-engine matrix, threat detection, domain watchtower, publieke statuspagina's, AI fix-prompts, white-label/portaal, MCP met 24 tools). Allemaal na-MVP-voorstellen; volgorde en prioriteit staan per plan. Opvallende meenemers voor de MVP-roadmap: **AI fix-prompts** (60, laaghangend fruit — remediatie bestaat al), **AEO per-engine matrix** (55, goedkoop te bouwen, groot onderscheid) en **route-discovery** (54, is eigenlijk een pipeline-uitbreiding van de bestaande mini-crawler 38). Threat detection (12) is bij CheckVibe al een headline-Pro-feature — heroverweeg of de v2-status niet naar vroege v2 verschuift.

Zie `docs/ROADMAP.md` voor de fasering en `docs/plans/` voor de detailplannen.

## CheckVibe `/security-checks`-gap (2026-08-21)

Delta op de vergelijking hierboven, op basis van de detailpagina [checkvibe.dev/security-checks](https://checkvibe.dev/security-checks) (41 scanners). Volledige analyse + prioritering: `docs/gap-analysis-checkvibe-security-checks.md`. De 10 gaten zijn getrieerd naar bouwkost; **Tier 1 (68–71) zijn goedkope uitbreidingen van bestaande code en hebben een plan klaar.**

| # | Feature | MVP | Plan | Status |
|---|---|---|---|---|
| 68 | DNS & e-mail security (SPF/DKIM/DMARC/MX) — uitbreiding van de bestaande DNS-resolver (`domain-net.ts`) | 🔶 | 68-dns-email-security | 📝 |
| 69 | Hosting-fingerprint security (Vercel/Netlify/Cloudflare + WAF) — uitbreiding van `stack-detection` | 🔶 | 69-hosting-fingerprint | 📝 |
| 70 | Browser storage & session-token scanner — uitbreiding van de Playwright-runner | 🔶 | 70-browser-storage-tokens | 📝 |
| 71 | Client-side dependency & CVE — vult het gat dat `osv-scanner` (repo-only) laat vallen voor URL-only sites | 🔶 | 71-client-dep-cve | 📝 |
| 75 | Threat intelligence / reputatie (Spamhaus, URLhaus, Safe Browsing, VirusTotal, AbuseIPDB) | 🔶 | 75-threat-intelligence | ✅ |
| 76 | Domein-eigendom-verificatie via DNS TXT — herbruikbare gate voor hoog-risico scans | 🔶 | 76-domain-ownership-verification | ✅ |
| 79 | Observability-signalen (G11 herdefinieerd) — extern-zichtbare monitoring-signalen als indirecte aanwijzing, altijd informatief | 🔶 | 79-observability-signals | ✅ |

**Tier 2 — echt nieuw, gemiddelde kost:** Supabase/Firebase exposed-config · subdomain-takeover · WAF/CDN+API-rate-limit-inspectie · threat-intelligence/reputatie-lookup. Threat intelligence (75) en de herbruikbare DNS-eigendomsverificatie (76) zijn ✅ opgeleverd; zie het gap-document voor de overige scope en volgorde. **Tier 3 — nieuwe actieve tests (opt-in+Pro):** auth-flow-scanner (bouwt op de live ownership-gate uit 76) · file-upload-scanner. **G11 (audit-logging)** is niet geparkeerd gebleven — herdefinieerd tot passieve observability-signalen, opgeleverd in plan 79.
