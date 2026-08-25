# Plan: Supabase / Firebase / Convex security — passief black-box (G5)

**Doel**: Detecteer misconfiguraties van BaaS-platformen (Backend-as-a-Service) die vibe-coders gebruiken — Supabase, Firebase en Convex — via passieve black-box-inspectie van de client-side code en publieke endpoints. Geen geauthenticeerde vendor-integratie. Dit dekt CheckVibe's "Supabase Security Scanner", "Firebase Security Scanner" en deels "Convex Security Scanner".

**Status**: ✅ Klaar (uitgevoerd). Feature 74. Dekt gap G5 uit `docs/gap-analysis-checkvibe-security-checks.md`.

---

## Besluiten

1. **Drie aparte catalog-entries** (categorie `http`, `active: false`), zodat elk platform onafhankelijk schaalbaar is en findings duidelijk per vendor gegroepeerd zijn:
   - `supabase-security` — Supabase-specifieke misconfiguratie-detectie.
   - `firebase-security` — Firebase Realtime DB + Firestore + Cloud Storage-misconfiguratie.
   - `convex-security` — Convex open-endpoint-detectie.

2. **Twee-fasig detectiemodel** per platform:
   - **Fase 1 — Fingerprint** (geen extra request): zoek platform-URL's en config-objecten in de HTML-body en JS-bundles die de bestaande fetch al ophaalt. Hergebruikt het resultaat van `secrets-in-bundles` / `secrets-in-html` en de gememoïseerde `fetchPage`-response.
   - **Fase 2 — Passieve probe** (maximaal 1 extra outbound GET per gevonden project): alleen als fase 1 een platform-project-URL oplevert; test publieke endpoints op misconfiguratie. Altijd passief (alleen lezen, geen mutaties).

3. **Gating: altijd aan (passief)** — de probes zijn GET-requests op publieke endpoints, vergelijkbaar met de crt.sh-lookup in plan 72 en de OSV-lookup in plan 71. Geen `active`-flag, geen opt-in, geen Pro-gating. De probes raken externe endpoints maar muteren niets.

4. **Supabase-detectiepatronen en probes**:
   - Fingerprint: regex op `https://<ref>.supabase.co` in HTML/JS + Supabase-specifieke keys (`sb_secret_*`, `sb_publishable_*`, Supabase JWT met `iss: "supabase"`). Veel hiervan vangt `bundle-secrets.ts` al — dit plan leest die resultaten én scant de response zelf op project-URL's.
   - Probe 1: `GET https://<ref>.supabase.co/rest/v1/` met lege `apikey`-header → als 200 + JSON-array retourneert, is de PostgREST-schema publiek leesbaar (tabelnamen lekken zonder RLS).
   - Probe 2: `GET https://<ref>.supabase.co/rest/v1/` met de gevonden `anon`-key als `apikey` + `Authorization: Bearer <anon-jwt>` → als 200 + tabelnamen retourneren, zijn tabellen mogelijk zonder RLS.
   - **Niet in scope**: daadwerkelijk data uitlezen uit tabellen (dat is actief pentesting).

5. **Firebase-detectiepatronen en probes**:
   - Fingerprint: regex op `https://<project>.firebaseio.com`, `firebaseConfig`-object (`apiKey`, `projectId`, `databaseURL`), `firebase.initializeApp(...)` in HTML/JS.
   - Probe Realtime DB: `GET https://<project>.firebaseio.com/.json?shallow=true&limitToFirst=1` → 200 = database open voor lezen (high); 401/403 = beschermd (pass). `shallow=true&limitToFirst=1` voorkomt dat de hele database gedownload wordt — retourneert alleen top-level keys (max 1) zonder waarden.
   - Probe Cloud Storage: `GET https://firebasestorage.googleapis.com/v0/b/<project>.appspot.com/o` → 200 met `items[]` = bucket is publiek leesbaar (high).
   - Probe Firestore: `GET https://firestore.googleapis.com/v1/projects/<project>/databases/(default)/documents/<collection>` — problematisch: vereist een collectie-naam. → *Niet in v1*; collectie-enumeratie is niet betrouwbaar passief te doen. Uitbreiden als we patronen vinden om collectienamen uit de client-code te extraheren.
   - **Firebase API-key exposure**: de Firebase `apiKey` (AIza…) is ontworpen als publiek en is op zichzelf geen bevinding (severity `info`). Alleen flaggen als `critical` wanneer de API-key gecombineerd is met een open Realtime DB of Storage bucket.

6. **Convex-detectiepatronen en probes**:
   - Fingerprint: regex op `https://<deployment>.convex.cloud` en `convex/_generated` import-patronen in JS-bundles.
   - Probe: `GET https://<deployment>.convex.cloud/api/list_functions` of equivalent publiek metadata-endpoint → als functies zonder auth opvraagbaar zijn, is dat een info/low-finding.
   - **Scope-beperking**: Convex is nieuwer en minder gedocumenteerd qua publieke endpoints. V1 implementeert fingerprint + de meest bekende probe; uitbreidbaar als de community meer patronen documenteert.

