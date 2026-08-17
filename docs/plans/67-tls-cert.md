# Plan: TLS/SSL-certificaat check (feature 31)

**Doel** — HTTP-worker check `tls-cert` inspecteert het TLS-certificaat van de
canonical host via een eigen `node:tls.connect`-handshake (SNI = host): leest
`notBefore`/`notAfter`, SAN/CN-match met de host, self-signed-detectie, en
expiry-runway (≤30 d = warn, verlopen = fail). Niet-invasive, één check, één
catalog-id, draait in elke scan.

**Status** — ✅ Klaar (2026-08-17)

## Besluiten (bevestigd 2026-08-17)

1. **Bron = `node:tls.connect`.** Eén eigen TLS-handshake naar `host:443` met
   `servername = host` (SNI). Certificaat gelezen via
   `socket.getPeerCertificate()`. Niet via `fetch`/undici — die geeft het
   peer-certificaat niet vrij. Sluit aan bij het bestaan van `node:tls` als
   stdlib in de worker-runtime.
2. **Scope = basis.** Geldigheid (`notBefore`/`notAfter`), SAN/CN-match met de
   host, self-signed-detectie (issuer CN == subject CN of `issuerCertificate === cert`),
   expiry-runway. **Geen** ketting-validatie, chain-ordering, HTTP/2-detectie
   of zwakke-cipher/TLS-versie-scan — die komen later (open vraag 2).
3. **Expiry-runway: 30/0 dagen.** `notAfter` ≤ 30 d in de toekomst = `warn`
   (medium); `notAfter` in het verleden (verlopen) of `notBefore` > nu (nog
   niet geldig) = `fail` (high). Conform wat plan 56 (Domain Watchtower)
   veronderstelt.
4. **Non-HTTPS = `info`, niet storend.** Als `ctx.url` niet met `https://`
   begint, retourneert de check één `info`-resultaat "TLS niet van toepassing:
   site is HTTP" (geen fail). Versterkt niet dubbel met `httpsCheck`.
5. **Severiteit via het bestaande schema.** `pass|warn|fail` → `info|medium|high`
   (`SEVERITY_BY_STATUS` in `packages/shared/src/findings.ts`).
6. **Eén catalog-output.** Check-id `tls-cert` produceert één `InlineCheckLike`.
   De catalog-entry `tls-cert` bestaat al in `check-catalog.ts:39`.
7. **Rate-limit verplicht.** De TLS-connect is een outbound verbinding naar de
   target-host → gaat door `ctx.rateLimit` (per-host Redis-limiter), conform de
   andere outbound checks. Timeout 10 s op de socket (zelfde budget als
   `fetchPage`).
8. **Geen DB-/API-wijziging.** Findings als JSONB via
   `inlineChecksToFindings`; `tls-cert` volgt hetzelfde pad als de andere
   security-header-checks. Plan 56 (Domain Watchtower) hergebruikt de
   expiry-meting uit deze check — dat plan leest `notAfter` uit het
   finding-evidence, dus dit plan legt `notAfter`/`notBefore`/`issuer` in
   `evidence` als string (zie Contract).

## Uitgangssituatie (code vandaag)

- `packages/shared/src/check-catalog.ts:39` — entry
  `{ id: "tls-cert", category: "http", name: "TLS/SSL-certificaat", active: false }`.
- `apps/worker/src/checks/registry.ts` — `http:`-array bevat
  `reachability, https, securityHeaders, metaTags, cookies,
  secretsInBundles, activeTests`. **Geen** `tls-cert`-implementatie.
- `apps/worker/src/checks/types.ts` — `CheckImplementation`-contract
  (`id, category, run(ctx) → Promise<InlineCheckLike[]>`); `fetchPage`
  gebruikt Node's globale `fetch` (undici), die bij TLS-fouten `fetch failed`
  met `cause.code: ERR_TLS_*` gooit — geen cert-velden beschikbaar. Vandaar
  besluit 1.
- `apps/worker/src/uptime/probe.ts:65-70` — referentie voor TLS-fout-herkenning
  (`ERR_TLS_*`, message bevat `tls`). Niet hergebruikt (we doen een eigen
  handshake), maar bevestigt de fout-codes.
- `apps/worker/src/checks/http/https.ts` — bestaande HTTPS-check (bereikbaar
  over HTTPS?); `tls-cert` is complementair: gaat over het certificaat, niet
  over de verbinding.
- `packages/shared/src/findings.ts` — `ISSUE_TITLES` en `REMEDIATION` per
  check-id. **Ontbreken:** `tls-cert` in beide → na deze check toevoegen.
- `docs/plans/56-domain-watchtower.md:18` — "TLS/SSL-check 31 (geldigheid,
  chain, HTTP/2) in MVP http-worker — cert-expiry wordt daar al gelezen".
  Plan 56 leunt op dit plan; chain/HTTP/2 vallen onder open vraag 2 (later).

## Contract / DB / API

- **Geen schema-wijziging.**
- **Geen API-wijziging.** De check produceert findings in de bestaande
  `findings`-payload; findings-API/filtering (feature 20) werkt zonder
  aanpassing.
- **Shared-contract-aanpassing** (`packages/shared/src/findings.ts`):
  - `ISSUE_TITLES["tls-cert"]`:
    `{ warn: "TLS-certificaat verloopt binnen 30 dagen", fail: "TLS-certificaat is verlopen of nog niet geldig" }`.
  - `REMEDIATION["tls-cert"]`: "Verleng het TLS-certificaat tijdig (bijv. via Let's Encrypt met auto-renewal); zorg dat notAfter ≥ 30 d in de toekomst ligt en dat de SAN/CN overeenkomt met de hostnaam."
