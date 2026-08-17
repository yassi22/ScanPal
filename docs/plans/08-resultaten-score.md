# Plan: Resultatenpagina — overall score + scores per categorie

**Doel**: De resultaatweergave van een scan: een grote overall score met per-categorie scores (HTTP & beveiliging, SEO & content, AEO & browser, GitHub & repo), met doorklik naar de findings-sectie. Feature 7.

**Status**: Nog niet gestart.

## Besluiten (bevestigd 2026-08-15)

1. **Categorie-scores worden opgeslagen** in een nieuwe kolom `scans.category_scores` (jsonb) — geschreven bij voltooiing van de scan; vandaag door de inline probe, straks door de aggregator (feature 27). Niet on-the-fly uit findings rekenen bij elke read (hot read + één bron van waarheid)
2. **Shared-contract** in nieuw bestand `packages/shared/src/scoring.ts`: `categoryScoresSchema` (`{ http, seo, aeo, github }`, int 0–100, `null` = categorie niet gescand); re-export via `index.ts`
3. **Zelfde pagina**: de resultaatweergave komt op de bestaande `(dashboard)/scans/[id]`-pagina uit plan 06 (die schakelt al van progress naar resultaat bij terminale status) — geen aparte route; de findings-sectie (feature 8, plan 09) zit onder de scores op dezelfde pagina
4. **Niet-gescande categorieën** (bijv. aeo/github in inline-modus) tonen "niet gescand" — géén 0-score, dat zou misleidend zijn
5. **Score-UI**: overall score als groot getal **+ letter-grade (A–F)** met kleur-schaal; per categorie een kaart met score + progressbar + categorie-label (labels uit `categoryLabels` in check-catalog, plan 06); klik op categorie-kaart scrolt naar findings gefilterd op die categorie (feature 8)
6. **Score-berekening (inline)**: pass-ratio per categorie (passende checks / totale checks in die categorie × 100); feature 27 neemt later dezelfde output-vorm over (gewogen per ernst) — de UI verandert niet
7. **`category_scores` niet in het SSE-event**: het `completed`-event van plan 06 blijft lean (alleen counts); de pagina haalt scores via `GET /api/scans/[id]`

## Uitgangssituatie (code vandaag)

- `scans` heeft `score int` (overall), maar **geen** per-categorie-scores; `progress_details` (plan 06) is nog niet gemigreerd
- `GET /api/scans/[id]` retourneert `{ id, site_id, status, progress, score, findings, completed_at }` — `category_scores` ontbreekt
- Inline probe (`lib/scan-runner.ts`) schrijft nu alleen overall `score` (percentage passende checks); findings-formaat verandert in plan 09 naar `{ v: 1, items }`
- Resultatenpagina `(dashboard)/scans/[id]` (plan 06) heeft bij terminale status een plekhouder "overall-score + per-categorie-scoreblok + Findings (feature 8)" — dit plan vult die plekhouder
- Migraties: `001`–`003` bestaan; `004` (plan 05) en `005` (plan 06) zijn gereserveerd → `006` is de eerstvolgende vrije

## DB (migratie `006_category_scores.sql` in `packages/db`)

```sql
alter table scans add column category_scores jsonb;
```

Vorm (per `categoryScoresSchema`):

```json
{ "http": 87, "seo": 65, "aeo": null, "github": null }
```

`null`-keys mogen ontbreken (geïnterpreteerd als niet-gescand); `{}` = geen scores. `score` (overall int) blijft bestaan — beide komen uit dezelfde aggregatie-stap.

## Contract (`packages/shared/src/scoring.ts`, nieuw)

```ts
export const categoryScoresSchema = z.object({
  http: z.number().int().min(0).max(100).nullable(),
  seo: z.number().int().min(0).max(100).nullable(),
  aeo: z.number().int().min(0).max(100).nullable(),
  github: z.number().int().min(0).max(100).nullable(),
});
export type CategoryScores = z.infer<typeof categoryScoresSchema>;
```

