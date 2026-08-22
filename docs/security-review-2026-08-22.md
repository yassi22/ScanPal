# ScanPal — Security & Bug Review

**Datum:** 2026-08-22 · **Scope:** volledige monorepo (`apps/web`, `apps/worker`, `apps/scheduler`, `packages/*`)
**Methode:** 1 director (Opus) + 4 parallelle Sonnet-subagents (tenancy/IDOR, SSRF, billing/webhooks, core-logic). Alle High+/Critical findings zijn door de director tegen primair bewijs (broncode + runtime-checks) geverifieerd.
**Basislijn:** `pnpm -r typecheck` → exit 0 · web-testsuite → **624/624 passed**. De geplakte claim ("24 issues fixed, typecheck passes, 624 tests pass") klopt voor de *eerdere* fix-commit-batch.

---

## Deel A — Review van de laatste commit `f50bbcb` "fix(ui): complete NL to EN migration"

**Oordeel: de commit haalde géén functionele bugs weg. Het is een cosmetische taalmigratie, en die is niet compleet.**

| Bevinding | Bewijs |
|---|---|
| ❌ Niet "complete" | **131 resterende Dutch strings in 58 bronbestanden**, incl. bestanden die de message claimt volledig vertaald te hebben (`api-keys-settings`, `billing-manager`). |
| 🐛 Geïntroduceerd: garbled string | `"Removeen mislukt"` in `sites-manager.tsx:343` — kapotte find/replace ("Verwijderen" → "Removeen"). |
| 🐛 Geïntroduceerd: gebroken zin | `api-keys-settings.tsx:137` — Engels gevolgd door dangling `gebruiken.` |
| ⚠️ Scope creep (verstopte echte fix) | `dashboard-shell.tsx:211` — geen vertaling maar een gedragswijziging: subpagina's als `/uptime/[siteId]` kregen vóór deze commit de legacy-shell i.p.v. de workspace-shell. Dit is de énige echte bugfix, maar ongetest en misplaatst in een "vertaal"-commit. (`/threats/`, `/notifications/`, `/billing/` hebben geen subroutes → inert.) |
| ⚠️ Ook gedrag, niet cosmetica | De locale-omzettingen (`toLocaleDateString("nl-NL"→"en-GB")`, `localeCompare(…,"nl"→"en")` in `diff-panel.tsx:106`) veranderen datumweergave én sorteervolgorde van finding-groepen. Bedoeld en laag-risico, maar het is gedrag onder een "translation"-vlag — versterkt het scope-creep-punt. |

**Belangrijk:** de "24 issues / 624 tests"-claim slaat niet op `f50bbcb` maar op de voorafgaande security-batch (`2cf9d7e`, `0f548a0`, `37d7541`, `4755395`, `8b14128`, `d1de3c9`, `cca1137`). Die changes wáren nodig en zijn grotendeels solide (zie Deel C) — met één belangrijke uitzondering: de SSRF-hardening (`0f548a0`) is onvolledig (S1/S2 hieronder).

---

## Deel B — Security & bug-findings (gerankt, geverifieerd)

### 🔴 CRITICAL

**S1 — SSRF-blocklist bypass via IPv4-mapped IPv6 (`::ffff:…`)** · *CONFIRMED (runtime)*
`packages/notify/src/webhook-security.ts:38-68` (`isBlockedIp`, gedeeld door de scan-worker `apps/worker/src/checks/types.ts:90-123`).
De v6-branch herkent IPv4-mapped adressen alleen als de laatste groep een `.` bevat, maar `new URL().hostname` normaliseert `::ffff:169.254.169.254` naar hex `[::ffff:a9fe:a9fe]` → de dotted-branch is dode code.
Runtime-bewijs (director): `[::ffff:169.254.169.254]`, `[::ffff:127.0.0.1]`, `[::ffff:10.0.0.5]` → **allemaal BLOCKED=false**.
**Exploit:** attacker registreert eigen site → 302-redirect naar `http://[::ffff:169.254.169.254]/latest/meta-data/iam/security-credentials/<role>`. `fetchPage` hervalideert per hop met dezelfde buggy check (`types.ts:204-224`), verbindt met cloud-metadata, en de response-body vloeit terug in de scan-checks → **credential-exfiltratie via de scan-UI**, niet enkel blinde SSRF.
**Fix:** parse de v6-literal numeriek (node:net) en check de onderste 32 bits tegen de IPv4-ranges, ongeacht hex/dotted-weergave.

### 🟠 HIGH

**S2 — IPv6 ULA `fc00::/7` onder-geblokkeerd** · *CONFIRMED (runtime)*
`webhook-security.ts:61` — `if (first === "fd00") return true;` matcht alleen de letterlijke string `fd00`. Runtime: `fc00::1`, `fdff::1` → BLOCKED=false. Comment zegt bovendien foutief `fd00::/8` (ULA = `fc00::/7`). **Fix:** `const n=parseInt(first,16); if(n>=0xfc00 && n<=0xfdff) return true;`

