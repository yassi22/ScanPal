# Plan: Team seats + client-workspaces + white-label (Max-plan)

**Doel**: Het Max-plan compleet maken — 3 team-seats inbegrepen (uitbreidbaar), client-workspaces met een klantportaal (delen van rapporten via token-URL) en white-label-rapporten (eigen logo/branding, geen ScanPal-naam). Dit is CheckVibe's Max: "3 team seats, white-label reports, client workspaces + portal, commercial client use & report resale".

**Status**: Nog niet gestart.

## Besluiten (bevestigd 2026-08-16)

1. **Billing**: feature-flags `seats` (aantal) en `white_label` op het Max-plan (feature 3/plan 03); seats = aantal **actieve** memberships (feature 2/plan 02); invite-route blokkeert bij bereikte limiet (409 + upsell) tot downgrade
2. **White-label**: per-team branding-tokens `teams.branding jsonb` (`{ logo_url, primary_color, report_name, hide_branding bool }`) → de PDF/MD-renderer (plan 10) gebruikt ze i.p.v. ScanPal-branding; instellingen-UI in settings (16)
3. **Client-workspaces**: teams kunnen sub-teams ("workspaces") aanmaken (`workspaces`-tabel: `parent_team_id`, eigen sites-schema); members van een workspace zien alleen die workspace-sites; owner ziet alles
4. **Portaal**: publieke read-only rapport-view via token-URL (`(public)/report/[token]`, token random 16+ tekens, noindex, expiry optioneel) — klanten hoeven geen account te maken (CheckVibe "client portal")
5. **Licentie/resale**: commerciële rechten (rapport-resale, white-label) zijn een juridische kwestie → Terms-pagina-tekst (geen code); UI toont alleen de feature en een licentie-link
6. **Geen eigen abonnement per workspace**: workspaces zijn een organisatiestructuur van het team, geen aparte billing-entiteit (prijsmodel eenvoudig houden)

## Uitgangssituatie (code vandaag)

- Teams + memberships + rollen (feature 2, plan 02); billing + plan-limieten (feature 3, plan 03); export PDF/MD (9/21, plan 10); settings (16) en abonnement-beheer (22)
- Geen branding-tokens, workspaces of portaal-route; invite-route kent geen seat-limiet

## Contract / DB / API

- Migratie: `teams.branding jsonb not null default '{}'`; `workspaces` (`id`, `parent_team_id`, `name`, `created_at`); `sites.workspace_id uuid null` (FK); `reports` krijgt géén eigen tabel — portaal-tokens op `scans.report_token` of een `report_tokens`-tabel (`scan_id`, `token`, `expires_at`)
- `POST /api/teams/workspaces` + `PATCH /api/teams/[id]/workspaces/[wid]` (authz: owner); invite-route (plan 02) krijgt seat-check
- `PATCH /api/teams/[id]/branding` (owner) → zod-schema `brandingSchema`
- `GET /api/public/report/[token]` → publieke read-only rapportdata (masked findings, geen evidèntie/secrets); `(public)/report/[token]/page.tsx` rendert het rapport met team-branding

## Stappen

1. Migratie + shared schema's (`brandingSchema`, `workspaceSchema`, `reportTokenSchema`) + token-helpers
2. Seat-check in de invite-route + upsell-payload (billing-feature)
3. Branding-tokens + instellingen-UI; PDF/MD-renderer leest branding (plan 10-uitbreiding)
4. Workspaces: CRUD + site-koppeling + membership-scoping (query's op `workspace_id`)
5. Portaal: token-generatie (bij voltooide scan optioneel), publieke route + read-only data-builder (masked, geen secrets — vgl. publieke statuspagina 57), noindex + rate limit
6. Tests: seat-limiet (409), branding in PDF/MD, workspace-scoping (members zien alleen eigen workspace), token-authz (geen brute-force), masked publieke data

## Open vragen

- Seats-definitie: "actief" = uitgenodigd + geaccepteerd, of ook owners — en telt de owner zelf mee (3 seats incl. owner)?
- Rapporten-token: per scan (eenvoudig, expireerbaar) of per site (portaal met alle rapporten)? — voorstel per scan + site-overzicht later
- Workspace-rollen: eigen owner/member-rol binnen een workspace, of één rol (member) volstaat?

## Acceptatiecriteria

- [ ] Max-plan heeft 3 seats; invite bij limiet → 409 + upsell; downgrade werkt (actieve members vallen niet weg, invites stoppen)
- [ ] White-label-branding (logo, kleur, naam, hide-branding) zit in PDF en MD; geen ScanPal-naam bij `hide_branding`
- [ ] Workspaces bestaan, sites hangen eraan en membership-scoping werkt (member ziet alleen de eigen workspace)
- [ ] Portaal-token geeft read-only, gemaskeerd, gebrandingd rapport; noindex + rate limited; brute-force-proof tokens
- [ ] Licentie-link naar Terms in de UI; geen hardcoded juridische claims in code
