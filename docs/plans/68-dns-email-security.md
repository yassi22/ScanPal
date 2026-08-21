# Plan: DNS & Email security (SPF / DKIM / DMARC / MX)

**Doel**: E-mail- en DNS-hygiëne beoordelen — SPF, DKIM-selector-aanwezigheid, DMARC-policy en MX — zoals CheckVibe's "DNS & Email Security Scanner". Passief, geen interactie met de doelsite. Uitbreiding van de bestaande DNS-meting in `packages/scan-core/src/domain-net.ts` (plan 56), geen nieuwe queue of proces.

**Status**: 📝 Plan klaar (niet gestart). Feature 68.

## Besluiten

1. **Nieuwe catalog-check `dns-email`** (categorie `http`), draait passief in de http-worker naast `domain-watchtower`. Geen `active`-gating (leest alleen publieke DNS-records).
2. **Databron**: `node:dns/promises` via de al bestaande swappable `dnsResolver` in `domain-net.ts` — `resolveTxt` (SPF op apex, DMARC op `_dmarc.<apex>`), `resolveMx`, en DKIM-selector-probing (`<selector>._domainkey.<apex>` voor een korte bekende-selectorlijst: `google`, `selector1`/`selector2` (Microsoft), `k1` (Mailchimp/Mandrill), `s1`/`s2`, `default`, `dkim`). DKIM is best-effort: afwezigheid van álle geprobede selectors ≠ "geen DKIM", dus alleen info, geen straf.
3. **Score/finding-regels**:
   - `high` — DMARC ontbreekt óf `p=none` op een domein met verzendende MX (spoofbaar).
   - `medium` — SPF ontbreekt, of SPF eindigt op `+all`/`?all` (te permissief), of DMARC `p=quarantine` zonder `rua`.
   - `low` — meerdere SPF-records (RFC-overtreding), SPF > 10 DNS-lookups (waarschuwing, niet exact geteld), geen DKIM-selector gevonden (info-niveau).
   - `info` — apex heeft geen MX (verstuurt waarschijnlijk geen mail) → SPF/DMARC-bevindingen degraderen naar info, geen score-straf.
4. **Apex-only**, IDN → punycode (consistent met plan 56).
5. **Geen valse stelligheid**: de check zegt "geen SPF-record gevonden via DNS", niet "je e-mail is onveilig".

## Uitgangssituatie (code vandaag)

- `packages/scan-core/src/domain-net.ts` — `measureDomain` gebruikt `node:dns/promises` met een injecteerbare `dnsResolver` (`resolveNs`, `resolve(...,"DS")`, `resolveCaa`). MX/TXT worden nog niet opgehaald.
- `domain-watchtower` (feature 56) wrapt `measureDomain` als http-catalog-check en denormaliseert naar `sites`.
- Geen e-mail-/mail-security-velden in de catalog of DB.

## Contract / DB / API

- **Shared**: `emailDnsSchema` in `packages/scan-core` (of `packages/shared`): `{ spf: {present, raw, all_qualifier} | null, dmarc: {present, policy, rua_present} | null, mx: string[], dkim_selectors_found: string[] }`.
- **Catalog**: entry `{ id: "dns-email", category: "http", name: "DNS & e-mail (SPF/DKIM/DMARC)", active: false }` in `check-catalog.ts`, registreren in `apps/worker/src/checks/registry.ts`.
- **Findings**: severity-regels uit besluit 3; evidence = de ruwe records (SPF/DMARC-string, gevonden MX-hosts, geprobede DKIM-selectors).
- **DB**: optioneel denormaliseren op `sites` (`dmarc_policy`, `spf_present`) alleen als de UI het op de site-detailpagina wil tonen; niet vereist voor de finding-output.
- **UI**: bevindingen verschijnen in de bestaande findings-lijst (categorie HTTP). Geen aparte pagina nodig.

## Stappen

1. `packages/scan-core/src/domain-net.ts`: helper `resolveEmailDns(apexPunycode, deps)` → `resolveTxt`/`resolveMx` + DKIM-selectorlus; pure parse-helpers (`parseSpf`, `parseDmarc`) met unit-tests op mock-resolver.
2. Catalog-entry + registratie; `dns-email`-check die `resolveEmailDns` aanroept en de severity-regels toepast.
3. Fix-prompt-tekst (plan 60): concrete remediatie per bevinding (voorbeeld-SPF, `p=quarantine; rua=…`-DMARC).
4. Tests: SPF-varianten (`~all`/`-all`/`+all`, dubbel record), DMARC-policies, geen-MX-degradatie, DKIM best-effort, IDN/apex.

## Open vragen

- DKIM-selectorlijst: hoe lang mag die worden vóór hij te traag/ruisig wordt? → *Voorstel*: max ~8 bekende selectors, parallel, met korte timeout; afwezigheid blijft info.
- SPF-lookup-limiet (RFC 7208, max 10 DNS-lookups): exact narekenen (recursief `include:` volgen) of alleen een heuristische waarschuwing? → *Voorstel*: heuristisch in v1 (aantal `include:`/`a`/`mx`-mechanismen tellen), exacte recursie pas als er vraag naar is.

## Acceptatiecriteria

- [ ] `dns-email` levert findings voor ontbrekende/permissieve SPF en ontbrekende/`p=none` DMARC, met ruwe records als evidence.
- [ ] Domein zonder MX degradeert naar info (geen onterechte score-straf).
- [ ] Herbruikt de bestaande swappable resolver; geen nieuw proces/queue; apex-only + IDN→punycode.
- [ ] Pure parse-helpers zijn unit-getest op mock-DNS-responses.
