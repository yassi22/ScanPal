/**
 * File Upload Security Scanner (plan 78, gap G10) — ontdekt upload-formulieren
 * en probeert een curated set kleine, ONSCHADELIJKE canary-bestanden te
 * uploaden om te observeren of de server type/inhoud/grootte/pad valideert.
 * Draait in de browser-worker (Playwright), net als plan 77 (auth-flow).
 *
 * Deze module is puur (geen netwerk, geen echte upload): de runner voert de
 * probes uit en levert een {@link UploadFlowCapture} met ruwe observaties;
 * de check interpreteert die tot `upload-*`-findings (`active: true`, niet
 * in de score). Canary-payloads zijn altijd inert — ze bevatten of echoën
 * uitsluitend een willekeurig token, nooit een echte webshell/payload
 * (plan besluit 1). Detectie-helpers zijn unit-testbaar op mocks.
 */

/** De vijf catalog-ids die de upload-scan-implementatie produceert. */
export const UPLOAD_CHECK_IDS = [
  "upload-unrestricted-type",
  "upload-executable",
  "upload-content-sniff",
  "upload-size-limit",
  "upload-path-traversal",
] as const;
export type UploadCheckId = (typeof UPLOAD_CHECK_IDS)[number];

/**
 * Begrensd groot testbestand voor de size-limit-probe (plan besluit 5): 2 MiB.
 * Bewust klein gehouden zodat dit nooit een multi-MB-upload tegen een live
 * site wordt — enkel groot genoeg om een ontbrekende server-side groottelimiet
 * aannemelijk te maken.
 */
export const UPLOAD_SIZE_PROBE_BYTES = 2 * 1024 * 1024;

/**
 * Genereert een willekeurig canary-token (32 lowercase hex-tekens, v4-UUID
 * zonder streepjes — zelfde techniek als `generateReportToken` in
 * `report-tokens.ts`). Dit token is het enige "bewijs" dat een probe-bestand
 * bevat: de runner uploadt het, haalt het resultaat op en de check bepaalt
 * puur op basis van "bevat de respons dit token, en zo ja: is dat de rauwe
 * bron of server-side gegenereerde output" (zie {@link outputDiffersFromSource}).
 */
export function makeCanaryToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/** Eén curated upload-probe: beschrijft een poging zonder die uit te voeren. */
export type UploadProbe = {
  /** Catalog-id die deze probe primair voedt. */
  id: UploadCheckId;
  /** Bestandsnaam die de multipart-upload claimt. */
  filename: string;
  /** Content-Type die het multipart-part claimt. */
  content_type: string;
  /** Of de extensie een gevaarlijk/actief type is (php/svg/html e.d.). */
  active_type: boolean;
  description: string;
  /**
   * Body-template met een `{{TOKEN}}`-placeholder. De runner vervangt dit
   * via {@link buildProbeBody} vóór upload. Bevat NOOIT echte
   * webshell-/exploit-code — enkel een inerte marker die het token
   * echoot/bevat (plan besluit 1).
   */
  body_template: string;
};

/**
 * Curated probe-set (plan besluit 5), één per scenario. `shell.php` (mismatch)
 * en `shell.php.jpg` (double extension) voeden primair `upload-unrestricted-
 * type`; wanneer de check-laag server-side executie observeert (token als
 * output, niet als bron) rapporteert diezelfde observatie ook onder
 * `upload-executable` (RCE-klasse) — dat is een interpretatie door de
 * check-laag, geen apart probe-object.
 */
export const UPLOAD_PROBES: readonly UploadProbe[] = [
  {
    id: "upload-unrestricted-type",
    filename: "shell.php",
    content_type: "image/jpeg",
    active_type: true,
    description:
      "Extensie/content-type-mismatch: .php-bestand aangeboden als image/jpeg — test of de server op de Content-Type-header vertrouwt in plaats van de extensie/inhoud te valideren.",
    body_template: '<?php echo "{{TOKEN}}"; ?>',
  },
  {
    id: "upload-unrestricted-type",
    filename: "shell.php.jpg",
    content_type: "image/jpeg",
    active_type: true,
    description:
      "Double extension: bestandsnaam eindigt op .jpg maar bevat een tweede, gevaarlijke .php-extensie — test op extensie-allowlisting die enkel naar de laatste punt kijkt.",
    body_template: '<?php echo "{{TOKEN}}"; ?>',
  },
  {
    id: "upload-content-sniff",
    filename: "xss.svg",
    content_type: "image/svg+xml",
    active_type: true,
    description:
      "SVG met een ingesloten script, aangeboden als image/svg+xml — test of de server/CDN dit als een uitvoerbaar (in-browser gerenderd) type opslaat en teruggeeft (stored-XSS-vector) in plaats van als onschadelijke afbeelding.",
    body_template:
      '<svg xmlns="http://www.w3.org/2000/svg"><script>document.title="{{TOKEN}}";</script></svg>',
  },
  {
    id: "upload-size-limit",
    filename: "big.bin",
    content_type: "application/octet-stream",
    active_type: false,
    description:
      "Begrensd groot testbestand (UPLOAD_SIZE_PROBE_BYTES) — test of de server een groottelimiet afdwingt in plaats van een ongelimiteerde upload te accepteren.",
    body_template: "{{TOKEN}}",
  },
  {
    id: "upload-path-traversal",
    filename: "../canary.txt",
    content_type: "text/plain",
    active_type: false,
    description:
      "Bestandsnaam met path-traversal-sequentie — test of de server de bestandsnaam saniteert vóór opslag in plaats van die letterlijk in het pad te gebruiken.",
    body_template: "canary — do not delete. token: {{TOKEN}}",
  },
];

