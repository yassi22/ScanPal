import { z } from "zod";
import { scanCategorySchema, type ScanCategory } from "./scan-progress";

export const checkCatalogEntrySchema = z.object({
  id: z.string(),
  category: scanCategorySchema,
  name: z.string(),
  /** Actieve-test-check (plan 52): loopt alleen met `active_tests: true` + Pro. */
  active: z.boolean().default(false),
});
export type CheckCatalogEntry = z.infer<typeof checkCatalogEntrySchema>;

export const categoryLabels: Record<ScanCategory, string> = {
  http: "HTTP & beveiliging",
  seo: "SEO & content",
  aeo: "AEO & browser",
  github: "GitHub & repo",
  compliance: "Compliance & privacy",
};

export const scanCategories: ScanCategory[] = ["http", "seo", "aeo", "github", "compliance"];

export const checkCatalog: CheckCatalogEntry[] = [
  { id: "reachability", category: "http", name: "Reachability", active: false },
  { id: "https", category: "http", name: "HTTPS", active: false },
  { id: "security-header-csp", category: "http", name: "Content-Security-Policy (CSP)", active: false },
  { id: "security-header-hsts", category: "http", name: "HSTS (Strict-Transport-Security)", active: false },
  { id: "security-header-xcto", category: "http", name: "X-Content-Type-Options", active: false },
  { id: "security-header-xfo", category: "http", name: "X-Frame-Options", active: false },
  { id: "security-header-referrer-policy", category: "http", name: "Referrer-Policy", active: false },
  { id: "security-header-permissions-policy", category: "http", name: "Permissions-Policy", active: false },
  { id: "security-header-coop", category: "http", name: "Cross-Origin-Opener-Policy (COOP)", active: false },
  { id: "security-header-coep", category: "http", name: "Cross-Origin-Embedder-Policy (COEP)", active: false },
  { id: "cookie-httponly", category: "http", name: "Cookie HttpOnly", active: false },
  { id: "cookie-secure", category: "http", name: "Cookie Secure", active: false },
  { id: "cookie-samesite", category: "http", name: "Cookie SameSite", active: false },
  { id: "cookie-prefixes", category: "http", name: "Cookie prefix (__Host-/__Secure-)", active: false },
  { id: "cookie-expiry", category: "http", name: "Cookie expiry (Expires/Max-Age)", active: false },
  { id: "cors", category: "http", name: "CORS-configuratie", active: false },
  { id: "tls-cert", category: "http", name: "TLS/SSL-certificaat", active: false },
  // Plan 56: Domain watchtower — registreer-expiry, DNSSEC, CAA, NS-drift,
  // TLS-runway (hergebruikt notAfter uit tls-cert). Stille check behalve bij
  // afwijking (expiry/runway/dnssec/ns-drift).
  { id: "domain-watchtower", category: "http", name: "Domain watchtower", active: false },
  // Plan 68: DNS & e-mail (SPF/DKIM/DMARC/MX) — passieve publieke-DNS-meting,
  // draait in de http-worker naast domain-watchtower. Geen active-gating.
  { id: "dns-email", category: "http", name: "DNS & e-mail (SPF/DKIM/DMARC)", active: false },
  { id: "redirects-mixed", category: "http", name: "Redirects & mixed content", active: false },
  { id: "secrets-in-html", category: "http", name: "Secrets in HTML", active: false },
  { id: "secrets-in-bundles", category: "http", name: "Secrets in JS-bundles", active: false },
  { id: "subresources", category: "http", name: "Subresource-integriteit", active: false },
  { id: "meta-tags", category: "seo", name: "Meta & OG-tags", active: false },
  { id: "robots-sitemap", category: "seo", name: "robots.txt & sitemap", active: false },
  { id: "security-txt", category: "seo", name: "security.txt, favicon, 404", active: false },
  { id: "mini-crawl", category: "seo", name: "Interne links & broken links", active: false },
  { id: "structured-data", category: "seo", name: "Structured data (JSON-LD)", active: false },
  // Plan 40: stackdetectie herkent CMS/framework/server/CDN uit headers +
  // HTML (Server, X-Powered-By, generator-meta, framework-markers).
  { id: "stack-detection", category: "seo", name: "Stackdetectie (CMS/framework)", active: false },
  // Plan 69: hosting-fingerprint & platform-security — herkent Vercel/Netlify/
  // Cloudflare/… uit response-headers en beoordeelt platform-specifieke
  // signalen (cache-hygiëne, origin-lek, preview-URL). Passief; hergebruikt de
  // bestaande fetch; geen dubbele header-findings met check 28.
  { id: "hosting-security", category: "http", name: "Hosting-fingerprint & platform-security", active: false },
  // Plan 55: AEO per-engine matrix draait in de http-worker (geen browser nodig)
  // — als eerste aeo-entry geplaatst zodat de progress-kaart de juiste check
  // markeert (enige aeo-check die vandaag draait).
  { id: "aeo-engine-matrix", category: "aeo", name: "AEO engine-matrix & llms.txt", active: false },
  { id: "core-web-vitals", category: "aeo", name: "Core Web Vitals", active: false },
  // Plan 62: CrUX field data (real-user CWV) — draait in de http-worker
  // (pure REST-call, geen browser); categorie aeo (subcheck van de
  // performance-groep). Geen data → info-finding, geen score-straf.
  { id: "crux-field-data", category: "aeo", name: "CrUX field data (real-user CWV)", active: false },
  { id: "accessibility", category: "aeo", name: "Accessibility (axe-core)", active: false },
  { id: "aeo-scan", category: "aeo", name: "AEO-content & LLM-parsability", active: false },
  // Feature 44: console-errors + network-failures via Playwright (aeo).
  { id: "console-errors", category: "aeo", name: "Console-errors & network-failures", active: false },
  // Feature 45: mobile/responsive basis-check (horizontal overflow + tap-targets).
  { id: "mobile-responsive", category: "aeo", name: "Mobile / responsive", active: false },
  // Plan 70: browser storage & session-tokens — leest localStorage/sessionStorage
  // na page-load (passief, geen interactie). Categorie aeo (browser-queue).
  { id: "browser-storage", category: "aeo", name: "Browser storage & session-tokens", active: false },
  { id: "semgrep", category: "github", name: "Semgrep (SAST)", active: false },
  { id: "gitleaks", category: "github", name: "Gitleaks (secrets)", active: false },
  { id: "osv-scanner", category: "github", name: "OSV-Scanner (deps)", active: false },
  // Plan 71: client-side dependencies & CVE — herkent JS-libs + versies uit
  // script-URL's (CDN-patronen) en matcht ze tegen OSV. Werkt op URL-only sites
  // (geen repo nodig) en vult zo het gat dat osv-scanner laat vallen. Passief.
  { id: "client-deps-cve", category: "http", name: "Client-side dependencies & CVE", active: false },
  // Plan 71 v2: runtime-deps via window-globals (browser-queue). Hardere
  // versiebewijzen dan de statische URL-parsing van client-deps-cve; vangt ook
  // libs zonder versie in de CDN-URL. Passief; eigen check-id (geen collision).
  { id: "client-deps-runtime", category: "aeo", name: "Client-side dependencies (runtime)", active: false },
  { id: "repo-health", category: "github", name: "Repo-health", active: false },
  // Plan 61: compliance-pijler — passieve checks (cookie-banner/CMP-detectie,
  // consent-API, privacy-policy, legal-pagina's, GDPR-signalen). Geen cookies
  // plaatsen, geen interactie met de banner; bevindingen zijn observaties.
  { id: "cookie-banner", category: "compliance", name: "Cookie-banner / CMP-detectie", active: false },
  { id: "consent-api", category: "compliance", name: "Consent-API", active: false },
  { id: "privacy-policy", category: "compliance", name: "Privacy-policy", active: false },
  { id: "legal-pages", category: "compliance", name: "Legal-pagina's", active: false },
  { id: "gdpr-signals", category: "compliance", name: "GDPR-signalen", active: false },
  { id: "sqli-probe", category: "http", name: "SQL-injection probe", active: true },
  { id: "xss-probe", category: "http", name: "Reflected XSS probe", active: true },
  { id: "csrf-check", category: "http", name: "CSRF-token-aanwezigheid", active: true },
  { id: "open-redirect-probe", category: "http", name: "Open redirect probe", active: true },
  { id: "idor-probe", category: "http", name: "IDOR / sequentiële id-probe", active: true },
  { id: "input-validation", category: "http", name: "Input validation probe", active: true },
  { id: "debug-endpoints", category: "http", name: "Debug/admin-endpoints detectie", active: true },
  { id: "graphql-introspection", category: "http", name: "GraphQL introspection", active: true },
  { id: "jwt-audit", category: "http", name: "JWT-zwakke-algoritme/key-audit", active: true },
  { id: "webhook-signature", category: "http", name: "Webhook-handlers zonder signature-verificatie", active: true },
  { id: "tenant-isolation", category: "http", name: "Cross-tenant leestoegang", active: true },
];