7. **Severity-regels**:
   | Bevinding | Severity |
   |---|---|
   | Supabase `service_role`-key in frontend | `critical` — **niet opnieuw geëmit door `baas-security`**; blijft eigendom van `bundle-secrets`. Deze check verwijst er alleen naar (cross-referentie) en produceert geen duplicaat-finding. |
   | Firebase Realtime DB open voor lezen (`.json` → 200) | `high` |
   | Firebase Cloud Storage bucket publiek leesbaar | `high` |
   | Supabase PostgREST-schema publiek (tabelnamen lekken) | `high` |
   | Supabase anon-key + schema-lek → mogelijke ontbrekende RLS | `medium` |
   | Convex functies publiek opvraagbaar | `low` |
   | Firebase `apiKey` (AIza…) gevonden maar DB/Storage beschermd | `info` |
   | Supabase project-URL gevonden, PostgREST beschermd | `info` |
   | Platform gedetecteerd, geen misconfiguratie gevonden | `info` (pass) |

8. **Evidence-masking**: project-URL's en key-prefixen worden opgenomen in de evidence (publieke informatie); volledige JWT's of keys worden gemaskeerd conform bestaande `maskSecret()`-conventie.

9. **SSRF-bescherming + outbound-budget**: de probes raken externe publieke URL's (`*.supabase.co`, `*.firebaseio.com`, `*.googleapis.com`, `*.convex.cloud`). Deze gaan door de bestaande `assertOutboundAllowed`-guard + per-host rate-limit via Redis. Naast de per-platform-cap (max 3 project-URL's per platform) geldt een **globaal probe-budget van 9 outbound-GETs per scan** (3 platforms × 3): de per-host rate-limit dekt één host, maar het globale budget voorkomt dat een fleet-brede scheduled/bulk-run zich opstapelt. Bij overschrijding: stop met proben, rapporteer de resterende fingerprints als `info` (alleen gedetecteerd, niet geprobed).

10. **Geen valse stelligheid**: "PostgREST-schema openbaar" ≠ "data is leesbaar" — RLS kan op tabel-niveau actief zijn terwijl de schema-listing open is. De finding vermeldt expliciet wat geobserveerd is en adviseert RLS-controle. Idem voor Firebase: "`.json` retourneert 200" = "database is leesbaar zonder auth", niet "alle data is geëxfiltreerd".

## Uitgangssituatie (code vandaag)

- **`packages/shared/src/bundle-secrets.ts`**: bevat al extractie + classificatie van Supabase keys (`sb_secret_*`, `sb_publishable_*`), Supabase JWT-classificatie (`classifySupabaseJwt`), en Firebase/Google API-keys (`AIza*`). Severity-mapping aanwezig (`supabase_service_role` → `critical`, `supabase_anon_key` → `low`, `google_api_key` → `low`).
- **`apps/worker/src/checks/http/secrets-in-bundles.ts`** + **`secrets-in-html.ts`**: scannen HTML en JS-bundles op bovenstaande keys. Resultaten beschikbaar via de check-output.
- **`packages/shared/src/stack-detection.ts`**: 26 signatures; Firebase en Supabase staan er **niet** in. Stack-detection draait op response-headers + meta-tags + HTML-substrings.
- **`apps/worker/src/checks/browser/browser-storage.ts`**: scant `localStorage`/`sessionStorage` op Supabase keys/JWTs via de bestaande classifier.
- **`apps/worker/src/checks/types.ts`**: `fetchPage` (SSRF-guard, byte-cap, redirect-follow) en `CheckContext.fetchPage` (gememoïseerde gedeelde fetch) beschikbaar voor de http-worker.
- **`packages/scan-core/src/domain-net.ts`**: outbound-request-helpers met per-host rate-limiting.

## Contract / DB / API

- **Shared** (`packages/shared/src/baas-security.ts`):
  - `BaasFingerprint` — `{ platform: "supabase" | "firebase" | "convex", projectUrl: string, evidence: Record<string, string> }`.
  - `extractBaasFingerprints(html: string, scripts: string[]): BaasFingerprint[]` — pure regex-scan op response-body + inline/externe scripts.
  - `SupabaseProbeResult` — `{ schema_public: boolean, tables_found: string[], anon_key_used: boolean }`.
  - `FirebaseProbeResult` — `{ rtdb_open: boolean, storage_open: boolean, rtdb_shallow_keys: string[] | null, storage_items: number | null }`.
  - `ConvexProbeResult` — `{ functions_public: boolean, function_count: number | null }`.
  - Drie aparte, type-veilige evaluatie-functies (geen union-parameter):
    - `evaluateSupabaseProbe(fp: BaasFingerprint, probe: SupabaseProbeResult): { status, severity, detail }`.
    - `evaluateFirebaseProbe(fp: BaasFingerprint, probe: FirebaseProbeResult): { status, severity, detail }`.
    - `evaluateConvexProbe(fp: BaasFingerprint, probe: ConvexProbeResult): { status, severity, detail }`.

