import { z } from "zod";

/**
 * Plan 37 — security.txt (RFC 9116), favicon, 404-page kwaliteit. De worker
 * doet de fetches (/.well-known/security.txt, /favicon.ico, /<random>-404);
 * deze pure helpers parsen en evalueren. Eén check-id `security-txt`.
 */

export const securityTxtEvidenceSchema = z.object({
  kind: z.literal("security-txt"),
  security_txt: z.object({
    present: z.boolean(),
    contact: z.string().nullable(),
    expires: z.string().nullable(),
    expired: z.boolean(),
    preferred: z.string().nullable(),
    canonical: z.string().nullable(),
    encryption: z.string().nullable(),
    missing_required: z.array(z.string()),
  }),
  favicon: z.object({
    present: z.boolean(),
    status: z.number().int(),
  }),
  not_found_page: z.object({
    status: z.number().int(),
    is_404: z.boolean(),
    has_h1: z.boolean(),
    has_search: z.boolean(),
    has_home_link: z.boolean(),
    looks_custom: z.boolean(),
  }),
});
export type SecurityTxtEvidence = z.infer<typeof securityTxtEvidenceSchema>;

export type SecurityTxtFields = {
  present: boolean;
  contact: string | null;
  expires: string | null;
  expired: boolean;
  preferred: string | null;
  canonical: string | null;
  encryption: string | null;
  missingRequired: string[];
};

export function parseSecurityTxt(text: string | null): SecurityTxtFields {
  const fields: SecurityTxtFields = {
    present: Boolean(text && text.trim()),
    contact: null,
    expires: null,
    expired: false,
    preferred: null,
    canonical: null,
    encryption: null,
    missingRequired: [],
  };
  if (text) {
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim().toLowerCase();
      const value = line.slice(idx + 1).trim();
      if (!value) continue;
      switch (key) {
        case "contact":
          fields.contact = value.slice(0, 300);
          break;
        case "expires":
          fields.expires = value.slice(0, 100);
          break;
        case "preferred-languages":
          fields.preferred = value.slice(0, 100);
          break;
        case "canonical":
          fields.canonical = value.slice(0, 300);
          break;
        case "encryption":
          fields.encryption = value.slice(0, 300);
          break;
      }
    }
  }
  if (!fields.contact) fields.missingRequired.push("Contact");
  if (!fields.expires) {
    fields.missingRequired.push("Expires");
  } else {
    const expiry = new Date(fields.expires);
    if (Number.isNaN(expiry.getTime())) {
      fields.missingRequired.push("Expires (ongeldig formaat)");
    } else if (expiry.getTime() < Date.now()) {
      fields.expired = true;
    }
  }
  return fields;
}

export type NotFoundPageAnalysis = {
  status: number;
  is404: boolean;
  hasH1: boolean;
  hasSearch: boolean;
  hasHomeLink: boolean;
  looksCustom: boolean;
};

export function analyzeNotFoundPage(html: string, status: number): NotFoundPageAnalysis {
  const lower = html.toLowerCase();
  const hasH1 = /<h1[^>]*>/.test(html);
  const hasSearch = /<input[^>]+type\s*=\s*["']search["']/i.test(html) || /<form[^>]+role\s*=\s*["']search["']/i.test(html);
  const hasHomeLink = /href\s*=\s*["'][^"']*["'][^>]*>.*?(home|terug naar begin|homepage)/i.test(lower) || /href\s*=\s*["']\/["']/i.test(html);
  return {
    status,
    is404: status === 404,
    hasH1,
    hasSearch,
    hasHomeLink,
    looksCustom: hasH1 || hasSearch || hasHomeLink,
  };
}

export function securityTxtEvidence(
  securityTxt: SecurityTxtFields,
  favicon: { present: boolean; status: number },
  notFoundPage: NotFoundPageAnalysis,
): SecurityTxtEvidence {
  return {
    kind: "security-txt",
    security_txt: {
      present: securityTxt.present,
      contact: securityTxt.contact,
      expires: securityTxt.expires,
      expired: securityTxt.expired,
      preferred: securityTxt.preferred,
      canonical: securityTxt.canonical,
      encryption: securityTxt.encryption,
      missing_required: securityTxt.missingRequired,
    },
    favicon,
    not_found_page: {
      status: notFoundPage.status,
      is_404: notFoundPage.is404,
      has_h1: notFoundPage.hasH1,
      has_search: notFoundPage.hasSearch,
      has_home_link: notFoundPage.hasHomeLink,
      looks_custom: notFoundPage.looksCustom,
    },
  };
}

export function evaluateSecurityTxt(
  securityTxt: SecurityTxtFields,
  favicon: { present: boolean; status: number },
  notFoundPage: NotFoundPageAnalysis,
): { status: "pass" | "warn" | "fail" | "info"; detail: string } {
  const issues: string[] = [];
  if (!securityTxt.present) {
    issues.push("geen security.txt");
  } else {
    issues.push(...securityTxt.missingRequired.map((f) => `security.txt mist ${f}`));
    if (securityTxt.expired) issues.push("security.txt Expires is verlopen");
  }
  if (!favicon.present) {
    issues.push("geen favicon");
  }
  if (!notFoundPage.is404) {
    issues.push(`404-URL geeft status ${notFoundPage.status} (geen echte 404)`);
  } else if (!notFoundPage.looksCustom) {
    issues.push("404-pagina is niet custom (server default)");
  }

  if (issues.length === 0) {
    return {
      status: "pass",
      detail: "security.txt aanwezig + geldig, favicon gevonden, custom 404-pagina",
    };
  }
  const hasFail = issues.some(
    (i) =>
      i.includes("mist Contact") ||
      i.includes("mist Expires") ||
      i.includes("verlopen") ||
      i === "geen security.txt",
  );
  return {
    status: hasFail ? "fail" : "warn",
    detail: issues.join("; "),
  };
}
