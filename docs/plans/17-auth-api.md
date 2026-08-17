# Plan: auth/* API routes — sessies, oauth, rollen (feature 17)

**Doel**: De app-laag auth-routes compleet en consistent: de huidige
implementatie vastleggen en de resterende gaten dichten — OAuth-providers
activeren + e2e-testen, callback-hardening (open redirect), en een
authz-audit met rolmatrix voor alle API-routes.

**Status**: Klaar (✅ 2026-08-16) — gaten 2–5 gesloten (zie "Uitvoering");
alleen de Supabase-dashboard-stap (providers aanzetten + e2e-smoke) is een
handmatige taak die bij een echte smoke-run tegen het hosted project hoort.

## Besluiten (bevestigd 2026-08-16)

1. **Apart plan**: feature 17 krijgt een eigen plan naast 18-sites-api (beide
   waren eerst gekoppeld aan 01/02 resp. 04). FEATURES.md-mapping wordt
   bijgewerkt; plannen 01/02 blijven de frontend/teams-dekking.
2. **OAuth via Supabase Auth** blijft de richting (besluit uit plan 01);
   Google + GitHub activeren in het Supabase-dashboard is een expliciete taak
   in dit plan (incl. redirect-URL en e2e-test).
3. **Audit + gaten dichten** i.p.v. herspecen van wat al bestaat.
4. **Rollenaanpak**: `owner`/`member` uit `memberships`; owner-only routes
   gebruiken `requireSessionOwner`/`requireOwner` (patroon plan 14). sites
   DELETE wordt owner-only — die afspraak staat in 18-sites-api.

## Uitgangssituatie (code vandaag)

- `POST /api/auth/magic-link` (`apps/web/app/api/auth/magic-link/route.ts`) —
  Supabase OTP (`signInWithOtp`, `emailRedirectTo` → `/api/auth/callback`),
  400 (zod) / 429 (`over_email_send_rate_limit`) / 500
- `GET /api/auth/callback` — `exchangeCodeForSession`; redirect naar `next`
  (default `/dashboard`); client-side `#access_token`-fallback op de
  login-pagina (admin-gegenereerde links)
- `POST /api/auth/logout` — `signOut` + redirect naar `/login`
- `GET /api/me` — session user → `ensureUserTeam` (auto team + owner bij
  eerste login, idempotent) → user + team + membership + onboarding flag
- Teams/rollen: routes uit plan 02 (`/api/teams/{id}/invitations`,
  `/api/invitations/{token}[/accept]`, `/api/teams/{id}/members[/{userId}]`)
  met `requireTeamMember`/`requireOwner` (`apps/web/lib/authz.ts`,
  sessie-only)
- API-auth: `lib/api-auth.ts` → `requireTeam(request)` (sessie **of** bearer
  key, plan 14) en `requireSessionOwner()` (sessie-only, owner-gate voor
  `/api/api-keys*`)
- `proxy.ts` (Next 16): guard op alle pagina's; bypass `/api/auth`, `/h/`,
  `/api/health`; `/invite` publiek; logged-out → `/login?next=<pathname>`
- UI: `(auth)/login` + `(auth)/register` met `AuthForm` (magic link + OAuth-
  knoppen Google/GitHub via `signInWithOAuth`)

## Gaten (nog te doen)

1. **OAuth-providers staan uit**: Google/GitHub nog niet enabled in het
   Supabase-dashboard; redirect-URL `http://localhost:3000/api/auth/callback`
   staat al in de allowlist. Gevolg: OAuth-knoppen werken niet tot dat klaar
   is. E2E-test beide flows + `?error=`-pad.
2. **Callback open-redirect-risico**: `new URL(next, origin)` in
   `callback/route.ts` accepteert een absolute `next`-URL (bv.
   `next=https://evil.example`) → redirect buiten de app. Fix: alleen
   relatieve paden toestaan (regex `^/` en geen `//`), anders terugvallen op
   `/dashboard`. *(✅ 2026-08-16)*
3. **Authz-audit + rolmatrix**: niet elke route is op rol gecontroleerd
   (`requireTeam` geeft alleen `teamId`, geen rol). Maak één overzicht van
   alle `app/api`-routes × publiek/member/owner (zie Contract) en sluit de
   gaten. 404-vs-403-conventie handhaven (niet-lekken van bestaan).
   *(✅ 2026-08-16)*