- **Catalog** (`packages/shared/src/check-catalog.ts`):
  ```
  { id: "supabase-security",  category: "http", name: "Supabase-security (RLS / key-exposure)",  active: false }
  { id: "firebase-security",  category: "http", name: "Firebase-security (rules / bucket-access)", active: false }
  { id: "convex-security",    category: "http", name: "Convex-security (open endpoints)",          active: false }
  ```

- **Worker** (`apps/worker/src/checks/http/baas-security.ts`):
  - Eén `ImplementedCheck` met `outputCheckIds: ["supabase-security", "firebase-security", "convex-security"]` — één implementatie, drie catalog-entries (zelfde patroon als `securityHeadersCheck` met 8 IDs).
  - Draait in de http-queue op de seed-route (niet per-route — BaaS-config is site-breed, niet route-specifiek).

- **Registry** (`apps/worker/src/checks/registry.ts`): `baasSecurityCheck` registreren in de `http`-queue.

- **Findings**: per platform maximaal 1–3 findings; evidence bevat platform-URL (publiek), gemaskeerde keys, en probe-resultaat (response-status + shallow data). Severity conform tabel in besluit 7.

- **Fix-prompts** (`packages/shared/src/fix-prompt.ts`): drie templates:
  - Supabase: "Schakel RLS in op alle tabellen: `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;`…"
  - Firebase: "Beveilig je Realtime Database rules: `{ \"rules\": { \".read\": false, \".write\": false } }`…"
  - Convex: "Voeg authenticatie toe aan je Convex-functies…"

- **Stack-detection uitbreiding**: voeg Supabase + Firebase + Convex toe aan de `SIGNATURES`-lijst in `stack-detection.ts` zodat ze als herkend platform verschijnen op de site-detailpagina:
  - Supabase: HTML/JS-substring `supabase.co` of `@supabase/supabase-js`.
  - Firebase: HTML/JS-substring `firebaseio.com` of `firebase/app`.
  - Convex: HTML/JS-substring `convex.cloud` of `convex/_generated`.

- **UI**: findings verschijnen in de bestaande findings-lijst (categorie HTTP). Geen aparte pagina in v1. De stack-detection-badge toont het BaaS-platform.

## Stappen

1. **`packages/shared/src/baas-security.ts`** [NIEUW]: pure helpers:
   - `extractBaasFingerprints(html, scripts)` — regex-extractie van project-URL's + config-objecten per platform.
   - `evaluateSupabaseProbe(fp, probe)`, `evaluateFirebaseProbe(fp, probe)`, `evaluateConvexProbe(fp, probe)` — severity-mapping (drie aparte, type-veilige functies; géén union-parameter).
   - Evidence-schema's (Zod) + masking-helpers.
   - Unit-tests: per platform positieve + negatieve fixtures; edge cases (minified code, template literals, meerdere projecten op één pagina). **De minified/gebundelde fixtures moeten echte bundler-output zijn** (bv. een klein `vite build` / `esbuild`-artefact van een `firebaseConfig`- en `createClient`-snippet), niet handgeschreven "minified" strings — anders test je de regex niet tegen de geneste-braces- en whitespace-eliminatie-vormen die in productie voorkomen.

2. **`packages/shared/src/stack-detection.ts`** [WIJZIG]: drie signatures toevoegen voor Supabase/Firebase/Convex (HTML-substring-match).

3. **`packages/shared/src/check-catalog.ts`** [WIJZIG]: drie entries toevoegen.

4. **`packages/shared/src/fix-prompt.ts`** [WIJZIG]: drie fix-prompt-templates toevoegen.

5. **`packages/shared/src/index.ts`** [WIJZIG]: exports toevoegen.

6. **`apps/worker/src/checks/http/baas-security.ts`** [NIEUW]: check-implementatie:
   - Leest gememoïseerde response-body + scripts via `ctx.fetchPage`.
   - Roept `extractBaasFingerprints()` aan.
   - Per gevonden fingerprint: voert de passieve probe uit via `fetch` (SSRF-guarded, rate-limited).
   - Converteert probe-resultaten naar findings via de `evaluate*`-helpers.
   - Retourneert `InlineCheckLike[]` per platform-catalog-ID.

7. **`apps/worker/src/checks/registry.ts`** [WIJZIG]: `baasSecurityCheck` registreren.

