import tls from "node:tls";
import { checkById, type InlineCheckLike } from "@scanpal/shared";
import type { CheckImplementation } from "../types";

const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_PER_HOST_PER_MINUTE = 10;
const SOCKET_TIMEOUT_MS = 10_000;
/** notAfter ≤ dit aantal dagen in de toekomst → warn (plan 67, besluit 3). */
const EXPIRY_WARN_DAYS = 30;

export type TlsCertInput = {
  /** `socket.getPeerCertificate()`-resultaat (onderdeel voor unit-tests). */
  cert: PeerCert | null;
  /** Canonical hostnaam (SNI / hostname-match). */
  host: string;
  now?: Date;
  /**
   * Feature 31 — Node's ketting-validatie (`socket.authorized`). `undefined`
   * (default) wordt als `true` behandeld (backward-compat met pure tests).
   * Alleen `false` triggert de chain-validation warn.
   */
  authorized?: boolean;
  /** `socket.authorizationError` — reden waarom de ketting niet vertrouwd is. */
  authorizationError?: string;
  /** ALPN-protocol (`socket.alpnProtocol`): `"h2"` = HTTP/2, `"http/1.1"`, … */
  alpnProtocol?: string | null;
  /** TLS-protocolversie (`socket.getCipher().version`), bijv. `"TLSv1.3"`. */
  protocolVersion?: string;
};

/**
 * Gelezen uit `socket.getPeerCertificate()`. Alleen de velden die deze check
 * nodig heeft; `valid_from`/`valid_to` zijn strings (RFC-uitschrijving of
 * Unix-timestamp als string, zoals Node ze levert).
 */
export type PeerCert = {
  subject?: { CN?: string } | null;
  issuer?: { CN?: string } | null;
  subjectaltname?: string;
  valid_from?: string;
  valid_to?: string;
  fingerprint?: string;
};

export type PeerCertLookup = () => PeerCert | null;

/**
 * Pure evaluatie van een TLS-certificaat (plan 67, detectie-tabel). Onafhankelijk
 * van netwerk → unit-testbaar. `evidence` is een `|`-gescheiden string met
 * `notBefore|notAfter|issuer|subject|san` zodat plan 56 (Domain Watchtower) de
 * `notAfter` kan hergebruiken zonder de ketting te inspecteren.
 */