**B1 — Mislukte abonnementen (`unpaid`/`paused`/`incomplete`) behouden onbeperkt volledige Pro-credits** · *CONFIRMED*
`apps/web/lib/billing-core.ts:39-48` mapt `unpaid`, `paused`, `incomplete` → `past_due`; `packages/scan-core/src/credits.ts:40` rekent `past_due` tot `ACTIVE_STATUSES` → volledige `creditsPerPeriod`, zonder tijdgrens. Team laat kaart falen door de hele dunning-cyclus → houdt Pro-credits tot Stripe ooit `subscription.deleted` stuurt. **Fix:** splits time-boxed `past_due` van credit-blokkerende `unpaid`/`paused`.

**B2 — Feature-gates én API-rate-limit negeren subscription-status** · *CONFIRMED*
`getPlanForTeam` (`credits.ts:60-66`) leest alleen `state.plan`, nooit `state.status`. Een `canceled` sub waarvan de `plan`-kolom nog niet op `free` staat (alleen `subscription.deleted` reset die) passeert Pro feature-gates (`onDeploy`, `github`) + Pro rate-limit (`api-auth.ts:128,155`). Credit-spend is apart wél status-gated → dit is een feature/rate-limit-lek, geen credit-lek. **Fix:** gate ook op `ACTIVE_STATUSES.has(status)`.

**L1 — Dubbele gelijktijdige scans + dubbele credit-afboeking** · *CONFIRMED*
`apps/web/lib/scans-core.ts:118-146` — overlap-check is `SELECT 1 … status IN ('queued','running') LIMIT 1` zónder `FOR UPDATE`; migraties tonen enkel non-unique indexes (`scans_site_status_idx`). Onder READ COMMITTED zien twee gelijktijdige `POST /api/scans` beide niets → beide INSERT 'queued' + `spendCredit` → 2 scans, **2 credits**, en racende writes op `sites.last_scan_*` (older-wins). **Fix:** `SELECT … FOR UPDATE` op de sites-row, of partial unique index `on scans(site_id) where status in ('queued','running')`.

**L2 — Webhook dubbele-delivery: `FOR UPDATE SKIP LOCKED` zonder transactie** · *CONFIRMED*
`packages/notify/src/webhook-deliverer.ts:435-464` — `deliverDue` draait de locking-SELECT via `deps.db.query()` op de **Pool** zonder `BEGIN/COMMIT` → de lock komt direct vrij. `deliverOne` (`:253-312`) zet géén tussenstatus ('processing'); de row blijft de hele trage HTTP-delivery lang `pending`/`failed`. Scheduler (`apps/scheduler/src/index.ts:112`) gebruikt niet-awaited `setInterval` → overlappende tick herselecteert dezelfde rows → **dubbele webhook-events naar de klant**. **Fix:** `PoolClient` + één `BEGIN…COMMIT` om SELECT+verwerking, of markeer rows atomair `processing`.

