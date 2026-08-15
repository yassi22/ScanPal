# Plan: Registratie/login + onboarding

**Doel**: Magic link + OAuth (Google/GitHub) via Supabase Auth, auto-team bij eerste login, 3-staps onboarding met eerste scan.

## DB (migratie in `packages/db`)

- `users` uitbreiden: `auth_provider`, `avatar_url`, `last_login_at`, `onboarding_completed_at`
- Bij eerste login auto-creëren `teams` + `memberships` (role=owner), idempotent (unique `user_id` per team).

## API routes (`apps/web/app/api/`)

| Route | Methode | Beschrijving |
|---|---|---|
| `/api/auth/magic-link` | POST | Email + Resend mail met tokenlink |
| `/api/auth/callback` | GET | Supabase callback → session |
| `/api/auth/logout` | POST | Session vernietigen |
| `/api/me` | GET | Session user + team |
| `/api/onboarding/sites` | POST | Eerste site aanmaken + scan triggeren (via `POST /api/scans`) |

## UI

- `(auth)/login` + `(auth)/register`: magic link form + OAuth knoppen
- Onboarding-wizard in `(dashboard)/onboarding`:
  1. URL invoeren
  2. Scan-progress (pollen `GET /api/scans/{id}`)
  3. Resultaat-samenvatting → klaar, redirect naar dashboard

## Stappen

1. Supabase project + env keys, `lib/auth.ts` helpers (server + client), middleware die dashboard routes beveiligt
2. Login/register-pagina's + Resend magic-link template
3. Team-creatie bij eerste login (DB trigger of webapp, idempotent)
4. Onboarding-wizard + redirect-logica (nieuwe users → `/onboarding`)
5. Tests: E2E magic link flow (Playwright), unit team-creatie

## Open vragen

- Supabase Auth of Auth.js? (AGENTS.md laat beide open — Supabase aanbevolen)
- Redirect bij logged-out invite: login → terug naar invite (Feature 2)

## Acceptatiecriteria

- [x] Magic link stuurt mail, klik logt in *(implementatie klaar; e2e-test zodra Supabase keys staan)*
- [x] Google/GitHub login werkt *(implementatie klaar; e2e-test zodra providers enabled zijn in Supabase)*
- [x] Eerste login maakt team + owner membership *(unit-getest, idempotent)*
- [x] Onboarding leidt naar eerste scan en eindigt op dashboard
- [x] Alle dashboard routes vereisen sessie *(proxy redirect, smoke-getest)*

## Uitvoeringsstatus

**Klaar (2026-08-15):** monorepo bootstrap, `apps/web` (Next.js 16 + Tailwind v4), `packages/db` (migratie `001_users_teams_memberships` + runner), `packages/shared` (zod schema's), Supabase server/client helpers, `proxy.ts` (auth-guard), login/register + magic link (Supabase OTP) + OAuth-knoppen, auto team-creatie (`lib/team-core.ts`), onboarding-wizard (URL → scan → resultaat), inline scan-modus (`lib/scan-runner.ts`, dev-stand-in tot de BullMQ pipeline er is), `.env` + `.env.example`.

**E2E getest (2026-08-15) tegen live Supabase:** migratie toegepast op het hosted project; magic-link route, admin link-generatie, sessie-cookie (formaat `sb-<ref>-auth-token` met `base64-` + base64url), `/api/me` → team + owner-membership, onboarding-scan (score + 4 checks), onboarding-complete, dashboard-guard (met/zonder sessie) — alle PASS. Unit-testen 4/4, lint + typecheck groen.

**Redirect-URL actief:** `http://localhost:3000/api/auth/callback` staat in de allowlist; de verify-link stuurt nu door naar de callback. Opgelet: deze Supabase-versie leest `redirect_to` alleen uit **header/query-string**, niet uit de JSON-body — dat geldt alleen voor de admin generateLink API; de echte `signInWithOtp`-flow gebruikt `email_redirect_to` en werkt normaal.

**Bekende beperkingen:** (1) GoTrue weigert e-mails op domeinen zonder MX-record (zoals `scanpal.dev`) en kent rate limits per IP/uurtarief (`over_email_send_rate_limit` → route geeft 429 met duidelijke melding). (2) Admin-gegenereerde links leveren tokens in de URL-fragment; daarom heeft de login-pagina een client-side fallback (`#access_token` → setSession). (3) De magic-link route kan nog een uur op 429 staan door het testverbruik van vandaag.

**Nog doen in het Supabase-dashboard (1 minuut):**
1. **Redirect URL**: Authentication → URL Configuration → Redirect URLs → voeg toe `http://localhost:3000/api/auth/callback` (zodat de magic link naar de callback gaat i.p.v. naar de homepage)
2. **Providers**: Authentication → Providers → enable Google en GitHub (Redirect URL `http://localhost:3000/api/auth/callback`)
3. **SMTP (Resend)**: Authentication → SMTP → Custom SMTP (smtp.resend.com:465) zodat mails gegarandeerd aankomen; zonder SMTP geldt het gratis Supabase-verzendquota

**Bekende beperkingen:** GoTrue weigert e-mails op domeinen zonder MX-record (zoals `scanpal.dev`) en kent rate limits per IP/uurtarief (`over_email_send_rate_limit` → route geeft 429 met duidelijke melding).

**Nog doen (vereist Supabase keys):**
1. ~~Vul `apps/web/.env`~~ (gedaan — anon key, service role en pooler-DATABASE_URL staan erin)
2. ~~Run migraties: `pnpm db:migrate`~~ (toegepast)
3. Enable providers (Google/GitHub) in Supabase dashboard → Authentication → Providers; Redirect URL `http://localhost:3000/api/auth/callback`
4. Voeg `http://localhost:3000/api/auth/callback` toe aan Authentication → URL Configuration → Redirect URLs
5. Optioneel: configureer Resend als SMTP in Supabase (Auth → SMTP) zodat magische links via Resend uitgaan

**Afwijkend van plan:** magic link gaat via Supabase OTP (emailRedirectTo) i.p.v. een eigen Resend-template — idiomatischer en betrouwbaarder; Resend koppelt via Supabase SMTP. `middleware.ts` → `proxy.ts` (Next 16).