export function evaluateTlsCert({
  cert,
  host,
  now = new Date(),
  authorized = true,
  authorizationError,
  alpnProtocol = null,
  protocolVersion,
}: TlsCertInput): InlineCheckLike {
  const name = checkById("tls-cert")?.name ?? "TLS/SSL-certificaat";
  const id = "tls-cert";
  const supportsH2 = alpnProtocol === "h2";

  if (!cert) {
    return {
      id,
      name,
      status: "fail",
      detail: "TLS-handshake leverde geen certificaat op.",
      evidence: evidenceString(null),
    };
  }

  const notBefore = parseCertDate(cert.valid_from);
  const notAfter = parseCertDate(cert.valid_to);
  const subjectCn = cert.subject?.CN ?? "?";
  const issuerCn = cert.issuer?.CN ?? "?";
  const san = cert.subjectaltname ?? "";
  const evidence = evidenceString({
    notBefore: cert.valid_from ?? "",
    notAfter: cert.valid_to ?? "",
    issuer: issuerCn,
    subject: subjectCn,
    san,
    alpn: alpnProtocol ?? "",
    tls: protocolVersion ?? "",
    authorized,
  });

  if (!notBefore || !notAfter) {
    return {
      id,
      name,
      status: "fail",
      detail: `Certificaat heeft geen geldige geldigheidsdata (valid_from=${cert.valid_from ?? "?"}, valid_to=${cert.valid_to ?? "?"}).`,
      evidence,
    };
  }

  if (notBefore > now) {
    return {
      id,
      name,
      status: "fail",
      detail: `TLS-certificaat is nog niet geldig (geldig vanaf ${notBefore.toISOString()}). CN=${subjectCn}, uitgegeven door ${issuerCn}.`,
      evidence,
    };
  }

  if (notAfter < now) {
    return {
      id,
      name,
      status: "fail",
      detail: `TLS-certificaat is verlopen op ${notAfter.toISOString()}. CN=${subjectCn}, uitgegeven door ${issuerCn}.`,
      evidence,
    };
  }

  const hostMatches = hostnameMatches(host, subjectCn, san);
  if (!hostMatches) {
    return {
      id,
      name,
      status: "fail",
      detail: `TLS-certificaat dekt de hostnaam "${host}" niet (CN=${subjectCn}, SAN=${san || "—"}).`,
      evidence,
    };
  }

  const selfSigned =
    issuerCn === subjectCn ||
    (!!cert.fingerprint && cert.fingerprint === (cert as { fingerprint256?: string }).fingerprint256);

  const daysLeft = Math.floor((notAfter.getTime() - now.getTime()) / 86_400_000);
  if (daysLeft <= EXPIRY_WARN_DAYS) {
    return {
      id,
      name,
      status: "warn",
      detail: `TLS-certificaat verloopt binnen ${daysLeft} d (op ${notAfter.toISOString()}). CN=${subjectCn}, uitgegeven door ${issuerCn}.`,
      evidence,
    };
  }

  if (selfSigned) {
    return {
      id,
      name,
      status: "warn",
      detail: `TLS-certificaat is self-signed (issuer == subject: ${issuerCn}). CN=${subjectCn}, verloopt ${notAfter.toISOString()}.${http2Detail(supportsH2)}`,
      evidence,
    };
  }

  // Feature 31 — ketting-validatie: Node vertrouwt de ketting niet (ontbrekende
  // intermediate, untrusted CA, …). Treedt alleen op als de specifiekere checks
  // (self-signed, expiry, hostname) de cert niet al hebben verklaard.
  if (authorized === false) {
    const reason = authorizationError ? ` (${authorizationError})` : "";
    return {
      id,
      name,
      status: "warn",
      detail: `TLS-certificaatketting wordt niet vertrouwd door de CA-store${reason}. CN=${subjectCn}, uitgegeven door ${issuerCn}, verloopt ${notAfter.toISOString()}.${http2Detail(supportsH2)}`,
      evidence,
    };
  }

  return {
    id,
    name,
    status: "pass",
    detail: `CN=${subjectCn}, verloopt ${notAfter.toISOString()} (${daysLeft} d), uitgegeven door ${issuerCn}.${http2Detail(supportsH2)}`,
    evidence,
  };
}

/** Feature 31 — HTTP/2-suffix voor de detail-regel (alleen tonen als bekend). */
function http2Detail(supportsH2: boolean): string {
  return supportsH2 ? " HTTP/2 ondersteund (ALPN h2)." : "";
}

type TlsEvidence = {
  notBefore: string;
  notAfter: string;
  issuer: string;
  subject: string;
  san: string;
  /** Feature 31 — ALPN-protocol (h2 = HTTP/2). */
  alpn: string;
  /** Feature 31 — TLS-protocolversie (TLSv1.3, …). */
  tls: string;
  /** Feature 31 — ketting vertrouwd door Node's CA-store. */
  authorized: boolean;
};

function evidenceString(evidence: TlsEvidence | null): string {
  if (!evidence) return "notBefore=—|notAfter=—|issuer=—|subject=—|san=—|alpn=—|tls=—|authorized=—";
  return `notBefore=${evidence.notBefore || "—"}|notAfter=${evidence.notAfter || "—"}|issuer=${evidence.issuer}|subject=${evidence.subject}|san=${evidence.san || "—"}|alpn=${evidence.alpn || "—"}|tls=${evidence.tls || "—"}|authorized=${evidence.authorized}`;
}

/**
 * Node levert `valid_from`/`valid_to` als RFC-822/UTC-uitschrijving of als een
 * Unix-timestamp-string. Beide parseren via `new Date(...)`; ongeldig → null.
 */
