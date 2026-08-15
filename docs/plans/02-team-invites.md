# Plan: Team-uitnodigingen + rollen (owner/member)

**Doel**: Owner nodigt leden uit per e-mail; leden zien en scannen de gedeelde team-sites.
Rollen: `owner` (beheer) en `member` (gebruik).

**Status**: **Klaar (2026-08-15)** — migratie toegepast, 25 unit-tests, lint + typecheck + build groen.
Deels afwijkend van dit plan: zie "Uitvoeringsstatus" onderaan.

## Uitgangssituatie (code vandaag)

- `memberships` heeft al `role` (`owner`|`member`), `status` (`pending`|`accepted`), `invited_by` (migratie `001_users_teams_memberships.sql`)
- `ensureUserTeam` (`apps/web/lib/team-core.ts`) maakt bij eerste login team + owner
- Scan-queries scopen al via `memberships` (zie `GET /api/scans/[id]`) → leden zien automatisch team-scans
- Zod schema's voor rollen/status staan al in `packages/shared` (`userRoleSchema`, `membershipStatusSchema`)

## DB (migratie `002_invitations.sql` in `packages/db`)

```sql
create table if not exists invitations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('owner', 'member')),
  token text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists invitations_pending_unique
  on invitations (team_id, lower(email)) where accepted_at is null;
```

- Expiry: 7 dagen (`expires_at = now() + interval '7 days'`)
- Maximaal één openstaande uitnodiging per team + e-mail (unique partial index)

## API routes (`apps/web/app/api/`)

| Route | Methode | Rechten | Beschrijving |
|---|---|---|---|
| `/api/teams/{id}/invitations` | POST | owner | Invite aanmaken, Resend-mail sturen naar `/invite/{token}` |
| `/api/invitations/{token}` | GET | publiek | Validatie + meta (team, email, status) — idempotent |
| `/api/invitations/{token}/accept` | POST | ingelogd | Accepteren → membership `accepted`, token verbruikt |
| `/api/teams/{id}/members` | GET | lid | Ledenlijst met rollen |
| `/api/teams/{id}/members/{userId}` | PATCH | owner | Rol wijzigen |
| `/api/teams/{id}/members/{userId}` | DELETE | owner | Lid verwijderen |

## Authz (`apps/web/lib/authz.ts`, nieuw)

- `requireTeamMember(teamId)` → membership met status `accepted`, anders 403
- `requireOwner(teamId)` → rol `owner`, anders 403
- `getTeamForUser(userId)` → team van de user (via `ensureUserTeam`)
- Laatste-owner-waarborg: verwijderen/rolwijzigen geblokkeerd als er nog maar 1 owner is
- Zod-validatie op elke boundary (email, role, userId)

## Flow uitnodiging

1. Owner vult e-mail in op Team-pagina → `POST` → `invitations`-rij + mail via Resend (`invite.html` template met link)
2. Logged-out user klikt link → redirect naar login/register → daarna terug naar `/invite/{token}`
3. Accept → `memberships` insert met `invited_by`, `accepted_at` op de invitation (idempotent: token eenmalig)
4. Vervallen token (`expires_at < now()`) → 410 Gone; bestaand lid → 409
5. Nieuwe member ziet team-sites/scans direct (bestaat al via memberships-joins)

## UI (`(dashboard)/settings/team`)

- Invite-formulier (email + rol) — alleen owner
- Pending-lijst met annuleer-knop (invite intrekken = rij verwijderen)
- Ledentabel: naam, email, rol-dropdown (owner/member), verwijder-knop — alleen owner
- Statusbalk: ledenlimiet per plan (n/a op free-plan zolang Feature 3 er niet is)

## Stappen

1. Migratie `002_invitations.sql` + update `packages/db` runner
2. `lib/authz.ts` + route guards
3. Invite-API's (POST/GET/accept) + Resend template + env `RESEND_API_KEY`
4. Accept-flow met logged-out redirect (query-param `next=/invite/{token}`)
5. Team-settings UI
6. Tests: authz-matrix (owner/member/gast), accept idempotentie, expiry, laatste-owner-waarborg
7. Koppeling met Feature 3: ledenlimiet per plan afdwingen bij invite

## Open vragen

- Ledenlimiet per plan → koppelt met Feature 3 (`max_members` in plancatalogus); free = 3, pro = 10?
- Mag een owner zichzelf uit het team verwijderen? (Nee — laatste owner behouden)
- Email via Resend template of via Supabase Auth (SMTP staat al geconfigureerd)? *(voor nu: Resend)*

## Uitvoeringsstatus

**Klaar (2026-08-15):** migratie `002_invitations.sql` toegepast op de hosted DB; zod schema's
(`inviteInputSchema`, `invitationSchema`, `teamMemberSchema`, `roleChangeSchema`) in `packages/shared`;
core-logica in `lib/invites-core.ts` (genereert 32-byte hex tokens, 7 dagen TTL, laatste-owner-waarborg,
idempotente accept via `on conflict do nothing`); `lib/authz.ts` (`requireTeamMember`/`requireOwner`,
401/403); API routes onder `/api/teams/{id}/invitations`, `/api/invitations/{token}[/accept]`,
`/api/teams/{id}/members[/{userId}]`; publieke `/invite/{token}` pagina (proxy.ts laat `/invite` door
zonder sessie) met logged-out CTA → login/register met `next`-param; team-settings UI op
`/settings/team` (invite-form, openstaande uitnodigingen met annuleren, ledentabel met rol-dropdown en
verwijderen, alleen voor owner); "Team"-link in dashboard-header. Tests 25/25 + bestaande 4/4, lint,
typecheck en `next build` groen.

**Let op:** `RESEND_API_KEY` staat nog niet in `.env` → uitnodigingsmails worden geskipt met een
console-warning (invite zelf wordt wél aangemaakt en is via de link bruikbaar). Vul de key in om mails
te versturen. E2E-test tegen live app (met sessie) staat nog open — eerstvolgende smoke-run.

**Afwijkend van plan:**
- `invitations` heeft ook `invited_by` (genomen uit de sessie van de owner) → memberships erft dit.
- Accept controleert dat het ingelogde e-mailadres overeenkomt met de uitnodiging (`email_mismatch` →
  403) — extra veiligheid.
- Expiry wordt ook server-side in `acceptInvitation` gecontroleerd (niet alleen in GET).
- Openstaande uitnodigingen worden opgehaald met `expires_at > now()` (vervallen verdwijnen uit de UI).

## Acceptatiecriteria

- [x] Owner kan uitnodigen; member ontvangt mail met geldige link *(mail zodra RESEND_API_KEY erin)*
- [x] Accept werkt ingelogd én logged-out (na login redirect terug)
- [x] Members zien en scannen gedeelde team-sites; alleen owner beheert team
- [x] Rolwijziging + verwijderen werken en zijn geblokkeerd voor members
- [x] Laatste owner kan niet worden verwijderd/demoted
- [x] Vervallen tokens afgewezen; hergebruik van een token is idempotent