**T1 — Workspace-isolatie-bypass op honeypot/uptime (ontbrekende workspace-clause)** · *CONFIRMED*
`apps/web/app/api/sites/[id]/honeypot/route.ts:11-23` — de `authorizeSite`-helper mist `and (m.role='owner' or s.workspace_id=m.workspace_id)` die de gelijknamige helper in `schedule/route.ts:14-19` wél heeft. Een member uit workspace A kan `POST …/honeypot {rotate_token:true}` op een site in workspace B (breekt de gedeployde detectie-snippet), `PATCH /api/uptime/sites/{id} {enabled:false}` op elke team-site, en volledige uptime/threat-detail (IP's, aanvalspatronen) lezen. Blijft binnen de tenant — cross-*workspace*, niet cross-tenant. **Bereik geverifieerd live:** workspace-toewijzing is een echte, owner-gated feature (`createWorkspace` + `assignMemberWorkspace` PATCH + `workspace-manager` UI), en de restrictie wordt in `schedule`/`stream` wél gehandhaafd — dit is dus een actieve bypass, geen latente divergentie. **Fix:** dezelfde clause toevoegen aan honeypot-`authorizeSite`, `setUptimeMonitoring`, `getUptimeDetail`, `listUptimeSummaries`.

### 🟡 MEDIUM

- **S3 — DNS-rebinding TOCTOU, geen IP-pinning** (`webhook-security.ts:11-32`, `types.ts:69-81`). Guard resolvet+valideert, `fetch()` re-resolvet zelf; DNS-cache verkleint alleen het venster. In-code erkend als bekende gap. *PLAUSIBLE.* Fix: custom undici-dispatcher die naar het gevalideerde IP verbindt met `servername`-override.
- **B3 — Vercel-webhook deelt één secret over alle tenants** (`webhooks/vercel/route.ts:28-47`). Site-selectie puur op URL-match → team dat de integratie kent kan `deployment.completed` forgen voor andermans publieke site-URL → credit-burn. GitHub-route heeft per-site-secret (fix voor exact deze klasse) wél. *CONFIRMED.*
- **B4 — `requestBodyHash` faalt open bij stream-read-fout** (`api-hmac.ts:132-145`) → `sha256("")` i.p.v. reject. Geen actieve bypass (attacker mist nog steeds het secret), wel afwijking van "fail-closed HMAC". *CONFIRMED (defense-in-depth).*
- **B5 — Geen replay-protectie op GitHub/Vercel inbound webhooks** buiten 600s cooldown. Gecapte geldig-getekende payload herbruikbaar 1×/cooldown → ~4.300 gedwongen scans/maand op één site. *CONFIRMED.* Fix: dedup op `x-github-delivery`/Vercel event-id of timestamp-check (patroon bestaat al in `api-hmac.ts:24`).
- **B6 — Geen event-ordering-guard op Stripe `subscription.updated`** (`billing-core.ts:151-224`), dedup alleen op `event_id` → stale event kan nieuwer plan/status overschrijven. De delete-path is hier wél tegen gehard. *PLAUSIBLE.*
- **L3 — Billing/usage toont stale credits + `resetAt` in het verleden** tot de volgende scan (`credits.ts:77-98` vs rollover alleen in `spendCredit:141-152`). *CONFIRMED.* Fix: dezelfde rollover read-only projecteren in `getTeamUsage`.
- **L4 — Domain-watch overlappende-tick-duplicatie** (`apps/scheduler/src/domain-watch.ts:59-66`), geen lock + dedup-key bevat per-tick `checkedAt` → dubbele `domain_alert`-notificaties. *PLAUSIBLE.*
- **T2 — Niet-deterministische tenant-binding voor multi-team-users** (`team-core.ts:34-48`). `getUserTeam` doet `LIMIT 1` zonder `ORDER BY` → bij ≥2 memberships kan actief team/rol tussen requests wisselen (incl. de owner-check). Blijft binnen eigen memberships. *CONFIRMED.* Fix: deterministische `ORDER BY` + `and m.status='accepted'`.

### 🟢 LOW

- **S4** — Inconsistente bracket-handling tussen de twee SSRF-guards; `isUrlAllowed` is per toeval veilig (`webhook-security.ts:99-116`).
- **B7** — Onbekende Stripe-prijs laat plan stil ongewijzigd (`billing-core.ts:211` `if(plan)`).
- **B8** — `checkout.session.completed` zet `status='active'` zonder `payment_status`-check (zelf-corrigerend via later event).
- **L5** — Webhook-quota TOCTOU (count-then-insert, `webhooks-core.ts:112-118`); 1-2 over de plan-limiet.

---

## Deel C — Recente hardening-commits: houden ze stand?

| Claim | Verdict |
|---|---|
| seat TOCTOU (`invites-core.ts:203`) | ✅ Echt — `select … for update` vóór seat-hercheck. |
| email verification bij invite-accept | ✅ Echt — `email_confirmed_at` + `email_mismatch`. |
| fail-closed HMAC (derivatie uit key_hash) | ✅ Grotendeels — pass-the-hash-fix solide; **maar** `requestBodyHash` faalt open (B4). |
| owner-gates | ✅ Consistent toegepast (caveat: T2 bepaalt wélk "current team"). |
| RLS op sites/webhooks/reports (`028_…sql`) | ⚠️ Echt maar smal — app-pool draait `BYPASSRLS`; defense-in-depth, niet de API-path-control. Message overdrijft de blast radius. |
| GitHub on-deploy per-site-secret | ✅ Echt — signature per-site geverifieerd. |
| block link-local/CGNAT (`0f548a0`) | ❌ **Onvolledig** — IPv4 169.254/16 + 100.64/10 + IPv6 fe80::/10 kloppen, maar bypassbaar via `::ffff:` (S1) en ULA fc00::/7 mist (S2). |
| `::1` over-match fix | ✅ Echt — matcht alleen `::1`. |
| preserve `response.url` in `withBodyLimit` | ✅ Echt. |
| checkout price/team-integriteit | ✅ Echt — enum-gevalideerd, prijs server-side, `teamId` uit sessie. |
| reset interval bij fallback naar Free (`cca1137`) | ✅ Echt (`billing-core.ts:176`). |

**Geen** secret/token-lek gevonden via `console.*` in `apps/web/lib` of `apps/web/app/api`.

---

## Aanbevolen prioriteit
1. **S1** (Critical) — SSRF `::ffff:` bypass. Nu fixen; ondermijnt de kernbelofte van een security-scanner.
2. **B1 + B2** — omzeteffect (gratis Pro na dunning; feature-lek na cancel).
3. **L1 + L2** — data-integriteit & dubbele klant-facing effecten (credits, webhooks).
4. **T1 + S2** — workspace-isolatie & ULA.
5. Medium/Low volgens capaciteit; **S3** (IP-pinning) sluit de hele SSRF-klasse af.
