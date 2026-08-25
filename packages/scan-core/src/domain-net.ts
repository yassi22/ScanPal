import dns from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";
import { domainToASCII } from "node:url";
import {
  parseRdap,
  parseWhoisExpiry,
  normalizeNs,
  registrableDomain,
  parseSpf,
  parseDmarc,
  extractCtSubdomains,
  type DomainMeasurement,
  type EmailDns,
  type RdapParsed,
  type TakeoverProbe,
} from "@scanpal/shared";

/**
 * Domain Watchtower — netwerklaag (plan 56, stap 1/3). Woont in scan-core zodat
 * zowel de http-worker (catalog-check) als de scheduler (dagelijkse watch) dezelfde
 * meting draaien. Pure helpers (`parseRdap`, `diffDomainMeasurement`,
 * `domainAlerts`) leven in `@scanpal/shared`; hier is alleen de netwerklaag.
 */

const RDAP_TIMEOUT_MS = 10_000;
const WHOIS_TIMEOUT_MS = 10_000;
const TLS_SOCKET_TIMEOUT_MS = 10_000;

export type DomainDeps = {
  fetchImpl?: typeof fetch;
  dnsResolver?: typeof dns;
  connectTcp?: (host: string, port: number, timeoutMs: number) => Promise<string>;
};

/** Punycode-conversie via `node:url` (plan 56, besluit 5). */
export function toPunycode(host: string): string {
  try {
    return domainToASCII(host);
  } catch {
    return host;
  }
}

/**
 * RDAP over HTTPS via de rdap.org-bootstrap (redirect naar de juiste registrar-
 * RDAP). Korte timeout — bij een time-out/fout retourneert `null` zodat de
 * caller op whois terugvalt (plan 56, acceptatiecriteria: geen storing bij
 * RDAP-timeouts).
 */