8. **Tests**:
   - Pure helpers (shared): fingerprint-extractie, evaluatie, masking.
   - Worker check (mock fetch): Supabase open schema, Firebase open DB, Firebase beschermd, Convex open/beschermd, geen platform gevonden → lege findings.
   - SSRF-guard: bevestig dat probes door `assertOutboundAllowed` gaan.

## Fingerprint-regexen (ontwerp)

### Supabase
```
URL:       /https:\/\/([a-z0-9-]+)\.supabase\.co/g
Anon key:  /sb_publishable_[A-Za-z0-9_-]{20,}/g  (bestaand in bundle-secrets)
Secret:    /sb_secret_[A-Za-z0-9_-]{20,}/g         (bestaand in bundle-secrets)
JWT:       classifySupabaseJwt()                    (bestaand in bundle-secrets)
Config:    /supabaseUrl\s*[:=]\s*["']([^"']+)["']/g
```

### Firebase
```
Config:    /firebaseConfig\s*=\s*\{[^}]*apiKey\s*:\s*["']([^"']+)["'][^}]*\}/gs
DB URL:    /https:\/\/([a-z0-9-]+)\.firebaseio\.com/g
Storage:   /([a-z0-9-]+)\.appspot\.com/g
API key:   /\bAIza[0-9A-Za-z_-]{35}\b/g            (bestaand in bundle-secrets)
SDK:       /firebase\/app|@firebase\/app/g
```

### Convex
```
URL:       /https:\/\/([a-z0-9-]+)\.convex\.cloud/g
Import:    /convex\/_generated/g
```

## Open vragen

1. **Supabase-probe met gevonden anon-key**: moeten we de anon-key die we in de bundle vinden ook daadwerkelijk *gebruiken* om te proben (om te testen of de PostgREST specifieke tabellen retourneert), of alleen de key *rapporteren* en de probe doen zonder key? → *Voorstel*: probe zonder key eerst (test of endpoint volledig open is); als dat 401 retourneert en we hebben een anon-key, probe met anon-key (test of RLS ontbreekt op schema-niveau). Dit is functioneel identiek aan wat een kwaadwillende zou doen met de publieke key.

2. **Meerdere BaaS-projecten op één site**: een site kan meerdere Supabase-projecten of een mix van Firebase + Supabase gebruiken. → *Voorstel*: probe alle unieke project-URL's, maar begrens tot maximaal 3 per platform om runaway te voorkomen.

3. **Firebase Firestore in v2**: als we collectienamen uit de client-code kunnen extraheren (bv. `collection(db, "users")`), kunnen we `GET .../documents/users` proben. Dit is complexer en fout-gevoelig. → *Voorstel*: parkeren voor v2; v1 dekt alleen Realtime DB + Cloud Storage.

4. **Convex-endpoint stabiliteit**: Convex's publieke metadata-endpoints zijn minder gedocumenteerd dan Firebase/Supabase. → *Voorstel*: v1 doet best-effort fingerprint + bekende probes; als een probe 404 retourneert, rapporteer alleen fingerprint als info.

## Acceptatiecriteria

- [ ] `supabase-security` detecteert Supabase project-URL's in HTML/JS en probeert de PostgREST-schema-endpoint; levert `high` bij publiek schema, `info` bij beschermd endpoint.
- [ ] `firebase-security` detecteert Firebase project-URL's en probeert `.json?shallow=true&limitToFirst=1` + Storage bucket; levert `high` bij open DB/bucket, `info` bij beschermd.
- [ ] `convex-security` detecteert Convex deployment-URL's en probeert metadata-endpoint; levert `low` bij open functies, `info` bij beschermd.
- [ ] Supabase `service_role`-key in frontend blijft `critical` (bestaande `bundle-secrets` severity — geen duplicaat-finding, alleen cross-referentie).
- [ ] Geen data-dump: Firebase-probe gebruikt `shallow=true&limitToFirst=1`; Supabase-probe leest alleen de schema-listing, niet de tabelinhoud.
- [ ] Probes gaan door `assertOutboundAllowed` + per-host rate-limit; maximaal 3 probes per platform én maximaal 9 probes globaal per scan. Bij overschrijding van het globale budget worden resterende fingerprints als `info` gerapporteerd (gedetecteerd, niet geprobed).
- [ ] `baas-security` emit geen duplicaat van findings die `bundle-secrets` al produceert (o.a. `service_role`-key); alleen cross-referentie.
- [ ] Evidence bevat gemaskeerde keys en project-URL's (publieke informatie); nooit volledige JWT's of secret-keys in evidence.
- [ ] Pure helpers (`extractBaasFingerprints`, `evaluate*Probe`) zijn unit-getest op fixtures per platform + edge cases (minified, template literals, geen match).
- [ ] Stack-detection toont Supabase/Firebase/Convex als herkend platform.
- [ ] Fix-prompts bieden concrete, paste-ready remediatie per platform.