export function checksForCategory(category: ScanCategory): CheckCatalogEntry[] {
  return checkCatalog.filter((entry) => entry.category === category);
}

export function checkById(id: string): CheckCatalogEntry | undefined {
  return checkCatalog.find((entry) => entry.id === id);
}

/**
 * Queue-owner per categorie (plan 27, besluit 8): de http-worker draait de
 * http+seo-categorie, de browser-worker aeo, de github-worker github. De
 * dispatcher gebruikt deze helper om het progress-skelet te vullen; features
 * 28–49 vullen de catalog per queue verder in.
 */
export const queueSchema = z.enum(["http", "browser", "github"]);
export type QueueName = z.infer<typeof queueSchema>;

export const queueCategories: Record<QueueName, ScanCategory[]> = {
  // Plan 61: compliance-checks draaien passief in de http-worker (HTML/DOM-
  // analyse, geen cookies) → categorie-compliance hoort bij de http-queue.
  http: ["http", "seo", "compliance"],
  browser: ["aeo"],
  github: ["github"],
};

export function checksForQueue(queue: QueueName): CheckCatalogEntry[] {
  return checkCatalog.filter((entry) =>
    queueCategories[queue].includes(entry.category),
  );
}

/** Check-ids per queue, in catalogus-volgorde (workers). */
export function checkIdsForQueue(queue: QueueName): string[] {
  return checksForQueue(queue).map((entry) => entry.id);
}