export async function fetchRdapDomain(
  apexPunycode: string,
  deps: DomainDeps = {},
): Promise<RdapParsed | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const url = `https://rdap.org/domain/${apexPunycode}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RDAP_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/rdap+json" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response.ok) return null;
    const json = await response.json();
    return parseRdap(json as Parameters<typeof parseRdap>[0]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type DnsRecords = {
  nameservers: string[];
  dnssec_enabled: boolean;
  caa_records: string[];
};

/** A- en AAAA-resolutie via de bestaande verwisselbare resolver. */
export async function resolveIps(
  apexPunycode: string,
  deps: DomainDeps = {},
): Promise<string[]> {
  const resolver = deps.dnsResolver ?? dns;
  const [ipv4, ipv6] = await Promise.all([
    safeResolve(resolver.resolve4, resolver, apexPunycode),
    safeResolve(resolver.resolve6, resolver, apexPunycode),
  ]);
  return [...new Set([...ipv4, ...ipv6])].sort();
}

const EDGE_CNAME_SUFFIXES = [
  ".akamaiedge.net",
  ".akamaized.net",
  ".azureedge.net",
  ".cdn.cloudflare.net",
  ".cloudfront.net",
  ".fastly.net",
  ".netlify.global",
  ".vercel-dns.com",
];

/** Best-effort edge/proxy-markering uit bekende CDN-CNAME-doelen. */
export async function detectEdgeProxy(
  hostPunycode: string,
  deps: DomainDeps = {},
): Promise<boolean> {
  const resolver = deps.dnsResolver ?? dns;
  const cnames = await safeResolve(resolver.resolveCname, resolver, hostPunycode);
  return cnames.some((record) => {
    const cname = record.toLowerCase().replace(/\.+$/, "");
    return EDGE_CNAME_SUFFIXES.some((suffix) => cname.endsWith(suffix));
  });
}

export type SpamhausDqsResult = {
  queried: boolean;
  listed: boolean;
  categories: string[];
  detail: string;
};

const ZEN_CODES: Record<string, string> = {
  "127.0.0.2": "ZEN:SBL",
  "127.0.0.3": "ZEN:CSS",
  "127.0.0.4": "ZEN:XBL",
  "127.0.0.9": "ZEN:DROP",
  "127.0.0.10": "ZEN:PBL",
  "127.0.0.11": "ZEN:PBL",
  "127.0.0.30": "ZEN:BCL",
};

const DBL_CODES: Record<string, string> = {
  "127.0.1.2": "DBL:low-reputation",
  "127.0.1.4": "DBL:phishing",
  "127.0.1.5": "DBL:malware",
  "127.0.1.6": "DBL:botnet-c2",
  "127.0.1.102": "DBL:abused-legit",
  "127.0.1.103": "DBL:abused-redirector",
  "127.0.1.104": "DBL:abused-phishing",
  "127.0.1.105": "DBL:abused-malware",
  "127.0.1.106": "DBL:abused-c2",
};

export function parseSpamhausDqsAnswers(
  zone: "zen" | "dbl",
  answers: string[],
): SpamhausDqsResult {
  const unique = [...new Set(answers)];
  if (unique.some((answer) => answer.startsWith("127.255.255."))) {
    return {
      queried: false,
      listed: false,
      categories: [],
      detail: "Spamhaus DQS-key geweigerd of ongeldig.",
    };
  }
  if (zone === "dbl" && unique.includes("127.0.1.255")) {
    return {
      queried: false,
      listed: false,
      categories: [],
      detail: "Spamhaus DBL ontving een ongeldige IP-query.",
    };
  }
  if (unique.some((answer) => !answer.startsWith("127."))) {
    return {
      queried: false,
      listed: false,
      categories: [],
      detail: "Onverwacht Spamhaus DNS-antwoord buiten 127.0.0.0/8.",
    };
  }
  const mapping = zone === "zen" ? ZEN_CODES : DBL_CODES;
  const categories = unique
    .filter((answer) => answer.startsWith("127.0."))
    .map((answer) => mapping[answer] ?? `${zone.toUpperCase()}:${answer}`)
    .sort();
  return {
    queried: true,
    listed: categories.length > 0,
    categories,
    detail:
      categories.length > 0
        ? `Spamhaus ${zone.toUpperCase()}: ${categories.join(", ")}.`
        : `Niet gelist in Spamhaus ${zone.toUpperCase()}.`,
  };
}

function expandIpv6(ip: string): string[] | null {
  const value = ip.toLowerCase().split("%")[0];
  const parts = value.split("::");
  if (parts.length > 2) return null;
  const left = parts[0] ? parts[0].split(":") : [];
  const right = parts[1] ? parts[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((parts.length === 1 && missing !== 0) || missing < 0) return null;
  return [...left, ...Array(missing).fill("0"), ...right].map((part) =>
    part.padStart(4, "0"),
  );
}

export function spamhausDqsQueryName(input: string, key: string): {
  query: string;
  zone: "zen" | "dbl";
} | null {
  const version = net.isIP(input);
  const cleanKey = key.trim().replace(/\.+$/, "");
  if (!cleanKey) return null;
  if (version === 4) {
    const reversed = input.split(".").reverse().join(".");
    return { query: `${reversed}.${cleanKey}.zen.dq.spamhaus.net`, zone: "zen" };
  }
  if (version === 6) {
    const groups = expandIpv6(input);
    if (!groups) return null;
    const reversed = groups.join("").split("").reverse().join(".");
    return { query: `${reversed}.${cleanKey}.zen.dq.spamhaus.net`, zone: "zen" };
  }
  const host = input.toLowerCase().replace(/\.+$/, "");
  if (!host) return null;
  return { query: `${host}.${cleanKey}.dbl.dq.spamhaus.net`, zone: "dbl" };
}

function isNegativeDnsAnswer(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === "ENODATA" || code === "ENOTFOUND" || code === "NXDOMAIN";
}

/** Spamhaus DQS ZEN/DBL A-query met failure-resistente return-status. */
export async function querySpamhausDqs(
  input: string,
  key: string,
  deps: DomainDeps = {},
): Promise<SpamhausDqsResult> {
  const built = spamhausDqsQueryName(input, key);
  if (!built) {
    return { queried: false, listed: false, categories: [], detail: "Ongeldige DQS-query." };
  }
  const resolver = deps.dnsResolver ?? dns;
  try {
    const raw = await resolver.resolve(built.query, "A");
    const answers = Array.isArray(raw) ? raw.filter((value): value is string => typeof value === "string") : [];
    return parseSpamhausDqsAnswers(built.zone, answers);
  } catch (err) {
    if (isNegativeDnsAnswer(err)) return parseSpamhausDqsAnswers(built.zone, []);
    const message = err instanceof Error ? err.message : "DNS-query mislukt";
    return {
      queried: false,
      listed: false,
      categories: [],
      detail: `Spamhaus DQS niet bereikbaar: ${message}`,
    };
  }
}

/**
 * DNS-queries via `node:dns` (plan 56, besluit 2): NS-set, DNSSEC (DS aanwezig
 * → enabled) en CAA. Failure-resistent: een falende query levert een lege set /
 * `false` (geen crash bij een domein zonder DS/CAA).
 */
export async function queryDnsRecords(
  apexPunycode: string,
  deps: DomainDeps = {},
): Promise<DnsRecords> {
  const resolver = deps.dnsResolver ?? dns;
  const nameservers = await resolver.resolveNs(apexPunycode).then(
    (ns) => normalizeNs(ns),
    () => [],
  );
  // DNSSEC: een DS-record aanwezig bij de parent → ondertekende zone. Deze
  // @types/node-versie kent geen `resolveDs`, dus via de generieke `resolve`
  // met rrtype "DS" (array-check; de union-return dekt ook non-array gevallen).
  const dnssec_enabled = await resolver.resolve(apexPunycode, "DS").then(
    (ds: unknown) => Array.isArray(ds) && ds.length > 0,
    () => false,
  );
  const caa_records = await resolver.resolveCaa(apexPunycode).then(
    (caa) => caa.map((c) => formatCaa(c)).sort(),
    () => [],
  );
  return { nameservers, dnssec_enabled, caa_records };
}

/**
 * Bekende DKIM-selectors die geprobedeerd worden (plan 68, besluit 2 / open
 * vraag 1). Afwezigheid van álle selectors ≠ "geen DKIM" — alleen info.
 */
const DKIM_SELECTORS = [
  "google",
  "selector1",
  "selector2",
  "k1",
  "s1",
  "s2",
  "default",
  "dkim",
];

/**
 * E-mail-DNS-meting (plan 68): SPF (TXT op apex), DMARC (TXT op `_dmarc.<apex>`),
 * MX, en best-effort DKIM-selector-probe. Hergebruikt de swappable `dnsResolver`
 * uit {@link DomainDeps} — geen nieuw proces/queue. Failure-resistent: een
 * falende query levert `null`/lege set (geen crash bij een domein zonder TXT/MX).
 */
export async function resolveEmailDns(
  apexPunycode: string,
  deps: DomainDeps = {},
): Promise<EmailDns> {
  const resolver = deps.dnsResolver ?? dns;

  const txtRecords = await resolver.resolveTxt(apexPunycode).then(
    (records) => records.flat(),
    () => [],
  );
  const spfStrings = txtRecords.filter((t) => t.trim().startsWith("v=spf1"));
  const spf = spfStrings.length > 0 ? parseSpf(spfStrings[0]) : null;
  const spf_record_count = spfStrings.length;

  const dmarcTxt = await resolver
    .resolveTxt(`_dmarc.${apexPunycode}`)
    .then((records) => records.flat())
    .catch(() => [] as string[]);
  const dmarc = extractDmarc(dmarcTxt);

  const mx = await resolver.resolveMx(apexPunycode).then(
    (records) => records.map((r) => r.exchange).filter((e) => e.length > 0).sort(),
    () => [],
  );

  const dkim_selectors_found: string[] = [];
  const dkimResults = await Promise.all(
    DKIM_SELECTORS.map((selector) =>
      resolver
        .resolveTxt(`${selector}._domainkey.${apexPunycode}`)
        .then((records) => ({ selector, found: records.flat().length > 0 }))
        .catch(() => ({ selector, found: false })),
    ),
  );
  for (const r of dkimResults) {
    if (r.found) dkim_selectors_found.push(r.selector);
  }

  return { spf, spf_record_count, dmarc, mx, dkim_selectors_found };
}

function extractDmarc(txtRecords: string[]): EmailDns["dmarc"] {
  const dmarcStrings = txtRecords.filter((t) => t.trim().startsWith("v=DMARC1"));
  if (dmarcStrings.length === 0) return null;
  return parseDmarc(dmarcStrings[0]);
}

function formatCaa(c: {
  critical: number;
  issue?: string;
  issuewild?: string;
  iodef?: string;
}): string {
  if (typeof c.issue === "string") return `${c.critical} issue "${c.issue}"`;
  if (typeof c.issuewild === "string") return `${c.critical} issuewild "${c.issuewild}"`;
  if (typeof c.iodef === "string") return `${c.critical} iodef "${c.iodef}"`;
  return `${c.critical} caa`;
}

/**
 * Whois-fallback over TCP poort 43 (plan 56, besluit 2). Verbindt met de IANA-
 * whois-redirector, leest de tekst-response en parsed de expiry.
 */
export async function whoisExpiry(
  apexPunycode: string,
  deps: DomainDeps = {},
): Promise<string | null> {
  const connect = deps.connectTcp ?? defaultWhoisConnect;
  try {
    const text = await connect(apexPunycode, 43, WHOIS_TIMEOUT_MS);
    return parseWhoisExpiry(text);
  } catch {
    return null;
  }
}

async function defaultWhoisConnect(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = net.createConnection({ host: "whois.iana.org", port }, () => {
      socket.write(`${host}\r\n`);
    });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("whois timeout"));
    }, timeoutMs);
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("end", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    socket.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Leest `notAfter` van het TLS-certificaat via een eigen `node:tls`-handshake
 * (SNI = host). Hergebruikt de meet-methode uit plan 67; retourneert `null` bij
 * een time-out/fout (de tls-cert-check rapporteert de detail-finding).
 */
export async function measureTlsExpiry(
  host: string,
  port = 443,
): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const socket = tls.connect({
      host,
      port,
      servername: host,
      timeout: TLS_SOCKET_TIMEOUT_MS,
    });

    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // negeren
      }
      resolve(value);
    };

    socket.once("secureConnect", () => {
      const cert = socket.getPeerCertificate() as { valid_to?: string } | null;
      finish(cert?.valid_to ? new Date(cert.valid_to).toISOString() : null);
    });

    socket.once("error", () => finish(null));
    socket.once("timeout", () => finish(null));
  });
}

export type MeasureResult = {
  measurement: DomainMeasurement;
  rdap_ok: boolean;
};

/**
 * Combineert RDAP (+ whois-fallback) + DNS + TLS-expiry tot één meting. Wordt
 * zowel door de catalog-check (http-worker) als de dagelijkse watch (scheduler)
 * aangeroepen — één bron, zodat scan en watch dezelfde domein-status leveren
 * (plan 56, acceptatiecriteria). TLS-expiry wordt hier zelf gemeten via
 * `measureTlsExpiry` (zelfde methode als de tls-cert-check, plan 67).
 */
export async function measureDomain(
  host: string,
  deps: DomainDeps = {},
): Promise<MeasureResult> {
  const apex = registrableDomain(host) ?? host;
  const apexPunycode = toPunycode(apex);

  const [rdap, dnsRecords, tlsIso] = await Promise.all([
    fetchRdapDomain(apexPunycode, deps),
    queryDnsRecords(apexPunycode, deps),
    measureTlsExpiry(host),
  ]);

  let domain_expiry = rdap?.domain_expiry ?? null;
  let rdap_ok = rdap !== null;
  if (!domain_expiry) {
    const whois = await whoisExpiry(apexPunycode, deps);
    if (whois) {
      domain_expiry = whois;
      rdap_ok = true;
    }
  }

  const measurement: DomainMeasurement = {
    domain_expiry,
    domain_registrar: rdap?.domain_registrar ?? null,
    dnssec_enabled: dnsRecords.dnssec_enabled,
    caa_present: dnsRecords.caa_records.length > 0,
    tls_expiry: tlsIso,
    nameservers: dnsRecords.nameservers,
    caa_records: dnsRecords.caa_records,
  };

  return { measurement, rdap_ok };
}

// --- Subdomain-takeover (plan 72, dangling CNAME) ---------------------------

const CRT_SH_TIMEOUT_MS = 12_000;

/**
 * Subdomein-bron (plan 72, besluit 2). Laag 1: hostnames uit de sitemap (de
 * caller levert de reeds opgehaalde sitemap-URL's). Laag 2: Certificate
 * Transparency via crt.sh — `https://crt.sh/?q=%25.<apex>&output=json`. Eén
 * publieke GET met korte timeout; bij falen/time-out retourneert de helper
 * `null` zodat de caller terugvalt op laag 1 (geen crash).
 */