function parseCertDate(value: string | undefined): Date | null {
  if (!value) return null;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && /^[0-9]+$/.test(value.trim())) {
    return new Date(asNumber * 1000);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Hostnaam-match tegen CN + SAN. Ondersteunt wildcard-links (`*.example.com`).
 * Houdt het bewust eenvoudig (geen Public Suffix-aware matching); voor IP-hosts
 * wordt letterlijke gelijkheid geëist.
 */
function hostnameMatches(host: string, cn: string, san: string): boolean {
  const hostLower = host.toLowerCase();
  const names: string[] = [];
  if (cn && cn !== "?") names.push(cn);
  if (san) {
    for (const part of san.split(",")) {
      const trimmed = part.trim();
      const match = /^DNS:(.+)$/i.exec(trimmed);
      if (match) names.push(match[1]);
    }
  }
  return names.some((name) => wildcardMatch(hostLower, name.toLowerCase()));
}

function wildcardMatch(host: string, pattern: string): boolean {
  if (host === pattern) return true;
  if (pattern.startsWith("*.")) {
    const tail = pattern.slice(2);
    // wildcard matcht precies één label-links: `*.example.com` → `foo.example.com`
    const dotIndex = host.indexOf(".");
    return dotIndex > 0 && host.slice(dotIndex + 1) === tail;
  }
  return false;
}

export const tlsCertCheck: CheckImplementation = {
  id: "tls-cert",
  category: "http",
  async run(ctx) {
    const name = checkById("tls-cert")?.name ?? "TLS/SSL-certificaat";
    let parsed: URL;
    try {
      parsed = new URL(ctx.url);
    } catch {
      return [
        {
          id: "tls-cert",
          name,
          status: "info",
          detail: `TLS niet controleerbaar: ongeldige URL (${ctx.url}).`,
        },
      ];
    }

    if (parsed.protocol !== "https:") {
      return [
        {
          id: "tls-cert",
          name,
          status: "info",
          detail: "TLS niet van toepassing: site is HTTP.",
        },
      ];
    }

    const host = parsed.hostname;
    const port = parsed.port ? Number(parsed.port) : 443;

    const rate = await ctx.rateLimit(
      `tls-cert:${host}`,
      RATE_LIMIT_PER_HOST_PER_MINUTE,
      RATE_LIMIT_WINDOW_SECONDS,
    );
    if (!rate.ok) {
      return [
        {
          id: "tls-cert",
          name,
          status: "info",
          detail: `TLS niet controleerbaar: rate-limit (probeer opnieuw over ${rate.retryAfterSeconds}s).`,
        },
      ];
    }

    return new Promise<InlineCheckLike[]>((resolve) => {
      const socket = tls.connect({
        host,
        port,
        servername: host,
        timeout: SOCKET_TIMEOUT_MS,
        // Feature 31 — rejectUnauthorized:false zodat secureConnect altijd
        // doorgaat en we socket.authorized + alpnProtocol kunnen uitlezen
        // (ketting-validatie + HTTP/2-detectie). Non-invasive: we lezen alleen
        // het certificaat, versturen geen data.
        rejectUnauthorized: false,
        ALPNProtocols: ["h2", "http/1.1"],
      });

      const finish = (result: InlineCheckLike) => {
        try {
          socket.destroy();
        } catch {
          // socket al gesloten — negeren
        }
        resolve([result]);
      };

      socket.once("secureConnect", () => {
        const cert = socket.getPeerCertificate() as PeerCert | null;
        const authorized = (socket as { authorized?: boolean }).authorized ?? true;
        const authError = (socket as { authorizationError?: Error | string }).authorizationError;
        const authorizationError =
          authError instanceof Error ? authError.message : authError;
        const alpnProtocol = (socket as { alpnProtocol?: string | null }).alpnProtocol ?? null;
        let protocolVersion: string | undefined;
        try {
          protocolVersion = (socket.getCipher() as { version?: string } | null)?.version;
        } catch {
          // getCipher() kan null geven na destruct — negeren
        }
        resolve([
          evaluateTlsCert({
            cert,
            host,
            authorized,
            authorizationError,
            alpnProtocol,
            protocolVersion,
          }),
        ]);
        try {
          socket.destroy();
        } catch {
          // negeren
        }
      });

      socket.once("error", (err) => {
        const message = err instanceof Error ? err.message : String(err);
        finish({
          id: "tls-cert",
          name,
          status: "fail",
          detail: `TLS-handshake mislukt: ${message}`,
          evidence: evidenceString(null),
        });
      });

      socket.once("timeout", () => {
        finish({
          id: "tls-cert",
          name,
          status: "fail",
          detail: `TLS niet controleerbaar: time-out na ${SOCKET_TIMEOUT_MS} ms.`,
          evidence: evidenceString(null),
        });
      });
    });
  },
};
