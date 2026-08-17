# Plan: On-deploy triggers (GitHub + Vercel webhooks → auto re-scan)

**Doel**: Automatisch een nieuwe scan starten zodra er gedeployed wordt: GitHub (push naar de default branch of `deployment_status`-success) en Vercel (`deployment.completed`). Inbound webhooks met secret-verificatie, gekoppeld aan `sites.github_repo`/site-URL — CheckVibe's "on-deploy triggers via the GitHub or Vercel integration".

**Status**: Nog niet gestart.

## Besluiten (bevestigd 2026-08-16)

1. **Routes**: `POST /api/webhooks/github` en `POST /api/webhooks/vercel` — publiek (geen sessie), alleen webhook-auth
2. **Verificatie**: GitHub = HMAC-SHA256 met per-site webhook-secret (`sites.github_webhook_secret`, random per site, encrypted at rest); Vercel = header `x-vercel-signature` met het per-team deploy-secret (env). Falende verificatie → `401`, geen existence-leak
3. **Koppeling**: GitHub-payload → `repository.owner/repo` → match op `sites.github_repo` (plan 04); Vercel-payload → `project`-naam/`url` → match op `sites.url`-hostname
4. **Events**: GitHub `push` op de default branch + `deployment_status` met `state=success` (per-site opt-in per eventtype); Vercel `deployment.completed`
5. **Cooldown per site** (Redis): max 1 webhook-scan per 10 min — tegen deploy-storms en webhook-loops
6. **Credits**: de automatische scan kost 1 credit; bij limiet skip + mail (zelfde patroon als plan 05, `trigger='deploy'`)
7. **Pro-only** via feature-flag `on_deploy` (feature 3); webhook-setup: knop "Webhook-URL kopiëren" + secret-tonen op de site-detailpagina (geen GitHub App-automatisering in v1)

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

- GitHub App (per-repo webhook instellen zonder secrets delen) automatiseren — v2 of helemaal niet (VPS + meerdere sites maakt App-verificatie via installatie-token complex)?
- Vercel: matchen op `url` in de payload (die is er bij `deployment.completed`) of op `project.name`-mapping-tabel (stabieler bij domain-wissel)?
- GitHub `deployment_status`-events zijn luidruchtig (per environment) — default alleen `production`-environment?

## Acceptatiecriteria

- [ ] Push naar default branch / deployment-success / Vercel-deploy start een nieuwe scan (`trigger='deploy'`)
- [ ] Verificatie faalt bij fout secret (401); onbekende repo's krijgen een stille 200
- [ ] Cooldown 10 min per site werkt (Redis); credits kosten 1; bij limiet skip + mail
- [ ] Pro-gate op de webhook-setup; UI toont URL + secret met copy-knop
- [ ] `scans.trigger` bevat `deploy`; notificaties (13) kunnen erop filteren