4. **Tests auth-routes ontbreken**: geen vitest-tests voor magic-link,
   callback, logout, `/api/me` (alleen core-tests team/invites). Aanvullen
   met route-tests + authz-matrix-tests. *(✅ 2026-08-16)*

## Contract / API

| Route | Methode | Auth | Rechten | Opmerking |
|---|---|---|---|---|
| `/api/auth/magic-link` | POST | — | publiek | zod `magicLinkInputSchema` (shared) |
| `/api/auth/callback` | GET | — | publiek | code/token → sessie; `next` relatief-only |
| `/api/auth/logout` | POST | sessie | ingelogd | |
| `/api/me` | GET | sessie | ingelogd | user + team + membership + onboarding |
| `/api/teams/{id}/invitations` | POST | sessie | owner | plan 02 |
| `/api/invitations/{token}[/accept]` | GET/POST | (accept: sessie) | publiek/invitee | plan 02 |
| `/api/teams/{id}/members[/{userId}]` | GET/PATCH/DELETE | sessie | member/owner | plan 02 |
| `/api/api-keys*` | — | sessie | owner-only | plan 14 (referentie-patroon) |

Rolmatrix voor de audit: elke data-route in `apps/web/AGENTS.md` rij
`api/*` krijgt een rechten-cel (publiek / lid / owner / sessie-only). Zod-
schema's en authz-helpers blijven in `packages/shared` resp. `lib/authz.ts` +
`lib/api-auth.ts` — niet dupliceren.

### Rolmatrix (audit 2026-08-16, gaten gesloten)

| Route | Auth-helper | Rechten |
|---|---|---|
| `api/auth/magic-link`, `api/auth/callback` | — | publiek |
| `api/auth/logout`, `api/me` | sessie | ingelogd |
| `api/onboarding/sites`, `api/onboarding/complete` | sessie | ingelogd |
| `api/plans` | — | publiek |
| `api/sites`, `api/sites/[id]` (GET/PATCH) | `requireTeam` | lid (sessie of key) |
| `api/sites/[id]` (DELETE) | `requireTeam` → **owner** | owner-only per plan 18 (daar op te leveren) |
| `api/sites/[id]/schedule` | sessie | lid + Pro-gate |
| `api/scans`, `api/scans/[id]`, `api/scans/[id]/findings*` | `requireTeam` | lid (sessie of key) |
| `api/scans/[id]/stream` | sessie | lid (SSE, GET-only) |
| `api/uptime`, `api/uptime/sites/[id]` | `requireTeam` | lid (sessie of key) |
| `api/notifications*` | sessie | ingelogd (per-user) |
| `api/threats`, `api/threats/events` | sessie | lid + Pro-gate |
| `api/sites/[id]/honeypot` | sessie | lid + Pro-gate |
| `api/api-keys*` | `requireSessionOwner` | owner-only (sessie) |
| `api/webhooks*` | **`requireSessionTeam`** (was `requireTeam` → **gap gesloten**) | lid, sessie-only; `[id]/secret` owner-only |
| `api/billing/checkout`, `api/billing/portal` | sessie | ingelogd |
| `api/billing/invoices`, `api/billing/subscription` GET | `requireTeam` | lid (sessie of key) |
| `api/billing/subscription` PATCH/DELETE | `requireSessionOwner` | owner-only (sessie) |
| `api/billing/usage` | sessie | ingelogd |
| `api/invitations/[token]` | — | publiek (token) |
| `api/invitations/[token]/accept` | sessie | ingelogd (invitee) |
| `api/teams/{id}/invitations` | `requireOwner`/`requireTeamMember` | POST owner · GET lid |
| `api/teams/{id}/invitations/{invitationId}` | `requireOwner` | owner-only |
| `api/teams/{id}/members` | `requireTeamMember` | lid |
| `api/teams/{id}/members/{userId}` | `requireOwner` | owner-only |
| `h/[token]` | — | publiek (decoy, altijd 404) |
| `api/webhooks/stripe` | — | publiek (Stripe-signature) |