## API

`GET /api/scans/[id]` breidt de respons uit met `category_scores` (parse via `categoryScoresSchema`; `null` als kolom leeg is). Geen nieuwe route — feature 19 (scans) eigenaar van de route, dit plan breidt alleen het contract uit. Authz ongewijzigd (membership-join, 401/404).

## Score-berekening (inline modus, tot feature 27)

`runInlineProbe` rekent per categorie een score uit over de eigen checks (per categorie: passende checks / totale checks in die categorie × 100); categorieën zonder checks → `null`. De aggregator van feature 27 neemt later dezelfde output-vorm over (gewicht per ernst i.p.v. pass-ratio) — de UI verandert niet.

## UI (resultaatweergave op `(dashboard)/scans/[id]`)

- **Score-header**: overall score groot (bijv. 72/100) **met letter-grade (A–F)** en kleur-schaal (rood <50, oranje 50–79, groen ≥80), scan-datum + site-URL
- **Categorie-kaarten**: 4 kaarten (HTTP & beveiliging / SEO & content / AEO & browser / GitHub & repo) met score + progressbar; "niet gescand"-staat bij `null`; klik → findings-lijst gefilterd op die categorie (feature 8)
- **Findings-samenvatting** (brug naar feature 8): counts per ernst (uit `counts`-response van plan 09) + "Bekijk alle findings" → findings-sectie
- Terminale staten: `failed` → foutmelding + retry (bestaat al in plan 06); lege scan zonder score → nette lege staat

## Stappen

1. `packages/shared/src/scoring.ts`: `categoryScoresSchema` + `gradeForScore(score)`-helper (A–F + kleur-bucket) + re-export via `index.ts`; unit-tests
2. Migratie `006_category_scores.sql`
3. Inline probe: per-categorie pass-ratio-scores berekenen + schrijven (samen met plan 09-findings-formaat, zelfde PR-gebied)
4. `GET /api/scans/[id]`: `category_scores` in respons (zod-geparsed)
5. UI: score-header (getal + grade + kleur) + categorie-kaarten invullen op `(dashboard)/scans/[id]` (vervangt plekhouder uit plan 06); doorklik naar findings-sectie
6. Testsuite (vitest in apps/web): response bevat geparsed `category_scores`, `null`-categorieën, grade/drempel-tests, kleur-schaal, lege scans, bestaande tests blijven groen

## Open vragen

- ~~Score-berekening in inline-modus~~ → opgelost: pass-ratio per categorie tot feature 27
- ~~Kleur-schaal~~ → opgelost: rood <50 / oranje 50–79 / groen ≥80
- ~~Letter-grade~~ → opgelost: grade (A–F) + getal
- ~~SSE-event~~ → opgelost: `category_scores` niet in het event; pagina haalt via GET
- Nieuw: letter-grade-mapping — vaste 10-punts-stappen (A ≥90, B ≥80, C ≥70, D ≥60, E ≥50, F <50) of gekoppeld aan de kleur-drempels? (Voorstel: 10-punts-stappen)

## Acceptatiecriteria

- [ ] Resultaatpagina toont overall score (getal + letter-grade) + 4 categorie-kaarten met scores en progressbars; niet-gescande categorieën tonen "niet gescand" (geen 0)
- [ ] `GET /api/scans/[id]` retourneert `category_scores` (zod-geparsed, `null`-veilig)
- [ ] Klik op categorie-kaart filtert de findings-sectie op die categorie
- [ ] `categoryScoresSchema` ligt in `packages/shared`; inline probe schrijft hetzelfde formaat dat feature 27 later overneemt
- [ ] Score-kleur schaalt op de overall score; `failed`/lege scans tonen nette staten
- [ ] FEATURES.md (7 → 08-resultaten-score, 📝) en ROADMAP-plan-overzicht bijgewerkt