export async function fetchCtSubdomains(
  apexPunycode: string,
  deps: DomainDeps = {},
): Promise<string[] | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  // `%25.` is de URL-encoding van het wildcard-prefix `%.`; de apex zelf wordt
  // ge-encodeerd als defense-in-depth (punycode is normaliter ASCII).
  const url = `https://crt.sh/?q=%25.${encodeURIComponent(apexPunycode)}&output=json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CRT_SH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response.ok) return null;
    const json = (await response.json()) as Parameters<
      typeof extractCtSubdomains
    >[0];
    return extractCtSubdomains(json, apexPunycode);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Enumereert subdomeinen van de apex (plan 72, besluit 2). Combineert laag 1
 * (sitemap-hostnames, door de caller geleverd) en laag 2 (crt.sh). Dedup,
 * apex-only filter (subdomeinen van andere apexen worden genegeerd), en
 * `www`/apex worden niet als kandidaat meegegeven maar wel in de gevonden
 * set opgenomen voor transparantie (vastgelegde keuze). Retourneert de
 * kandidaten om te proberen plus de bronnen die iets hebben opgeleverd en of
 * crt.sh faalde.
 */
/** Resultaat van {@link enumerateSubdomains} (plan 72, besluit 2). */
export type SubdomainEnumeration = {
  /** Kandidaten om te proberen (zonder apex/www). */
  candidates: string[];
  sources: ("sitemap" | "crtsh")[];
  ct_failed: boolean;
};

export async function enumerateSubdomains(
  apexPunycode: string,
  sitemapHosts: string[],
  deps: DomainDeps = {},
): Promise<SubdomainEnumeration> {
  const apexLower = apexPunycode.toLowerCase().replace(/\.+$/, "");
  const fromSitemap = sitemapHosts
    .map((h) => h.toLowerCase().replace(/\.+$/, ""))
    .filter((h) => h.endsWith(`.${apexLower}`));

  const ctResult = await fetchCtSubdomains(apexPunycode, deps);
  const sources: ("sitemap" | "crtsh")[] = [];
  if (fromSitemap.length > 0) sources.push("sitemap");
  let ct_failed = false;
  let fromCt: string[] = [];
  if (ctResult === null) {
    ct_failed = true;
  } else {
    fromCt = ctResult;
    if (fromCt.length > 0) sources.push("crtsh");
  }

  const all = new Set<string>([...fromSitemap, ...fromCt]);
  // Kandidaten om te proberen: alles behalve de apex zelf en www.<apex>
  // (vastgelegde keuze — www/apex zijn vrijwel nooit takeover-kandidaten).
  const candidates = [...all]
    .filter((h) => h !== apexLower && h !== `www.${apexLower}`)
    .sort();
  return { candidates, sources, ct_failed };
}

/**
 * Roept één resolver-methode aan en degradeert elke fout tot een lege lijst.
 * Vangt zowel een afgewezen promise (NXDOMAIN/ENODATA/time-out) als een
 * synchrone throw op — die laatste treedt op wanneer de methode ontbreekt op
 * een (mock-)resolver, waardoor de aanroep anders vóór `.then` zou gooien en
 * uit `probeCnameTakeover` zou ontsnappen.
 */
async function safeResolve(
  fn: ((host: string) => Promise<string[]>) | undefined,
  thisArg: unknown,
  host: string,
): Promise<string[]> {
  if (typeof fn !== "function") return [];
  try {
    return await fn.call(thisArg, host);
  } catch {
    return [];
  }
}

/**
 * Probe één subdomein op dangling CNAME (plan 72, besluit 3). Hergebruikt de
 * swappable `dnsResolver` — `resolveCname`, `resolve4` (A) en `resolve6`
 * (AAAA). Een subdomein zonder CNAME levert `cname_target: null` (niet
 * vatbaar). Een CNAME waarvan het target geen A/AAAA-records heeft (NXDOMAIN)
 * is dangling. Failure-resistent: een falende query levert `false`/`null`
 * (geen crash).
 *
 * `target_resolves` wordt bepaald via zowel A- (`resolve4`) als AAAA-records
 * (`resolve6`): een target met alleen IPv6 (of alleen een AAAA-record) is
 * eigenaar-bezet en dus NIET dangling — puur op `resolve4` afgaan zou dat als
 * `medium` false-positive rapporteren.
 *
 * BEKENDE BEPERKING (DNS-only, passief): dangling wordt op DNS-niveau bepaald
 * (geen A/AAAA voor het target = NXDOMAIN). Dit vangt services die het target
 * laten verdwijnen wanneer de resource weg is (S3, Heroku, Azure). Het MIST de
 * takeover-klasse waarbij het target op DNS-niveau blíjft resolven maar op
 * applicatie-niveau dangelt (GitHub Pages met bestaande user/onbestaand repo,
 * Fastly, CloudFront): daar geven A/AAAA records → `target_resolves: true` →
 * geclassificeerd als `info` (false negative). Een volledige dekking vereist
 * een actieve HTTP-fingerprint van de platform-"no such app/bucket"-respons;
 * die is bewust weggelaten omdat deze check passief is (geen interactie met de
 * doelsite, plan 72).
 */
export async function probeCnameTakeover(
  subdomainPunycode: string,
  deps: DomainDeps = {},
): Promise<TakeoverProbe> {
  const resolver = deps.dnsResolver ?? dns;

  // Elke lookup via `safeResolve`: vangt zowel een rejected promise als een
  // synchrone throw (bv. een resolver-mock zonder `resolve6`) op tot een lege
  // lijst, zodat één falende query nooit uit `probeCnameTakeover` ontsnapt.
  const cnameRecords = await safeResolve(resolver.resolveCname, resolver, subdomainPunycode);
  const cname_target = cnameRecords.length > 0 ? cnameRecords[0] : null;

  const aRecords = await safeResolve(resolver.resolve4, resolver, subdomainPunycode);
  const resolves = aRecords.length > 0;

  let target_resolves = false;
  if (cname_target) {
    const [targetA, targetAaaa] = await Promise.all([
      safeResolve(resolver.resolve4, resolver, cname_target),
      safeResolve(resolver.resolve6, resolver, cname_target),
    ]);
    target_resolves = targetA.length > 0 || targetAaaa.length > 0;
  }

  return {
    subdomain: subdomainPunycode,
    cname_target,
    resolves,
    target_resolves,
  };
}