/**
 * Bouwt de daadwerkelijke upload-body voor een probe: vervangt de
 * `{{TOKEN}}`-placeholder door het gegeven canary-token. Voor de
 * size-limit-probe wordt de body aangevuld met vulling tot exact
 * {@link UPLOAD_SIZE_PROBE_BYTES} bytes zodat het bestand daadwerkelijk de
 * begrensd-grote testomvang heeft.
 */
export function buildProbeBody(probe: UploadProbe, token: string): string {
  const withToken = probe.body_template.replace("{{TOKEN}}", token);
  if (probe.id === "upload-size-limit") {
    const fillerLength = Math.max(0, UPLOAD_SIZE_PROBE_BYTES - withToken.length);
    return withToken + "A".repeat(fillerLength);
  }
  return withToken;
}

/** Passief ontdekt upload-formulier. */
export type UploadFormCapture = {
  url: string;
  https: boolean;
  behind_login: boolean;
  /** Client-side `accept=`-restrictie, indien aanwezig (voor de `low` "schijnbeveiliging"-case). */
  accept_attribute: string | null;
};

/**
 * Resultaat van één probe-upload-poging. `executed` is uitsluitend `true`
 * wanneer de opgehaalde body server-side GEGENEREERDE OUTPUT van het token
 * is (bijv. het token zelf, als resultaat van `<?php echo %token%; ?>`) —
 * nooit enkel omdat de rauwe bron ("stored") het token bevat (plan open
 * question 1). Zie {@link outputDiffersFromSource}.
 */
export type UploadProbeResult = {
  probe_id: UploadCheckId;
  filename: string;
  content_type: string;
  active_type: boolean;
  accepted: boolean;
  stored_url: string | null;
  retrieved: boolean;
  executed: boolean;
  retrieved_body: string;
  status: number;
};

/** Volledige observatie-set die de runner teruggeeft; de check interpreteert. */
export type UploadFlowCapture = {
  forms: UploadFormCapture[];
  probes: UploadProbeResult[];
  /** Canary-URL's die zijn achtergebleven omdat er geen delete-UI bestaat (plan besluit 6). */
  leftover_files: string[];
  cleaned_up: boolean;
  errors: string[];
};

/** Resultaat van de runner-aanroep (`ok: false` → check degradeert naar info). */
export type UploadFlowRunResult =
  | { ok: true; capture: UploadFlowCapture }
  | { ok: false; error: string };

/**
 * Bepaalt of een opgehaalde respons-body server-side GEGENEREERDE OUTPUT van
 * het canary-token is, in plaats van gewoon de rauwe geüploade bron. `false`
 * wanneer het token niet in de respons voorkomt (geen bewijs), of wanneer de
 * respons — na trimmen — identiek is aan de geüploade bron (het bestand is
 * enkel teruggegeven/gedownload, niet uitgevoerd).
 */
export function outputDiffersFromSource(uploadedSource: string, retrievedBody: string, token: string): boolean {
  if (!retrievedBody.includes(token)) return false;
  return retrievedBody.trim() !== uploadedSource.trim();
}

/**
 * Herkent schijnbeveiliging: er is een client-side `accept=`-restrictie
 * aanwezig, maar de server sloeg het bestand toch op.
 */
export function isClientSideOnlyRestriction(input: { acceptAttribute: string | null; stored: boolean }): boolean {
  return input.acceptAttribute !== null && input.stored;
}

/**
 * Oordeel-ladder (plan besluit 4). `clientSideRestriction` is optioneel omdat
 * de vier runner-observaties op zichzelf niet kunnen uitdrukken dat een
 * `accept=`-attribuut aanwezig was.
 * Cascaderende (if/else) volgorde — ondubbelzinnig, dekt elke combinatie:
 * - `high` — opgeslagen ÉN uitgevoerd (token als output, niet als bron) →
 *   onbeperkte upload met executie (RCE-klasse).
 * - `high` — gevaarlijk actief type (svg/html) opgeslagen én publiek
 *   ophaalbaar, maar niet uitgevoerd → stored-XSS-vector.
 * - `low` — opgeslagen ondanks uitsluitend een client-side restrictie.
 * - `medium` — opgeslagen, maar niet in de bovenstaande gevallen →
 *   verdachte extensie/content-type geaccepteerd, zwakke server-side filtering.
 * - `info` — niet opgeslagen → server weigerde het bestand correct.
 * `reason` beschrijft enkel het geobserveerde gedrag, geen absolute claims
 * (plan besluit 8).
 */
export function classifyUploadOutcome(input: {
  stored: boolean;
  retrievable: boolean;
  executed: boolean;
  activeType: boolean;
  clientSideRestriction?: boolean;
}): { severity: "high" | "medium" | "low" | "info"; reason: string } {
  const { stored, retrievable, executed, activeType, clientSideRestriction = false } = input;

  if (stored && executed) {
    return {
      severity: "high",
      reason:
        "geüpload bestand werd server-side uitgevoerd (canary-token verscheen als output, niet als geüploade bron) — onbeperkte upload met executie",
    };
  }
  if (stored && retrievable && activeType) {
    return {
      severity: "high",
      reason:
        "gevaarlijk bestandstype (bijv. svg/html) werd opgeslagen en is publiek ophaalbaar zonder dat executie is waargenomen — stored-XSS-vector",
    };
  }
  if (stored && clientSideRestriction) {
    return {
      severity: "low",
      reason:
        "bestand werd ondanks een client-side accept-restrictie opgeslagen — alleen client-side filtering waargenomen",
    };
  }
  if (stored) {
    return {
      severity: "medium",
      reason:
        "bestand met verdachte extensie/content-type werd geaccepteerd en opgeslagen — mogelijk zwakke server-side filtering",
    };
  }
  return {
    severity: "info",
    reason: "server weigerde het testbestand (niet opgeslagen)",
  };
}
