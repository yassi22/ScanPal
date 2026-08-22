import { z } from "zod";

/**
 * Domein-status van één site (plan 56, Domain Watchtower). Denormaliseerde
 * weergave van de laatste meting (scan of dagelijkse watch) — de bron voor de
 * domein-kaart op de site-detailpagina. `nameservers` / `caa_records` worden
 * niet op `sites` opgeslagen maar wel meegeleverd in de API-respons (laatste
 * meting uit `domain_events` of een live meting).
 */
export const domainStatusSchema = z.object({
  site_id: z.string().uuid(),
  domain_expiry: z.string().datetime().nullable(),
  domain_registrar: z.string().nullable(),
  dnssec_enabled: z.boolean().nullable(),
  caa_present: z.boolean().nullable(),
  tls_expiry: z.string().datetime().nullable(),
  nameservers: z.array(z.string()).nullable(),
  last_checked_at: z.string().datetime().nullable(),
});
export type DomainStatus = z.infer<typeof domainStatusSchema>;

export const domainEventFieldSchema = z.enum([
  "domain_expiry",
  "domain_registrar",
  "dnssec_enabled",
  "caa_present",
  "tls_expiry",
  "nameservers",
  "caa_records",
]);
export type DomainEventField = z.infer<typeof domainEventFieldSchema>;

export const domainEventSchema = z.object({
  id: z.string().uuid(),
  site_id: z.string().uuid(),
  field: domainEventFieldSchema,
  old_value: z.string().nullable(),
  new_value: z.string().nullable(),
  checked_at: z.string().datetime(),
});
export type DomainEvent = z.infer<typeof domainEventSchema>;

export const domainStatusResponseSchema = z.object({
  status: domainStatusSchema,
  events: z.array(domainEventSchema).default([]),
});
export type DomainStatusResponse = z.infer<typeof domainStatusResponseSchema>;

/**
 * Een meting van de domein-gezondheid (RDAP + DNS + TLS-expiry), zoals de
 * catalog-check `domain-watchtower` en de dagelijkse watch-taak produceren.
 * Puur-gegevens — geen netwerkafhankelijkheid — zodat `diffDomainStatus`
 * unit-testbaar is.
 */
export const domainMeasurementSchema = z.object({
  domain_expiry: z.string().datetime().nullable(),
  domain_registrar: z.string().nullable(),
  dnssec_enabled: z.boolean().nullable(),
  caa_present: z.boolean().nullable(),
  tls_expiry: z.string().datetime().nullable(),
  nameservers: z.array(z.string()).nullable(),
  caa_records: z.array(z.string()).nullable(),
});
export type DomainMeasurement = z.infer<typeof domainMeasurementSchema>;

/**
 * Alert-regels (plan 56, besluit 4). Drempels:
 * - expiry < EXPIRY_ALERT_DAYS dagen in de toekomst
 * - tls_expiry < TLS_ALERT_DAYS dagen in de toekomst
 * - DNSSEC uitgeschakeld
 * - nameserver-wijziging (verschil met vorige meting)
 * - nieuwe CAA die bot-blokkerend is (basis-check: bevat `;` met lege/`0 issue`
 *   — hier vereenvoudigd naar: CAA aanwezig met een restrictief record)
 */
export const DOMAIN_EXPIRY_ALERT_DAYS = 30;
export const DOMAIN_TLS_ALERT_DAYS = 14;

// --- Pure helpers (geen node-imports; gedeeld worker + scheduler) -----------

/** Tweede-niveau-TLD's waar het registrable domain 3 labels telt. */
const TWO_LABEL_TLDS = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "ltd.uk", "plc.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au",
  "co.nz", "net.nz", "org.nz", "ac.nz",
  "co.jp", "co.kr", "or.kr", "ne.jp",
  "com.br", "com.cn", "com.tw", "co.in", "org.in", "co.za", "co.il",
]);

/**
 * Bepaalt het registrable (apex) domein: subdomein-sites meten via hun apex
 * (plan 56, besluit 5). Heuristiek op basis van een kleine tweede-niveau-set —
 * geen volledige Public Suffix List (open vraag plan 56). `null` voor IP's of
 * ongeldig.
 */
