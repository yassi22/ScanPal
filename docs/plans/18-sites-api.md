# Plan: sites CRUD API — normalisatie, duplicate-check, GitHub-detectie (feature 18)

**Doel**: De sites-routes van de app-laag compleet: URL-normalisatie en
duplicate-check (bestaan), GitHub-repo-detectie (nieuw: auto-detect uit het
URL-veld) en rol-gated verwijderen (nieuw: DELETE owner-only).

**Status**: Klaar (✅) — CRUD (zie Uitgangssituatie) + de gaten uit "Stappen"
(zijn het resterende werk) opgeleverd.

## Besluiten (bevestigd 2026-08-16)

1. **Apart plan** naast 17-auth-api; FEATURES.md-mapping wordt bijgewerkt.
   Plan 04 blijft de frontend/sites-pagina-dekking.
2. **GitHub auto-detect** (besluit gebruiker): een github.com-repo-URL of
   losse `owner/repo`-string in het URL-veld wordt herkend en automatisch als
   `github_repo` ingevuld. De invariant uit plan 04 blijft: een site heeft
   altijd een website-URL; een repo is een aanvulling.
3. **Rechten** (besluit gebruiker): members mogen sites toevoegen, wijzigen
   en scannen; **alleen owner mag verwijderen** (DELETE).
4. **Audit + gaten dichten** i.p.v. herspecen van wat al bestaat.

## Uitgangssituatie (code vandaag)

- `GET /api/sites` — team-scoped lijst met status (`last_scan_*`,
  `uptime_state`, `scan_frequency`, `next_scan_at`), gesorteerd op
  `last_scanned_at desc nulls last`; zod-validatie op de respons
- `POST /api/sites` — `addSiteInputSchema`, GitHub Pro-gating
  (`assertPlanFeature("github")` → 403 + upsell), `createSite` met canonieke
  dedupe + `reuse`-optie → 201 / 200 (reuse) / 409 / 400 / 403 / 500
- `PATCH/DELETE /api/sites/[id]` — team-scoped (niet-team → 404),
  `updateSiteInputSchema` (label/github_repo, minimaal één veld),
  GitHub-gating op PATCH, DELETE → 204
- `lib/sites-core.ts` — `createSite` (transactie, dedupe in code via
  `canonicalizeSiteUrl`-vergelijking + unique-index backstop `23505`→409),
  `updateSite`, `deleteSite`, `setSiteScanState` (idempotente status-cache)
- `packages/shared/src/sites.ts` — `canonicalizeSiteUrl` (protocol + www
  gestript), `canonicalizeGithubRepo` (owner/repo, lowercase, github.com-links
  + `.git`), schema's `siteSchema`/`addSiteInputSchema`/
  `updateSiteInputSchema`/`siteWithStatusSchema`/`siteListResponseSchema`
- Gekoppeld: `POST /api/onboarding/sites` (plan 01), `api/sites/[id]/schedule`
  (plan 05), sites-manager UI (`components/sites-manager.tsx`), scans
  koppelen aan `POST /api/scans` (plan 05/19)

## Gaten (nog te doen)

1. **GitHub auto-detect ontbreekt**: `github_repo` is nu alleen een expliciet
   veld. Toevoegen: detectie in het URL-veld (server + client), zie Contract.
2. **DELETE is niet rol-gated**: elke member kan sites verwijderen via
   `requireTeam`. Fix: sessie + owner-vereiste; members → 403.
3. **Client-side detectie ontbreekt**: het add-formulier vult het repo-veld
   niet automatisch aan (losse `owner/repo`-string of github.com-URL wordt nu
   als ongeldige website-URL afgewezen zonder uitleg).
4. **Tests voor detectie + rechten ontbreken**: wel validatie-/core-tests,
   geen test voor auto-detect, DELETE-403-member of github.com-URL in het
   url-veld.

## Contract / API

### Auto-detect (feature 18)

Nieuwe helper in `packages/shared`: `detectGithubRepoFromUrl(raw)` →
`owner/repo | null` — herkent:
- `https://github.com/owner/repo` (met/zonder www, trailing `.git`, subpaden
  afwijzen via `canonicalizeGithubRepo`)