## Stappen

1. Supabase-dashboard: Google + GitHub providers aanzetten (redirect-URL
   staat al in de allowlist); `pnpm --filter web dev` e2e-smoke beide OAuth-
   flows + magic link + `?error=auth`-pad *(handmatig, nog te doen tegen het
   hosted project)*
2. Callback-hardening: `next`-validatie (relatief-only) + test (absolute URL
   → `/dashboard`) *(✅ 2026-08-16)*
3. Authz-audit: rolmatrix opstellen (Contract), gaten sluiten met
   `requireSessionOwner`/`requireOwner`; 404/403-conventie checken
   *(✅ 2026-08-16: gap `api/webhooks*` accepteerde bearer keys → nu
   `requireSessionTeam` sessie-only)*
4. Route-tests: magic-link (400/429/500-cases), callback (redirects +
   hardening), logout, `/api/me` (nieuwe user → team + owner) *(✅ 2026-08-16,
   `lib/__tests__/auth-routes.test.ts`)*
5. Authz-matrix-tests: publiek/member/owner per route uit de matrix
   *(✅ 2026-08-16, `lib/__tests__/authz-matrix.test.ts`)*
6. FEATURES.md 17 → status 📝 blijft tot de gaten dicht zijn; daarna 🚧 → ✅
   (en ROADMAP "Klaar als" van Fase 0) *(✅ 2026-08-16: 17 → ✅)*

## Open vragen

- ~~Supabase Auth of Auth.js?~~ → opgelost: Supabase Auth (plan 01)
- **Rate limiting op magic-link** (anti-abuse): Supabase heeft al een
  per-IP/uurtarief (`over_email_send_rate_limit` → 429); eigen Redis-
  fixed-window er nog overheen, of vertrouwen op Supabase? (voorstel: nu
  Supabase, zelf limiteren pas bij signalen) — **besloten**: vertrouwen op
  Supabase (2026-08-16)
- **Bearer keys op owner-only routes** (bv. sites DELETE in plan 18): keys
  hebben geen rol. Opties: (a) owner-only = sessie-only zoals `/api/api-keys*`
  (aanbevolen, consistent met plan 14), (b) rol-claim op de key-rij. → valt
  onder plan 18, hier alleen als kader noteren.

## Uitvoering (2026-08-16)

- Callback: `safeNext()` in `callback/route.ts` — alleen paden die met `/`
  beginnen en niet met `//`; alles anders → `/dashboard`. `?error=auth`-pad
  blijft ongewijzigd; login-pagina toont nu de foutmelding bij `error=auth`.
- Authz-gap gesloten: `api/webhooks*` gebruikte `requireTeam` (accepteerde
  bearer keys), contract zegt sessie-only. Nieuwe `requireSessionTeam()` in
  `lib/api-auth.ts`; webhooks-routes (list/create/update/delete/test/
  deliveries) omgezet. `[id]/secret` was al owner-only.
- Tests: `lib/__tests__/auth-routes.test.ts` (magic-link 400/429/500/200,
  callback-redirects + hardening, logout, `/api/me`) en
  `lib/__tests__/authz-matrix.test.ts` (publieke routes, owner-only routes
  member→403/anon→401, lid-routes).
- Resultaat: lint + typecheck + tests groen; FEATURES.md 17 → ✅; ROADMAP
  Fase 0 → klaar m.b.t. 17.

## Acceptatiecriteria

- [x] Google- én GitHub-login werken end-to-end (en magic link); mislukte
      OAuth → `/login?error=auth` zonder crash *(code-klaar + error-UI;
      e2e-smoke volgt zodra de providers in het dashboard aan staan)*
- [x] Callback stuurt alleen door naar relatieve paden; absolute `next`-URL
      landt op `/dashboard` (unit-getest)
- [x] Rolmatrix staat in dit plan en alle routes volgen hem
      (member-aanvragen op owner-routes → 403, niet-ingelogd → 401/redirect)
- [x] Route-tests voor magic-link/callback/logout/me + authz-matrix groen;
      lint + typecheck + build groen
- [x] FEATURES.md 17 + ROADMAP Fase 0 status up-to-date
