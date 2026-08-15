# Plan: Team-uitnodigingen + rollen

**Doel**: Owner nodigt leden uit per e-mail, leden delen sites/scans; rollen owner/member.

## DB (migratie in `packages/db`)

- `memberships` uitbreiden: `role` (`owner`|`member`), `status` (`pending`|`accepted`), `invited_by`
- Nieuwe tabel `invitations`: `token` (unique), `team_id`, `email`, `role`, `expires_at`, `accepted_at`

## API routes (`apps/web/app/api/`)

| Route | Methode | Rechten | Beschrijving |
|---|---|---|---|
| `/api/teams/{id}/invitations` | POST | owner | Uitnodiging aanmaken + Resend mail met `/invite/{token}` |
| `/api/invitations/{token}` | GET | publiek | Validatie + meta (team, email) |
| `/api/invitations/{token}/accept` | POST | ingelogd | Uitnodiging accepteren → membership `accepted` |
| `/api/teams/{id}/members` | GET | lid | Ledenlijst met rollen |
| `/api/teams/{id}/members/{userId}` | DELETE | owner | Lid verwijderen |
| `/api/teams/{id}/members/{userId}` | PATCH | owner | Rol wijzigen |

## Authz

- `lib/authz.ts`: `requireTeamMember(teamId)`, `requireRole(teamId, 'owner')`
- Alle site/scan-queries scop'en op `team_id`
- Zod validatie op elke boundary

## Flow uitnodiging

1. Owner vult email in → POST → `invitations` rij + mail (Resend)
2. Logged-out user klikt link → login/register → redirect terug naar `/invite/{token}`
3. Accept → membership `accepted`, token onbruikbaar (idempotent)
4. Nieuwe member ziet team-sites/scans op dashboard

## UI

- Settings → Team-pagina: invite-form, pending-lijst, ledentabel met rol-dropdown en verwijderknop (alleen owner)
- Uitnodigingsstatus/leeg-staat voor nieuwe members

## Stappen

1. Migratie: memberships-uitbreiding + `invitations`
2. `lib/authz.ts` helpers + route guards
3. Invite API's + Resend template
4. Accept-flow inclusief logged-out redirect
5. Team-settings UI
6. Sites/scans scopen op team
7. Tests: authz matrix (owner/member/gast), accept idempotentie, expiry

## Open vragen

- Ledenlimiet per plan (koppelt Feature 3)
- Kan owner zichzelf verwijderen? (Nee — laatste owner behouden)

## Acceptatiecriteria

- [ ] Owner kan uitnodigen per email; member ontvangt mail
- [ ] Accept via link werkt ingelogd + logged-out (na login)
- [ ] Members zien gedeelde sites/scans; alleen owner beheert team
- [ ] Verwijderen + rolwijziging geëffectueerd en geblokkeerd voor members
- [ ] Vervallen tokens worden afgewezen