export function registrableDomain(host: string): string | null {
  const normalized = host.toLowerCase().replace(/\.+$/, "");
  if (!normalized || !normalized.includes(".")) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(normalized)) return null;
  const labels = normalized.split(".");
  if (labels.length <= 2) return normalized;
  const last2 = labels.slice(-2).join(".");
  if (TWO_LABEL_TLDS.has(last2)) return labels.slice(-3).join(".");
  return last2;
}

/**
 * IDN → punycode (plan 56, besluit 5). De daadwerkelijke conversie gebeurt via
 * `node:url.domainToASCII` in de netwerklaag (scan-core); deze pure helper doet
 * de ASCII-doorvoer alleen als de input al ASCII is (geen tekens > 0x7f), zodat
 * shared zelf geen node-builtin hoeft te importeren. De netwerklaag roept
 * `domainToASCII` aan voor niet-ASCII input.
 */
export function toPunycode(host: string): string {
  if (/^[\x00-\x7f]*$/.test(host)) return host.toLowerCase();
  return host.toLowerCase();
}

export type RdapParsed = {
  domain_expiry: string | null;
  domain_registrar: string | null;
  nameservers: string[];
  transfer_locked: boolean | null;
};

type RdapJson = {
  events?: Array<{ eventAction?: string; eventDate?: string }>;
  entities?: Array<{
    roles?: string[];
    vcardArray?: unknown[];
    handle?: string;
  }>;
  nameservers?: Array<{ ldhName?: string; unicodeName?: string }>;
  status?: string[];
};

/**
 * Pure RDAP-parser (plan 56, stap 1). Haalt expiry (eventAction "expiration"),
 * registrar (entity met rol "registrar"), nameservers en transfer-lock
 * (status bevat "serverTransferProhibited") uit een RDAP-respons.
 */
export function parseRdap(json: RdapJson): RdapParsed {
  const expiryEvent = (json.events ?? []).find(
    (e) => e.eventAction === "expiration" && e.eventDate,
  );
  const domain_expiry = expiryEvent?.eventDate ?? null;

  const registrarEntity = (json.entities ?? []).find(
    (e) => e.roles?.includes("registrar"),
  );
  const domain_registrar = registrarEntity
    ? vcardFn(registrarEntity.vcardArray) ?? registrarEntity.handle ?? null
    : null;

  const nameservers = (json.nameservers ?? [])
    .map((n) => (n.ldhName ?? n.unicodeName ?? "").toLowerCase().replace(/\.+$/, ""))
    .filter((n) => n.length > 0);

  const status = json.status ?? [];
  const transfer_locked = status.length
    ? status.some((s) => /transferprohibited/i.test(s))
    : null;

  return { domain_expiry, domain_registrar, nameservers, transfer_locked };
}

function vcardFn(vcardArray: unknown[] | undefined): string | null {
  if (!Array.isArray(vcardArray) || vcardArray.length < 2) return null;
  const entries = vcardArray[1];
  if (!Array.isArray(entries)) return null;
  for (const entry of entries) {
    if (Array.isArray(entry) && entry[0] === "fn" && typeof entry[3] === "string") {
      return entry[3];
    }
  }
  return null;
}

const WHOIS_EXPIRY_PATTERNS = [
  /Registry Expiry Date:\s*(.+)/i,
  /Expiry Date:\s*(.+)/i,
  /Expiration Date:\s*(.+)/i,
  /Expires On:\s*(.+)/i,
  /paid-till:\s*(.+)/i,
  /Renewal date:\s*(.+)/i,
  /Record expires on:\s*(.+)/i,
];

/**
 * Whois-fallback (plan 56, besluit 2): parse expiry uit een whois-tekstblob.
 * Herkent de gangbare veldnamen; `null` als er geen match is.
 */
