# Plan: On-deploy triggers (GitHub + Vercel webhooks → auto re-scan)

**Doel**: Automatisch een nieuwe scan starten zodra er gedeployed wordt: GitHub (push naar de default branch of `deployment_status`-success) en Vercel (`deployment.completed`). Inbound webhooks met secret-verificatie, gekoppeld aan `sites.github_repo`/site-URL — CheckVibe's "on-deploy triggers via the GitHub or Vercel integration".

**Status**: ✅ Klaar (2026-08-17).

## Besluiten (bevestigd 2026-08-16)

1. **Routes**: `POST /api/webhooks/github` en `POST /api/webhooks/vercel` — publiek (geen sessie), alleen webhook-auth
2. **Verificatie**: GitHub = HMAC-SHA256 met per-site webhook-secret (`sites.github_webhook_secret`, random per site, encrypted at rest); Vercel = header `x-vercel-signature` met het per-team deploy-secret (env). Falende verificatie → `401`, geen existence-leak
3. **Koppeling**: GitHub-payload → `repository.owner/repo` → match op `sites.github_repo` (plan 04); Vercel-payload → `project`-naam/`url` → match op `sites.url`-hostname
4. **Events**: GitHub `push` op de default branch + `deployment_status` met `state=success`; Vercel `deployment.completed`. Eén webhook-URL per site dekt beide GitHub-events; géén per-eventtype-toggle in v1 (de cooldown dempt storms)
5. **Cooldown per site** (Redis): max 1 webhook-scan per 10 min — tegen deploy-storms en webhook-loops
6. **Credits**: de automatische scan kost 1 credit; bij limiet skip + mail (zelfde patroon als plan 05, `trigger='deploy'`)
7. **Pro-only** via feature-flag `onDeploy` (feature 3); webhook-setup: knop "Webhook-URL kopiëren" + secret-tonen op de site-detailpagina (geen GitHub App-automatisering in v1)
8. **Vercel-secret is één deploy-brede env-var** (`VERCEL_WEBHOOK_SECRET`) — env is deploy-scoped, dus niet per team. Alle teams verifiëren met hetzelfde secret; de payload-URL bepaalt de site
9. **Response-contract** (bij meerdere gematched sites): `202 { scans: [{ site_id, scan_id }] }` i.p.v. een enkele `{ scan_id }` — superset van het contract
10. **GitHub-deployment_status**: alle `state=success` events tellen (geen environment-filter in v1) — cooldown dempt de ruis

## Uitgangssituatie (code vandaag)

- `sites.github_repo` (plan 04) bestaat na Fase 1; `POST /api/scans` (plan 05) met credit-afdwinging
- Webhook-verificatie-pattern bestaat bij Stripe-webhooks (22); `scans.trigger` uit plan 05 kent nu `manual|schedule` → wordt uitgebreid met `deploy`
- BullMQ-pipeline (Fase 3) is de enqueue-route; in inline-modus start de webhook de inline-probe (consistent met plan 05 besluit 10)

## Contract / DB / API

- Migratie: `sites.github_webhook_secret text null`; `scans.trigger` check-constraint uitbreiden met `'deploy'`
- Shared: `githubWebhookSchema` (push + deployment_status), `vercelWebhookSchema` (deployment.completed), zod-parse + reject on mismatch
- Reacties: geldig + scan gestart → `202 { scan_id }`; niet-gematcht (onbekende repo/url) → `200` (stil, geen 404-leak); gecooldown → `200` met `skipped: true`; ongeldig → `401/400`

## Stappen

1. Migratie + shared schema's + HMAC-verificatie-helpers (hergebruik Stripe-pattern) + tests
2. `POST /api/webhooks/github`: parse, verify, match repo, cooldown-check, credit, enqueue `scan.dispatcher` met `trigger='deploy'`
3. `POST /api/webhooks/vercel`: zelfde flow met hostname-match
4. Scheduler/plan 05: `trigger='deploy'` kost credit en volgt dezelfde skip+mail-logica
5. UI: webhook-setup-blok op site-detail (URL + secret + copy-knop), Pro-gate
6. Tests: HMAC-verificatie (incl. timing-safe compare), event-filtering, cooldown, credit-skip, no-existence-leak, URL-match edge-cases (www, protocol)

## Open vragen

- ~~GitHub App (per-repo webhook instellen zonder secrets delen) automatiseren~~ → besloten: v1 gebruikt per-site webhook-secrets (Besluit 7); App-automatisering is v2/geen
- ~~Vercel: matchen op `url` in de payload of op `project.name`-mapping-tabel~~ → besloten: match op `payload.url`-hostname (Besluit 3/9); helper `vercelUrlMatchesSite` stript protocol/www/case en negeert paden
- ~~GitHub `deployment_status`-events zijn luidruchtig (per environment)~~ → besloten: alle `state=success` tellen, cooldown dempt (Besluit 10)

## Acceptatiecriteria

- [x] Push naar default branch / deployment-success / Vercel-deploy start een nieuwe scan (`trigger='deploy'`)
- [x] Verificatie faalt bij fout secret (401); onbekende repo's krijgen een stille 200
- [x] Cooldown 10 min per site werkt (Redis); credits kosten 1; bij limiet skip + mail
- [x] Pro-gate op de webhook-setup; UI toont URL + secret met copy-knop
- [x] `scans.trigger` bevat `deploy`; notificaties (13) kunnen erop filteren
