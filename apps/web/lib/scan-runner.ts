import "server-only";

export type InlineCheckResult = {
  id: string;
  name: string;
  status: "pass" | "fail" | "warn";
  detail: string;
};

const SECURITY_HEADERS: Record<string, string> = {
  "strict-transport-security": "HSTS",
  "content-security-policy": "CSP",
  "x-content-type-options": "X-Content-Type-Options",
  "x-frame-options": "X-Frame-Options",
  "referrer-policy": "Referrer-Policy",
};

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

async function runInlineProbe(rawUrl: string): Promise<{
  findings: Record<string, unknown>;
  score: number;
}> {
  const url = normalizeUrl(rawUrl);

  let controller: AbortController | undefined;
  try {
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 10000);
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "ScanPal/0.1 (+https://scanpal.dev)" },
    });
    clearTimeout(timeout);

    const checks: InlineCheckResult[] = [];

    if (response.ok) {
      checks.push({
        id: "reachability",
        name: "Reachability",
        status: "pass",
        detail: `${response.status} ${response.statusText} — site is bereikbaar`,
      });
    } else {
      checks.push({
        id: "reachability",
        name: "Reachability",
        status: "warn",
        detail: `HTTP ${response.status} ${response.statusText} — site reageert maar geeft een foutstatus`,
      });
    }

    const urlIsHttps = url.startsWith("https://");
    if (urlIsHttps) {
      checks.push({
        id: "https",
        name: "HTTPS",
        status: "pass",
        detail: "Verbinding verloopt over HTTPS",
      });
    } else {
      const finalUrl = response.url ?? url;
      if (finalUrl.startsWith("https://")) {
        checks.push({
          id: "https",
          name: "HTTPS",
          status: "pass",
          detail: "HTTP redirect naar HTTPS gevonden",
        });
      } else {
        checks.push({
          id: "https",
          name: "HTTPS",
          status: "fail",
          detail: "Site is niet bereikbaar over HTTPS",
        });
      }
    }

    const missing: string[] = [];
    for (const [header, label] of Object.entries(SECURITY_HEADERS)) {
      if (!response.headers.has(header)) missing.push(label);
    }
    if (missing.length === 0) {
      checks.push({
        id: "security-headers",
        name: "Security headers",
        status: "pass",
        detail: "Alle kern security headers aanwezig",
      });
    } else {
      checks.push({
        id: "security-headers",
        name: "Security headers",
        status: "warn",
        detail: `Ontbrekend: ${missing.join(", ")}`,
      });
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/html")) {
      const html = await response.text();
      const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
      checks.push({
        id: "html",
        name: "HTML pagina",
        status: title ? "pass" : "warn",
        detail: title
          ? `Pagina gevonden met titel "${title.slice(0, 80)}"`
          : "Pagina is HTML maar heeft geen <title> tag",
      });
    } else {
      checks.push({
        id: "html",
        name: "HTML pagina",
        status: "warn",
        detail: `Geen HTML-pagina (${contentType || "onbekend content-type"})`,
      });
    }

    const passed = checks.filter((c) => c.status === "pass").length;
    const score = Math.round((passed / checks.length) * 100);

    return { findings: { checks }, score };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Onbekende fout";
    const checks: InlineCheckResult[] = [
      {
        id: "reachability",
        name: "Reachability",
        status: "fail",
        detail: `Kon de site niet bereiken: ${message}`,
      },
    ];
    return { findings: { checks }, score: 0 };
  } finally {
    controller?.abort();
  }
}

export { normalizeUrl, runInlineProbe };