export function parseWhoisExpiry(text: string): string | null {
  for (const pattern of WHOIS_EXPIRY_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      // Neem het eerste token (tot spatie/haakje) — sommige registrars voegen
      // een trailing "(UTC)" of timezone-commentaar toe.
      const value = match[1].trim().split(/[\s(]/)[0];
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
  }
  return null;
}

/** Normaliseert een nameserver-set voor vergelijking: lower, geen trailing dot, gesorteerd. */
export function normalizeNs(nameservers: string[]): string[] {
  return [...nameservers]
    .map((n) => n.toLowerCase().replace(/\.+$/, ""))
    .filter((n) => n.length > 0)
    .sort();
}

function asComparable(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.slice().sort().join(",");
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

export type DomainDiff = {
  field: DomainEventField;
  old_value: string | null;
  new_value: string | null;
};

/**
 * Vergelijkt twee metingen en retourneert alleen de velden die veranderd zijn
 * (plan 56, besluit 3 — events alleen bij verandering). `nameservers` /
 * `caa_records` worden genormaliseerd (set-vergelijking) zodat volgorde geen
 * valse drift oplevert.
 */
export function diffDomainMeasurement(
  prev: Partial<DomainMeasurement>,
  next: DomainMeasurement,
): DomainDiff[] {
  const fields: DomainEventField[] = [
    "domain_expiry",
    "domain_registrar",
    "dnssec_enabled",
    "caa_present",
    "tls_expiry",
    "nameservers",
    "caa_records",
  ];
  const diffs: DomainDiff[] = [];
  for (const field of fields) {
    const oldRaw = prev[field];
    const newRaw = next[field];
    const oldCmp = asComparable(
      field === "nameservers" || field === "caa_records"
        ? normalizeNs((oldRaw as string[] | null) ?? [])
        : oldRaw,
    );
    const newCmp = asComparable(
      field === "nameservers" || field === "caa_records"
        ? normalizeNs((newRaw as string[] | null) ?? [])
        : newRaw,
    );
    if (oldCmp !== newCmp) {
      diffs.push({
        field,
        old_value: oldRaw === undefined || oldRaw === null ? null : asComparable(oldRaw),
        new_value: newRaw === null ? null : asComparable(newRaw),
      });
    }
  }
  return diffs;
}

export type DomainAlert = {
  field: DomainEventField;
  summary: string;
};

function daysUntil(iso: string, now: Date): number {
  return Math.floor((new Date(iso).getTime() - now.getTime()) / 86_400_000);
}

/**
 * Alert-regels (plan 56, besluit 4). `diffs` zijn de veranderingen sinds de
 * vorige meting; alerts worden alleen gevuurd voor velden die veranderd zijn
 * (plan: "alleen alert bij verandering") én een drempel raken. Herhalings-
 * drempeloverschrijdingen die al in de vorige meting gold worden niet opnieuw
 * gealert (geen spam bij ongewijzigde status).
 */
export function domainAlerts(
  diffs: DomainDiff[],
  next: DomainMeasurement,
  now: Date = new Date(),
): DomainAlert[] {
  const changedFields = new Set(diffs.map((d) => d.field));
  const alerts: DomainAlert[] = [];

  if (next.domain_expiry && changedFields.has("domain_expiry")) {
    const days = daysUntil(next.domain_expiry, now);
    if (days < 0) {
      alerts.push({ field: "domain_expiry", summary: `Domeinregistratie is verlopen (${Math.abs(days)} d geleden)` });
    } else if (days < DOMAIN_EXPIRY_ALERT_DAYS) {
      alerts.push({ field: "domain_expiry", summary: `Domein loopt af over ${days} d (< ${DOMAIN_EXPIRY_ALERT_DAYS} d)` });
    }
  }

  if (next.tls_expiry && changedFields.has("tls_expiry")) {
    const days = daysUntil(next.tls_expiry, now);
    if (days < 0) {
      alerts.push({ field: "tls_expiry", summary: `TLS-certificaat is verlopen (${Math.abs(days)} d geleden)` });
    } else if (days < DOMAIN_TLS_ALERT_DAYS) {
      alerts.push({ field: "tls_expiry", summary: `TLS-certificaat verloopt over ${days} d (< ${DOMAIN_TLS_ALERT_DAYS} d)` });
    }
  }

  if (changedFields.has("dnssec_enabled") && next.dnssec_enabled === false) {
    alerts.push({ field: "dnssec_enabled", summary: "DNSSEC is uitgeschakeld" });
  }

  if (changedFields.has("nameservers")) {
    alerts.push({ field: "nameservers", summary: "Nameserver-set is gewijzigd" });
  }

  if (
    changedFields.has("caa_present") &&
    next.caa_present === true
  ) {
    alerts.push({ field: "caa_present", summary: "Nieuwe CAA-record toegevoegd (controleer of AI-bots niet geblokkeerd worden)" });
  }

  return alerts;
}

// --- E-mail DNS (plan 68, SPF/DKIM/DMARC/MX) -------------------------------

/**
 * Resultaat van de e-mail-DNS-meting (plan 68). Puur-gegevens — de netwerklaag
 * (`resolveEmailDns` in scan-core) vult dit; de evaluatie (`evaluateEmailDns`)
 * is puur en unit-testbaar op mock-data.
 */
export const emailDnsSchema = z.object({
  spf: z
    .object({
      present: z.boolean(),
      raw: z.string(),
      all_qualifier: z.enum(["all", "+all", "-all", "~all", "?all"]).nullable(),
    })
    .nullable(),
  /** Aantal SPF-records gevonden (RFC-overtreding als > 1). */
  spf_record_count: z.number(),
  dmarc: z
    .object({
      present: z.boolean(),
      policy: z.enum(["none", "quarantine", "reject", "missing"]).nullable(),
      rua_present: z.boolean(),
    })
    .nullable(),
  mx: z.array(z.string()),
  dkim_selectors_found: z.array(z.string()),
});
export type EmailDns = z.infer<typeof emailDnsSchema>;

/**
 * Parse een SPF-record (plan 68, besluit 3). `null` als de input geen geldig
 * SPF-record is. `all_qualifier` is de qualifier vóór `all` (`+`/`-`/`~`/`?`
 * of leeg = `all`); `null` als het record geen `all`-mechanisme bevat.
 */
export function parseSpf(txt: string): {
  present: boolean;
  raw: string;
  all_qualifier: "all" | "+all" | "-all" | "~all" | "?all" | null;
} | null {
  const record = txt.trim();
  if (!record.startsWith("v=spf1")) return null;
  const allMatch = record.match(/(?:^|\s)([+\-~?]?)all\b/);
  let all_qualifier: "all" | "+all" | "-all" | "~all" | "?all" | null = null;
  if (allMatch) {
    const q = allMatch[1];
    all_qualifier = (q === "" ? "all" : `${q}all`) as "all" | "+all" | "-all" | "~all" | "?all";
  }
  return { present: true, raw: record, all_qualifier };
}

/**
 * Parse een DMARC-record (plan 68, besluit 3). Verwacht de TXT-waarde van
 * `_dmarc.<apex>`. `policy` is de `p=`-waarde (`none`/`quarantine`/`reject`);
 * `missing` als het record geen `p=` bevat. `rua_present` geeft aan of er een
 * aggregatie-rapportage-adres is.
 */
export function parseDmarc(txt: string): {
  present: boolean;
  policy: "none" | "quarantine" | "reject" | "missing";
  rua_present: boolean;
} | null {
  const record = txt.trim();
  if (!record.startsWith("v=DMARC1")) return null;
  const pMatch = record.match(/\bp\s*=\s*(none|quarantine|reject)/i);
  const policy: "none" | "quarantine" | "reject" | "missing" = pMatch
    ? (pMatch[1].toLowerCase() as "none" | "quarantine" | "reject")
    : "missing";
  const rua_present = /\brua\s*=/.test(record);
  return { present: true, policy, rua_present };
}

/**
 * Heuristische telling van SPF-mechanismen die extra DNS-lookups vereisen
 * (RFC 7208, max 10). Telt `include:`, `a`, `mx`, `exists:`, `redirect=`.
 * Niet exact (recursief), maar voldoende voor een waarschuwing (plan 68,
 * open vraag 2).
 */
export function spfLookupCount(txt: string): number {
  const record = txt.trim();
  let count = 0;
  count += (record.match(/\binclude:/gi) ?? []).length;
  count += (record.match(/(^|\s)a(?=[\s:]|$)/gi) ?? []).length;
  count += (record.match(/(^|\s)mx(?=[\s:]|$)/gi) ?? []).length;
  count += (record.match(/\bexists:/gi) ?? []).length;
  count += (record.match(/\bredirect=/gi) ?? []).length;
  return count;
}
