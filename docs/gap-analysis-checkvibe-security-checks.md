# Gap-analyse — CheckVibe `/security-checks` (delta op 16-aug)

**Bron**: [checkvibe.dev/security-checks](https://checkvibe.dev/security-checks) — "41 scanners / 200+ checks", opgehaald 2026-08-21.
**Karakter**: dit is een **delta** op de eerdere CheckVibe-vergelijking (`docs/FEATURES.md`, 2026-08-16) waaruit features 52–64 al zijn voortgekomen. Hieronder alleen wat de detailpagina `/security-checks` blootlegt dat de eerste pass níet had. Geverifieerd tegen de check-catalog (`packages/shared/src/check-catalog.ts`, 67 entries) en de worker-registry.

## Leeswijzer over "aantallen"

Vergelijk niet 67-vs-41 op nummers. ScanPal's catalog is fijner gesneden: security-headers = 8 ids, cookies = 5 ids, compliance = 5 ids — CheckVibe bundelt elk daarvan tot één "scanner". **We lopen niet achter op aantal checks, we lopen achter op een handvol scan-oppervlakken.** Dit document telt oppervlakken, geen ids.

Twee ✅'s met een slag om de arm (diepte niet geverifieerd, niet als gap geteld):
- **SEO** — CheckVibe adverteert 68 sub-checks; wij hebben 6 catalog-entries. Let op: onze SEO-checks geven **grofweg één samengevatte finding per entry** terug (`meta-tags` bv. `return [{status,…}]`), geen fijn-gesneden sub-checks. Dekking is breed, maar een 1-op-1 dieptevergelijking met 68 sub-checks is **niet** gedaan — dit is mogelijk een reëel diepteverschil, geen bevestigde pariteit.
- **AEO** — CheckVibe 46 sub-checks; wij `aeo-engine-matrix` + `aeo-render` + `aeo-scan`. Zelfde voorbehoud: dekking aanwezig, diepte niet geteld.

## Dekkingsoverzicht (41 CheckVibe-scanners)

**Al gedekt (26):** SQL Injection · XSS · API Key Exposure (`secrets-in-html`+`secrets-in-bundles`) · CORS · CSRF · Open Redirect · GraphQL (introspection; injection-diepte onbevestigd) · JWT · Debug Endpoints · Input Validation · Source Code SAST (`semgrep`) · Webhook Signature · IDOR · Tenant Isolation · Security Headers (8) · SSL/TLS · Cookie & Session (5) · GitHub Repo Security (`gitleaks`+`repo-health`) · Legal Compliance (5) · Uptime & Status Pages · Domain Watchtower · Performance & CWV (`core-web-vitals`+`crux-field-data`) · Accessibility WCAG · SEO¹ · AEO¹ · Dependency Vulnerability (`osv-scanner` — **zie G4-kanttekening**).

**Gaten (10 + 1 te-definiëren):** hieronder, gegroepeerd naar bouwkost, niet naar CheckVibe-categorie.

---

## Tier 1 — Goedkope uitbreidingen van bestaande code (aanbevolen: nu inplannen)

Dit is de belangrijkste bevinding: **4 van de "gaten" zijn geen nieuwe scanners maar uitbreidingen van code die er al staat.** Bewijs staat per item.

| # | Gap | Hergebruikt | Klasse | Plan |
|---|---|---|---|---|
| **G1** | DNS & Email security (SPF/DKIM/DMARC) | `packages/scan-core/src/domain-net.ts` heeft al een swappable `node:dns/promises`-resolver (doet `resolveNs`/`resolveCaa`/DS). `resolveTxt` erbij. | passief | [68](plans/68-dns-email-security.md) |
| **G2** | Hosting-fingerprint security (Vercel/Netlify/Cloudflare + WAF) | `stack-detection` leest de response-headers al; `x-vercel-id`/`x-nf-request-id`/`cf-ray` + WAF/misconfig-signalen erbij. | passief | [69](plans/69-hosting-fingerprint.md) |
| **G3** | Browser storage & session tokens | `browser/playwright-runner.ts` heeft al `page`+`newContext`; één `page.evaluate(localStorage/sessionStorage)` na `goto`. | passief | [70](plans/70-browser-storage-tokens.md) |
| **G4** | Client-side dependency + CVE ("Tech Stack & CVE") | Alleen de **OSV-lookup** is hergebruik (`osv-scanner`). De versie-detectiepatroon-bibliotheek en de OSV-refactor uit de github-queue zijn **nieuw werk** — dit is Tier 1 op *prioriteit*, niet op kost. | passief | [71](plans/71-client-dep-cve.md) |

> **G4-kanttekening (belangrijkste bevinding van dit document):** `osv-scanner` draait **alleen als er een GitHub-repo gekoppeld is**. URL-only sites hebben vandaag **nul** dependency-dekking — een reëel blind spot, niet alleen een CheckVibe-pariteitspunt. Plan 71 lost zowel "Tech Stack & CVE" als dit gat in één keer op. Kanttekening bij de kost: anders dan G1–G3 (die puur bestaande code uitbreiden) heeft G4 een nieuwe patroon-bibliotheek + OSV-refactor nodig; alleen de lookup zelf is hergebruik.

---

## Tier 2 — Echt nieuw, gemiddelde kost (voorstel: schrijven op jouw keuze)

| # | Gap | Scope-keuze (dit bepaalt de kost) | Klasse |
|---|---|---|---|
| **G5** | Supabase / Firebase security | **Passief black-box**: publieke Firebase-rules `.json`, niet-geauthenticeerde Supabase `/rest/v1/`-endpoints, platform-headers. *Niet* een geauthenticeerde OAuth-integratie per vendor. | passief |
| **G6** | Subdomain-takeover detectie | Dangling-CNAME-fingerprint is goedkoop (CNAME-resolutie zit al in G1's resolver); de kost zit in de **subdomein-bron** (sitemap/cert-transparency/brute-lijst). | passief |
| **G7** | WAF/CDN- & DDoS-weerbaarheid + API-rate-limit-inspectie | **Geen load-generatie tegen sites van derden.** Fingerprint WAF/CDN + inspecteer rate-limit-headers/`429`-gedrag. Een begrensde burst alleen achter opt-in **én** eigendomsbewijs. | passief (+ optioneel actief) |
| **G8** | Threat Intelligence / reputatie | Domein/IP tegen blocklist- & malware-DB's (externe API-lookup). | passief |

## Tier 3 — Nieuwe actieve tests (opt-in + Pro; sommige eigendom-geverifieerd)

Deze erven de gating van plan 52 (`active: true` + opt-in + Pro).

| # | Gap | Extra gating | Klasse |
|---|---|---|---|
| **G9** | Authentication Flow Scanner (login/signup/password-reset) | **Eigendom-geverifieerd, niet alleen opt-in** — maakt accounts aan, verstuurt mail, kan lockouts op andermans systeem triggeren. | actief + eigendomsbewijs |
| **G10** | File Upload Security Scanner (unrestricted upload / RCE) | opt-in + Pro | actief |

## Parkeren — te definiëren

- **G11 — Audit Logging & Monitoring Scanner.** CheckVibe claimt "verifies security events are properly logged". Black-box heeft dit geen betrouwbare betekenis (je kunt andermans logging niet observeren). Markeer als *needs-definition*, lage prioriteit; niet blind een spec verzinnen.

---

## Aanbevolen volgorde

1. **Tier 1 (G1–G4)** — goedkoop, passief, groot dekkingswinst-per-euro. Plannen 68–71 zijn geschreven en klaar om op te pakken. G4 heeft bovendien een echte blinde vlek (URL-only sites zonder dep-dekking).
2. **G8 (Threat Intelligence)** — passieve externe lookup, laag risico, headline-waardig ("staat je domein op een blocklist?").
3. **G5 (Supabase/Firebase)** — sterk onderscheidend voor de vibe-coder-doelgroep; scope strak op passieve exposed-config.
4. **G7 / G6** — nuttig maar scope-gevoelig; eerst scope bevriezen.
5. **Tier 3 (G9/G10)** — hoogste risico/gating; pas na de eigendom-verificatie-flow.

## Classificatie-legenda

- **passief** = default-aan, geen interactie die de doelsite verandert (headers/DOM/DNS/externe lookup).
- **actief** = `active: true`, opt-in + Pro (stuurt payloads; erft plan 52).
- **actief + eigendomsbewijs** = actief én geverifieerd domeineigenaarschap vereist.

¹ Diepte t.o.v. CheckVibe's sub-check-aantallen niet 1-op-1 geverifieerd; dekking bevestigd.
