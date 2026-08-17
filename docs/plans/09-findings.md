# Plan: Findings — gefilterde lijst, details + remediatie, mark fixed/ignored

**Doel**: Per scan de findings tonen als gefilterde lijst op ernst/categorie/status, met per finding detail (beschrijving, evidence, remediatie) en de mogelijkheid een finding als `fixed`/`ignored` te markeren. Features 8 (UI) en 20 (API-routes).

**Status**: ✅ klaar (geïmplementeerd + getest, 2026-08-16).

## Besluiten (bevestigd 2026-08-15)

1. **Findings blijven in `scans.findings` (JSONB)** — geen aparte findings-tabel (data-model in root AGENTS.md); per-finding `status` wordt een mutable veld in het JSONB
2. **Finding-identiteit**: deterministische id binnen een scan — `` `${check_id}:${title-slug}` `` — stabiel voor PATCH-routes, API-consumers en **carry-over** van status over scans (feature 10 trends)
3. **Versioned schema** in `packages/shared/src/findings.ts`: `scans.findings` draagt `{ v: 1, items: [...] }` (payload-veld voor breaking changes, conform shared-AGENTS.md)
4. **Inline probe schrijft vanaf dit plan het nieuwe formaat** (i.p.v. `{ checks: [...] }`) — één bron; de workers van Fase 3 schrijven direct hetzelfde formaat
5. **API met server-side filters** (feature 20): `GET /api/scans/[id]/findings?severity=&category=&status=&q=&sort=&limit=&offset=` — de UI gebruikt dezelfde route (geen client-side filtering van de hele scan)
6. **Status-wijziging**: `PATCH /api/scans/[id]/findings/[findingId]` met `{ status: "open" | "fixed" | "ignored", note?: string }`; elke teammember (owner én member) mag dit
7. **UI**: findings-sectie op de resultatenpagina `(dashboard)/scans/[id]` (onder de scores uit feature 7): filter-chips per ernst met counts, categorie/status-filters, zoekveld, expandable detail met remediatie + status-knop
8. **Carry-over bij herscan**: na het schrijven van findings kopieert een helper de status + note uit de vorige scan van dezelfde site op basis van de stabiele id (`fixed`/`ignored` blijven staan; `open` wordt overschreven door de nieuwe scan)
9. **Legacy-data** (`{ checks: [...] }`): geen compat-mapping — oude scans tonen "geen findings — herscan" (nieuwe scans schrijven het nieuwe formaat)
10. **Zoekveld `q`** filtert op title + description + evidence (server-side, case-insensitive)

## Uitgangssituatie (code vandaag)

- `scans.findings` jsonb bevat nu `{}` of `{ checks: [{ id, name, status, detail }] }` (inline probe in `apps/web/lib/scan-runner.ts`)
- `GET /api/scans/[id]` retourneert findings mee; er zijn **geen** findings-routes, geen status-veld per finding, geen filter-ondersteuning
- `packages/shared` heeft nog geen findings-schema (alleen `index.ts` + `plans.ts`); `findings.ts` stond al gepland in `packages/shared/AGENTS.md`
- Resultatenpagina bestaat nog niet (komt uit plan 06/08); feature 8 bouwt de findings-sectie daarop — de API-routes zijn onafhankelijk bouwbaar

## Contract (`packages/shared/src/findings.ts`, nieuw)

```ts
export const findingSeveritySchema = z.enum(["critical", "high", "medium", "low", "info"]);
export type FindingSeverity = z.infer<typeof findingSeveritySchema>;

export const findingStatusSchema = z.enum(["open", "fixed", "ignored"]);
export type FindingStatus = z.infer<typeof findingStatusSchema>;

export const findingSchema = z.object({
  id: z.string(), // `${check_id}:${title-slug}` — uniek binnen een scan
  check_id: z.string(), // uit check-catalog (plan 06)
  category: scanCategorySchema, // http | seo | aeo | github
  severity: findingSeveritySchema,
  title: z.string(),
  description: z.string(),
  remediation: z.string(),
  evidence: z.string().nullable(), // header / url / gevonden waarde
  status: findingStatusSchema, // default "open"
  note: z.string().nullable(), // optioneel, bij "ignored" (waarom)
  created_at: z.string().datetime(),
});
export type Finding = z.infer<typeof findingSchema>;

export const findingsPayloadSchema = z.object({
  v: z.literal(1),
  items: z.array(findingSchema),
});
export type FindingsPayload = z.infer<typeof findingsPayloadSchema>;
```

`scans.findings` = `findingsPayloadSchema` (JSONB). Severity-gewicht en -volgorde (voor sorteren en filter-chips) als helpers in shared (`severityRank: Record<FindingSeverity, number>`).

## API routes (`apps/web/app/api/`)

| Route | Methode | Rechten | Beschrijving |
|---|---|---|---|
| `/api/scans/[id]/findings` | GET | teamlid (membership-join) | Gefilterde lijst; query-params: `severity`, `category`, `status`, `q` (vrije tekst op title + description + evidence, case-insensitive), `sort` (default `severity`), `order`, `limit` (default 50, max 200), `offset`; response: `{ findings, total, counts, categories }` — `categories` = categorieën die in de scan voorkomen (voor de categorie-select) |
| `/api/scans/[id]/findings/[findingId]` | PATCH | teamlid (membership-join) | Body `{ status, note? }` (zod: `findingStatusSchema` + optionele `note`); update in JSONB; retourneert de bijgewerkte finding |