- losse `owner/repo`-string (pattern `^[a-z0-9_.-]+\/[a-z0-9_.-]+$`)

Gedrag op `POST /api/sites`:

| Input `url` | `github_repo`-veld | Resultaat |
|---|---|---|
| website-URL | leeg | zoals nu (repo = null) |
| website-URL | expliciet | zoals nu (Pro-gating) |
| website-URL | leeg, maar url bevat repo? (n.v.t.) | — |
| `github.com/owner/repo` | leeg | repo automatisch gezet; url is géén website → 400 met melding "GitHub-repo herkend als owner/repo — vul ook een website-URL in" |
| `github.com/owner/repo` | expliciet | 400 als boven (url blijft ongeldig als website) |
| losse `owner/repo` | leeg | 400 bestaande URL-validatie; client pre-fillt het repo-veld + hint |

Implementatie:
- `addSiteInputSchema.superRefine`: als `detectGithubRepoFromUrl(url)` iets
  oplevert én `github_repo` leeg is → repo invullen (custom issue of
  transform), en url weigeren (geen geldige website-URL) met de melding
  hierboven
- `createSite`: `githubRepo = explicit ?? detectGithubRepoFromUrl(url)` —
  zelfde logica voor de onboarding-route (één helper in `lib/sites-core`)

### Rechten

- `DELETE /api/sites/[id]`: sessie + owner (`requireSessionOwner`-patroon uit
  `lib/api-auth.ts`), member → 403; bearer keys → 401/403 (open vraag, zie
  Open vragen); niet-team site blijft 404
- `POST`/`PATCH`/`GET`: ongewijzigd (ieder teamlid); PATCH met `github_repo`
  blijft Pro-gated
- UI: verwijder-knop alleen zichtbaar voor owner (rol uit `GET /api/me` →
  `membership.role`)

## Stappen

1. `packages/shared`: `detectGithubRepoFromUrl` + `superRefine` op
   `addSiteInputSchema` (auto-fill + 400-melding); unit-tests
2. `lib/sites-core.ts` `createSite`: repo uit url detecteren als veld leeg
   (ook voor `POST /api/onboarding/sites`)
3. `DELETE /api/sites/[id]`: owner-gate (member → 403) + tests
4. Client: auto-detect in `sites-manager.tsx` (github.com-URL/losse
   owner-repo → repo-veld pre-fill + hint; verwijder-knop owner-only)
5. Tests: detectie-cases (github.com-URL, www, `.git`, owner/repo, subpad
   afwijzen), 400-meldingen, DELETE 403-member/204-owner, onboarding-route
   consistent
6. FEATURES.md 18 → ✅ en ROADMAP Fase 1 "Klaar als" checken zodra alles
   groen is

## Open vragen

- **Repo-only sites**: nu verboden (plan 04: repo = aanvulling op website).
  Zodra de GitHub-worker (46–49) er is: losse repo-sites toestaan met
  `scan.github`-only? → voorstel: v2, dan wel met apart besluit toestaan.
- **Bearer keys op DELETE**: owner-only routes zijn sessie-only (plan 14-
  patroon); keys die sites mogen verwijderen komen later met rol-claims op de
  key-rij (open vraag uit plan 17, hier van toepassing op DELETE).

## Acceptatiecriteria

- [x] github.com-repo-URL of losse `owner/repo` in het URL-veld wordt herkend
      en automatisch in `github_repo` gezet (server + pre-fill in UI)
- [x] Een url die alleen een GitHub-repo is, geeft 400 met de melding uit het
      Contract (website-URL blijft vereist, invariant plan 04)
- [x] DELETE werkt voor owner (204) en geeft member 403; niet-team-site 404
- [x] Onboarding-route (`POST /api/onboarding/sites`) deelt dezelfde
      detectie- en validatielogica
- [x] Unit-tests: detectie, 400-cases, DELETE-rechten, dedupe/409 (bestaand
      blijft groen); lint + typecheck + build groen
- [x] FEATURES.md 18 + ROADMAP Fase 1 status up-to-date