- **Worker** (`apps/worker/src/checks/http/tls-cert.ts`): nieuwe
  `tlsCertCheck: CheckImplementation`. `outputCheckIds = ["tls-cert"]`.
- **Registry** (`apps/worker/src/checks/registry.ts`): voeg
  `toImplemented(tlsCertCheck)` toe aan de `http:`-array.

## Detectie-logica

1. Parse host uit `ctx.url`. Als schema ≠ `https`: retourneer één
   `info`-resultaat "TLS niet van toepassing: site is HTTP".
2. `await ctx.rateLimit.acquire()`; open `node:tls.connect({ host, port: 443,
   servername: host })` met socket-timeout 10 s.
3. Bij `secureConnect`: lees `socket.getPeerCertificate()` (en
   `socket.getPeerCertificate(true)` voor issuer).
4. Pure helper `evaluateTlsCert({ cert, host, now })` retourneert één
   `InlineCheckLike`:

| Situatie | status | severity |
|---|---|---|
| Geen cert (null/leeg) | `fail` | `high` |
| `notBefore` > nu (nog niet geldig) | `fail` | `high` |
| `notAfter` < nu (verlopen) | `fail` | `high` |
| `notAfter` ≤ 30 d in de toekomst | `warn` | `medium` |
| Self-signed (issuer.CN == subject.CN óf `issuerCertificate` refs zichzelf) | `warn` | `medium` |
| SAN/CN matcht host niet | `fail` | `high` |
| Alles goed, `notAfter` > 30 d | `pass` | — |

`detail` = samenvatting (`CN=<cn>, verloopt <notAfter>, uitgegeven door <issuer>`).
`evidence` = string met `notBefore|notAfter|issuer|subject|san` voor plan 56.

5. Fallbacks:
   - `secureConnect` faalt (TLS-error, timeout, DNS): `fail`/high met
     detail "TLS-handshake mislukt: <fout>". We onderscheiden
     self-signed/hostname-mismatch niet uit de foutboodschap (deze check is
     niet-invasive; geen custom `rejectUnauthorized:false`).
   - Connection geweigerd/time-out: `fail`/high "TLS niet
     controleerbaar: <fout>".

## Stappen

1. **Shared-contract** — voeg `tls-cert` toe aan `ISSUE_TITLES` en `REMEDIATION`
   in `packages/shared/src/findings.ts`.
2. **Check-implementatie** — maak `apps/worker/src/checks/http/tls-cert.ts`:
   - `export const tlsCertCheck: CheckImplementation` met `id: "tls-cert"`,
     `category: "http"`.
   - `run(ctx)`: parse host; als non-https → `info`; anders rate-limit +
     `tls.connect` met timeout 10 s; lees cert; roep `evaluateTlsCert`.
   - Pure helper `evaluateTlsCert({ cert, host, now = new Date() })` → één
     `InlineCheckLike`; unit-testbaar zonder netwerk.
3. **Registry** — registreer `tlsCertCheck` in de `http:`-array van
   `buildRegistry` in `registry.ts`.
4. **Tests** — `apps/worker/src/checks/http/__tests__/tls-cert.test.ts`:
   - `evaluateTlsCert`-cases voor elke rij in de detectie-tabel (verlopen,
     bijna-verlopen, self-signed, SAN-mismatch, niet-geldig-yet, pas).
   - Mock `tls.connect` voor de `run`-integratie; non-https-pad.
5. **Docs** — update `docs/FEATURES.md` rij 31: `Plan` = `67-tls-cert`,
   `Status` = 📝 (→ ✅ na acceptatie). Update `docs/ROADMAP.md`
   plan-overzicht.

## Open vragen

1. ~~Certificaatbron: node:tls vs undici-hook vs openssl?~~ → besluit 1:
   `node:tls.connect`.
2. ~~Ketting-validatie + HTTP/2 + cipher-scan in dit plan?~~ → nee, basis
   (besluit 2). Chain/HTTP/2 komen in een latere uitbreiding — plan 56
   veronderstelt "chain" in MVP, maar dat is een aspiratie; dit plan levert
   alleen cert-geldigheid. Noteer als follow-up.
3. ~~Self-signed als `warn` of `fail`?~~ → `warn`/medium (besluit: via
   bestaand schema, `warn` = medium). Een self-signed cert breekt de
   verbinding niet per se; gebruiker moet wel weten.
4. Moet de check ook draaien op poorten anders dan 443 (bijv. `:8443` in
   `ctx.url`)? Default: ja, poort uit `ctx.url` gebruiken; alleen `443`
   fallback wanneer geen poort in de URL.

## Acceptatiecriteria

- `tlsCertCheck` is geregistreerd en produceert één `InlineCheckLike` met
  `id: "tls-cert"` per scan.
- `pnpm test` groen, inclusief nieuwe `tls-cert.test.ts` die elke rij van de
  detectie-tabel dekt (incl. non-https-pad en connect-fout).
- `pnpm typecheck` en `pnpm lint` slagen.
- Een scan tegen een doel met een verlopen certificaat levert `fail`/high;
  een doel met cert verloopt ≤ 30 d levert `warn`/medium; een doel met een
  geldig cert > 30 d runway levert `pass`.
- Non-https-URL levert `info` op (niet storend in de findings-lijst).
- `evidence` bevat `notAfter`/`notBefore`/`issuer`/`subject`/`san` als
  string voor hergebruik door plan 56.
- `docs/FEATURES.md` rij 31 verwijst naar `67-tls-cert` met status ✅.