- Authz identiek aan `GET /api/scans/[id]` (scans JOIN sites JOIN memberships): geen match → `404` (geen existence-leak); niet ingelogd → `401`
- Ongeldige query/body → `400`; onbekende `findingId` in deze scan → `404`
- `counts` = `{ critical, high, medium, low, info }` over de gefilterde status/q — onafhankelijk van `limit/offset` (voor de filter-chips)
- PATCH-update: bevindingen in-memory muteren + `UPDATE scans SET findings = $1` (idempotent; één schrijver per scan is gegarandeerd, scans zijn per team-scope)
- `note` bij PATCH: meegeven bij `ignored` (reden); leegmaken bij `open`/`fixed` tenzij opnieuw meegegeven

## UI (op resultatenpagina `(dashboard)/scans/[id]`)

- **Filterbalk**: ernst-chips (met counts uit `counts`), categorie-select (alleen categorieën die in de scan voorkomen), status-select (open/fixed/ignored), zoekveld (`q`), debounced
- **Lijst**: per finding severity-badge (kleur per ernst), titel, check-naam + categorie, status-icoon; klik → expander met description, evidence (code-styling), remediatie-stappen, note (indien aanwezig) en status-knoppen ("Markeer als opgelost" / "Negeren" / "Reopen"); bij "Negeren" een optioneel note-veld ("Waarom genegeerd?")
- **Paginering**: "Meer laden" (offset+limit); lege staat bij geen resultaten ("Geen findings gevonden — filter aanpassen")
- De lijst is een client-component die de GET-route queried; scores/counts in de header komen uit `GET /api/scans/[id]` (plan 08)

## Stappen

1. `packages/shared/src/findings.ts`: schemas + severity-helpers + re-export via `index.ts`; tests (parse, unieke ids, payload-versie)
2. Inline probe omzetten naar findings-formaat (`lib/scan-runner.ts`: `{ v: 1, items: [...] }` i.p.v. `{ checks: [...] }`); bestaande data blijft oud formaat (zie Besluit 9)
3. **Carry-over-helper** `lib/finding-status.ts` (server-only): bij scan-completion de vorige scan van dezelfde site ophalen en per stabiele id `status` + `note` kopiëren (`fixed`/`ignored` behouden, `open` overschreven); aangeroepen door de inline-probe-route, later door de worker-aggregator (Fase 3)
4. `GET /api/scans/[id]/findings`: authz + validatie query + filtering/sortering + counts + limit/offset
5. `PATCH /api/scans/[id]/findings/[findingId]`: authz + status/note-update + response
6. UI-componenten: filterbalk, findings-lijst, finding-detail-expander, status-knoppen + note-veld; integratie op resultatenpagina zodra die er is (voorlopig op eigen testpagina)
7. Testsuite (vitest in apps/web): filter-combinaties, counts onafhankelijk van paginering, q-zoeken (title + description + evidence), PATCH-authz (geen teamlid → 404, onbekende finding → 404, ongeldige status → 400), carry-over (fixed/ignored + note blijven, open reset), oud-formaat-data (leeg + hint)

## Open vragen

- ~~Status bij herscan~~ → opgelost: carry-over via stabiele id (`fixed`/`ignored` + note blijven; `open` reset)
- ~~Legacy-data~~ → opgelost: geen compat-mapping; oude scans tonen "geen findings — herscan"
- ~~q-zoeken~~ → opgelost: title + description + evidence
- ~~Note bij ignored~~ → opgelost: optioneel note-veld bij status-wijziging
- ~~Carry-over bij herstart (`failed` → opnieuw)~~ → opgelost: helper is idempotent en draait altijd na het schrijven, ongeacht poging (geïmplementeerd in `finishScan` van web + scheduler)

## Afwijkingen tijdens implementatie (t.o.v. het plan)

- `counts` houdt naast `status`/`q` ook rekening met de `category`-filter (niet met `severity` zelf), zodat de chips aansluiten op de getoonde lijst; blijft onafhankelijk van limit/offset
- De scheduler-probe (geplande scans, plan 05) schrijft vanaf nu ook het v1-formaat (check-id `html` → `meta-tags` i.p.v. `html`); carry-over zit ook in `apps/scheduler/src/core.ts`, zodat geplande scans de status niet resetten
- Checks→findings-mapper (`inlineChecksToFindings`) + `applyFindingStatusCarryOver`/`findingId`/`severityRank` liggen in `packages/shared` (één bron, deelt met de scheduler)

## Acceptatiecriteria

- [x] `GET /api/scans/[id]/findings` filtert op severity/category/status + vrije tekst (title/description/evidence), sorteert (default op ernst) en retourneert `{ findings, total, counts }`
- [x] `PATCH /api/scans/[id]/findings/[findingId]` zet status (+ optioneel note) en retourneert de finding; `fixed`/`ignored`/`open` round-trip werkt
- [x] Carry-over: bij herscan blijven `fixed`/`ignored` + note staan op dezelfde finding (id); `open` reset
- [x] Alleen teamleden (401/404); ongeldige query/body → 400; onbekende finding → 404
- [x] UI toont filterbare lijst met badges, expandable details (beschrijving + remediatie + note) en status-knoppen; counts op de chips kloppen
- [x] Findings-schema ligt versioned in `packages/shared`; inline probe schrijft hetzelfde formaat; oude scans tonen "geen findings — herscan"
- [x] FEATURES.md (8, 20 → 09-findings, ✅) en ROADMAP-plan-overzicht bijgewerkt
