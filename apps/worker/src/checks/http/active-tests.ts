import {
  ACTIVE_TEST_LIMITS,
  CSRF_TOKEN_NAMES,
  DEBUG_ENDPOINTS,
  DEBUG_PAGE_PATTERN,
  IDOR_PROBE_IDS,
  INPUT_VALIDATION_PAYLOADS,
  OPEN_REDIRECT_PAYLOADS,
  REDIRECT_PARAM_NAMES,
  SQL_ERROR_PATTERN,
  SQLI_PAYLOADS,
  STACK_TRACE_PATTERN,
  XSS_PAYLOADS,
  truncateEvidence,
  type FindingEvidence,
  type InlineCheckLike,
} from "@scanpal/shared";
import type { CheckImplementation, CheckContext } from "../types";
import { fetchPage, redirectChainOf } from "../types";
import type { RateLimiter } from "../../rate-limit";

type ActiveTestOutput = InlineCheckLike & {
  active: true;
  evidence: FindingEvidence | null;
};

const RATE_LIMIT_WINDOW = 60;
const RATE_LIMIT_KEY_PREFIX = "active-test";

async function probeGet(
  rateLimit: RateLimiter,
  url: string,
  host: string,
): Promise<{ status: number; body: string; location: string | null } | null> {
  const rate = await rateLimit(
    `${RATE_LIMIT_KEY_PREFIX}:${host}`,
    ACTIVE_TEST_LIMITS.probesPerHostPerMinute,
    RATE_LIMIT_WINDOW,
  );
  if (!rate.ok) return null;

  try {
    // Via fetchPage: SSRF-guard (private/loopback targets geweigerd, ook per
    // redirect-hop) + byte-cap. De gevolgde redirect-ketting blijft leesbaar
    // via `redirectChainOf` voor de open-redirect-detectie.
    const res = await fetchPage(url, { timeoutMs: ACTIVE_TEST_LIMITS.timeoutMs });
    const body = await res.text().catch(() => "");
    const chain = redirectChainOf(res);
    return {
      status: res.status,
      body,
      location: chain.length > 0 ? chain[0] : null,
    };
  } catch {
    return null;
  }
}

/**
 * Plan 73 — rate-limit burst-probe (G7). Eén burst-request met dezelfde per-host
 * rate-limit als {@link probeGet}, maar retourneert ook de headers die de burst
 * nodig heeft (`retry-after`, `x-ratelimit-remaining`). Sequentieel aangeroepen
 * (6×) om 429/rate-limit-gedrag te observeren. `null` = eigen rate-limiter
 * uitgeput of fetch-fout (de burst degradeert naar info).
 */
async function probeBurstRequest(
  rateLimit: RateLimiter,
  url: string,
  host: string,
): Promise<{
  status: number;
  retryAfter: string | null;
  remaining: string | null;
} | null> {
  const rate = await rateLimit(
    `${RATE_LIMIT_KEY_PREFIX}:${host}`,
    ACTIVE_TEST_LIMITS.probesPerHostPerMinute,
    RATE_LIMIT_WINDOW,
  );
  if (!rate.ok) return null;
  try {
    const res = await fetchPage(url, { timeoutMs: ACTIVE_TEST_LIMITS.timeoutMs });
    await res.body?.cancel().catch(() => {});
    return {
      status: res.status,
      retryAfter: res.headers.get("retry-after"),
      remaining:
        res.headers.get("x-ratelimit-remaining") ??
        res.headers.get("ratelimit-remaining"),
    };
  } catch {
    return null;
  }
}

/** Plan 73 — begrensde burst-grootte (6 snelle sequentiële GET's op de scan-URL). */
const RATE_LIMIT_BURST_COUNT = 6;

function evidenceOf(request: string, response: string): FindingEvidence {
  return {
    request: truncateEvidence(request),
    response: truncateEvidence(response),
  };
}

function collectQueryParams(url: string, html: string): string[] {
  const params = new Set<string>();
  try {
    for (const key of new URL(url).searchParams.keys()) params.add(key);
  } catch {
    // ignore malformed URL
  }
  const linkPattern = /(?:href|src)="([^"]+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(html))) {
    try {
      const parsed = new URL(match[1], url);
      if (parsed.hostname === new URL(url).hostname) {
        for (const key of parsed.searchParams.keys()) {
          if (params.size < 20) params.add(key);
        }
      }
    } catch {
      // ignore malformed links
    }
  }
  return [...params].slice(0, ACTIVE_TEST_LIMITS.maxProbes);
}

function collectRedirectParams(url: string, html: string): string[] {
  const present = new Set<string>();
  try {
    for (const key of new URL(url).searchParams.keys()) {
      if (REDIRECT_PARAM_NAMES.includes(key.toLowerCase())) present.add(key);
    }
  } catch {
    // ignore
  }
  const linkPattern = /(?:href|src)="([^"]+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(html))) {
    try {
      const parsed = new URL(match[1], url);
      for (const [key, value] of parsed.searchParams) {
        if (REDIRECT_PARAM_NAMES.includes(key.toLowerCase()) && value) {
          present.add(key);
        }
      }
    } catch {
      // ignore
    }
  }
  return [...present];
}

function collectIdorCandidates(url: string, html: string): string[] {
  const seen = new Set<string>();
  const add = (u: string) => {
    try {
      const m = u.match(/(\/[a-z0-9._-]+\/(\d+))(?:\?|$)/i);
      if (m) seen.add(m[1]);
    } catch {
      // ignore
    }
  };
  add(url);
  const linkPattern = /(?:href|src)="([^"]+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(html))) add(match[1]);
  return [...seen].slice(0, ACTIVE_TEST_LIMITS.maxProbes);
}

function csrfTokenPresent(formHtml: string): boolean {
  const inputPattern = /<input[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = inputPattern.exec(formHtml))) {
    const name = /name=["']([^"']+)["']/i.exec(match[0])?.[1] ?? "";
    if (CSRF_TOKEN_NAMES.some((n) => name.toLowerCase().includes(n))) return true;
  }
  return false;
}

/**
 * Actieve vulnerability-tests (plan 52), port naar de http-worker (plan 27):
 * kleine curated, niet-destructieve payload-set, alleen GET/HEAD-probes op
 * bestaande endpoints/parameters. Per host Redis rate-limiting + timeout.
 * Uitvoer wordt apart getoond en telt niet mee in de score (`active: true`).
 */
export function createActiveTestsCheck(
  rateLimit: RateLimiter,
): CheckImplementation {
  return {
    id: "active-tests",
    category: "http",
    async run(ctx: CheckContext): Promise<InlineCheckLike[]> {
      if (!ctx.activeTests) return [];

      let html = "";
      let headers: Headers | null = null;
      try {
        const page = await fetch(ctx.url, {
          redirect: "follow",
          headers: { "User-Agent": "ScanPal/0.1 (+https://scanpal.dev)" },
        });
        headers = page.headers;
        if ((page.headers.get("content-type") ?? "").includes("text/html")) {
          html = await page.text();
        }
      } catch {
        return [
          {
            id: "active-tests",
            name: "Actieve vulnerability-tests",
            status: "info",
            detail: "Actieve tests overgeslagen: pagina niet bereikbaar.",
            active: true,
            evidence: null,
          },
        ];
      }

      const results: ActiveTestOutput[] = [];
      const host = new URL(ctx.url).hostname;
      const probe = (url: string) => probeGet(rateLimit, url, host);
      const push = (result: ActiveTestOutput) => results.push(result);

      // ── 1. debug-endpoints (passief): curated paden, GET-only ────────────
      let debugFound = false;
      for (const path of DEBUG_ENDPOINTS) {
        const p = await probe(`${ctx.url}${path}`);
        if (!p) continue;
        if (p.status !== 404 && DEBUG_PAGE_PATTERN.test(p.body)) {
          debugFound = true;
          push({
            id: "debug-endpoints",
            name: "Debug/admin-endpoints detectie",
            status: "warn",
            detail: `Debug-achtige response gevonden op ${path} (HTTP ${p.status}).`,
            active: true,
            evidence: evidenceOf(`GET ${ctx.url}${path}`, `HTTP ${p.status}\n${p.body}`),
          });
          break;
        }
      }
      if (!debugFound) {
        push({
          id: "debug-endpoints",
          name: "Debug/admin-endpoints detectie",
          status: "pass",
          detail: "Geen debug/admin-endpoints gedetecteerd op de curated pad-lijst.",
          active: true,
          evidence: null,
        });
      }

      // ── 2. jwt-audit (passief): tokens in headers/HTML, zwakke alg ───────
      const jwtPattern = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
      const tokenSource = [
        headers?.get("authorization") ?? "",
        headers?.get("set-cookie") ?? "",
        html,
      ].join("\n");
      const tokens = tokenSource.match(jwtPattern) ?? [];
      const weakAlg = tokens.find((token) => {
        try {
          const header = JSON.parse(
            Buffer.from(
              token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"),
              "base64",
            ).toString("utf8"),
          );
          return header.alg === "none" || header.alg === "HS256";
        } catch {
          return false;
        }
      });
      if (weakAlg) {
        push({
          id: "jwt-audit",
          name: "JWT-zwakke-algoritme/key-audit",
          status: "warn",
          detail: `JWT met zwak algoritme gedetecteerd (${weakAlg.slice(0, 30)}…).`,
          active: true,
          evidence: evidenceOf("JWT-audit (passief)", `Token: ${weakAlg.slice(0, 200)}`),
        });
      } else if (tokens.length > 0) {
        push({
          id: "jwt-audit",
          name: "JWT-zwakke-algoritme/key-audit",
          status: "pass",
          detail: `${tokens.length} JWT-token(s) gevonden; geen zwak algoritme (none/HS256) aangetroffen.`,
          active: true,
          evidence: null,
        });
      } else {
        push({
          id: "jwt-audit",
          name: "JWT-zwakke-algoritme/key-audit",
          status: "info",
          detail: "Geen JWT-tokens gevonden in headers of HTML.",
          active: true,
          evidence: null,
        });
      }

      // ── 3. webhook-signature (passief): webhook-endpoints in HTML ────────
      const webhookPattern = /(?:href|action)="([^"]*(?:webhook|hooks?)[^"]*)"/gi;
      const webhookUrls: string[] = [];
      let whMatch: RegExpExecArray | null;
      while ((whMatch = webhookPattern.exec(html))) webhookUrls.push(whMatch[1]);
      if (webhookUrls.length > 0) {
        push({
          id: "webhook-signature",
          name: "Webhook-handlers zonder signature-verificatie",
          status: "info",
          detail: `${webhookUrls.length} webhook-endpoint(s) gevonden in de HTML. Controleer of deze een handtekening-verificatie (HMAC) vereisen.`,
          active: true,
          evidence: evidenceOf(
            "Webhook-signature (passief)",
            webhookUrls.slice(0, 3).join("\n"),
          ),
        });
      } else {
        push({
          id: "webhook-signature",
          name: "Webhook-handlers zonder signature-verificatie",
          status: "pass",
          detail: "Geen webhook-endpoints gevonden in de pagina-HTML.",
          active: true,
          evidence: null,
        });
      }

      // ── 4. csrf-check (passief): formulieren zonder token ────────────────
      const formPattern = /<form[^>]*>[\s\S]*?<\/form>/gi;
      const forms: { html: string; action: string }[] = [];
      let formMatch: RegExpExecArray | null;
      while ((formMatch = formPattern.exec(html))) {
        const action =
          /action=["']([^"']*)["']/i.exec(formMatch[0])?.[1] ?? "onbekend";
        forms.push({ html: formMatch[0], action });
      }
      const formsWithoutToken = forms.filter((f) => !csrfTokenPresent(f.html));
      if (forms.length === 0) {
        push({
          id: "csrf-check",
          name: "CSRF-token-aanwezigheid",
          status: "info",
          detail: "Geen formulieren gevonden in de pagina-HTML.",
          active: true,
          evidence: null,
        });
      } else if (formsWithoutToken.length > 0) {
        push({
          id: "csrf-check",
          name: "CSRF-token-aanwezigheid",
          status: "warn",
          detail: `${formsWithoutToken.length}/${forms.length} formulier(en) zonder CSRF-token-veld (bijv. actie "${formsWithoutToken[0].action}").`,
          active: true,
          evidence: evidenceOf(
            "CSRF-check (passief)",
            `Formulier zonder token: ${formsWithoutToken[0].html.slice(0, 400)}`,
          ),
        });
      } else {
        push({
          id: "csrf-check",
          name: "CSRF-token-aanwezigheid",
          status: "pass",
          detail: `Alle ${forms.length} formulieren bevatten een CSRF-token-veld.`,
          active: true,
          evidence: null,
        });
      }

      // ── 5. sqli-probe (actief): GET-payloads op bestaande parameters ─────
      const params = collectQueryParams(ctx.url, html);
      const sqliHits: string[] = [];
      for (const param of params) {
        if (sqliHits.length >= 3) break;
        for (const payload of SQLI_PAYLOADS.slice(0, ACTIVE_TEST_LIMITS.maxPayloadsPerTest)) {
          const target = new URL(ctx.url);
          target.searchParams.set(param, payload);
          const p = await probe(target.toString());
          if (p && SQL_ERROR_PATTERN.test(p.body)) {
            sqliHits.push(`${param}="${payload}"`);
            push({
              id: "sqli-probe",
              name: "SQL-injection probe",
              status: "warn",
              detail: `SQL-foutpatroon gedetecteerd bij parameter "${param}" met payload "${payload}".`,
              active: true,
              evidence: evidenceOf(`GET ${target.toString()}`, `HTTP ${p.status}\n${p.body}`),
            });
            break;
          }
        }
      }
      if (sqliHits.length === 0) {
        push({
          id: "sqli-probe",
          name: "SQL-injection probe",
          status: params.length > 0 ? "pass" : "info",
          detail:
            params.length > 0
              ? "Geen SQL-foutpatronen bij de geteste query-parameters."
              : "Geen query-parameters gevonden om te testen.",
          active: true,
          evidence: null,
        });
      }

      // ── 6. xss-probe (actief): reflected payload via GET-parameters ──────
      const xssHits: string[] = [];
      for (const param of params) {
        if (xssHits.length >= 3) break;
        for (const payload of XSS_PAYLOADS.slice(0, ACTIVE_TEST_LIMITS.maxPayloadsPerTest)) {
          const target = new URL(ctx.url);
          target.searchParams.set(param, payload);
          const p = await probe(target.toString());
          if (p && p.body.includes(payload)) {
            xssHits.push(`${param}="${payload.slice(0, 25)}"`);
            push({
              id: "xss-probe",
              name: "Reflected XSS probe",
              status: "warn",
              detail: `Reflected payload gedetecteerd bij parameter "${param}".`,
              active: true,
              evidence: evidenceOf(
                `GET ${target.toString()}`,
                `HTTP ${p.status}\n${p.body.slice(0, 400)}`,
              ),
            });
            break;
          }
        }
      }
      if (xssHits.length === 0) {
        push({
          id: "xss-probe",
          name: "Reflected XSS probe",
          status: params.length > 0 ? "pass" : "info",
          detail:
            params.length > 0
              ? "Geen reflected XSS-payloads gedetecteerd in responses."
              : "Geen query-parameters gevonden om te testen.",
          active: true,
          evidence: null,
        });
      }

      // ── 7. open-redirect-probe (actief): redirect-parameters ─────────────
      const redirectParams = collectRedirectParams(ctx.url, html);
      const redirectHits: string[] = [];
      for (const param of redirectParams) {
        if (redirectHits.length >= 3) break;
        for (const payload of OPEN_REDIRECT_PAYLOADS.slice(0, ACTIVE_TEST_LIMITS.maxPayloadsPerTest)) {
          const target = new URL(ctx.url);
          target.searchParams.set(param, payload);
          const p = await probe(target.toString());
          if (!p) continue;
          const redirectsExternal =
            p.status >= 300 &&
            p.status < 400 &&
            p.location !== null &&
            !p.location.includes(new URL(ctx.url).hostname);
          const reflectsPayload = p.body.includes(payload);
          if (redirectsExternal || reflectsPayload) {
            redirectHits.push(`${param}="${payload}"`);
            push({
              id: "open-redirect-probe",
              name: "Open redirect probe",
              status: "warn",
              detail: `Open-redirect-signaal bij parameter "${param}" (${redirectsExternal ? "externe redirect" : "payload gereflecteerd"}).`,
              active: true,
              evidence: evidenceOf(
                `GET ${target.toString()}`,
                `HTTP ${p.status}\nLocation: ${p.location ?? "—"}\n${p.body.slice(0, 300)}`,
              ),
            });
            break;
          }
        }
      }
      if (redirectHits.length === 0) {
        push({
          id: "open-redirect-probe",
          name: "Open redirect probe",
          status: redirectParams.length > 0 ? "pass" : "info",
          detail:
            redirectParams.length > 0
              ? "Geen open-redirect-signalen bij redirect-parameters."
              : "Geen redirect-parameters gevonden om te testen.",
          active: true,
          evidence: null,
        });
      }

      // ── 8. idor-probe (actief): publieke sequentiële id's ────────────────
      const idorCandidates = collectIdorCandidates(ctx.url, html);
      const idorHits: string[] = [];
      for (const candidate of idorCandidates) {
        if (idorHits.length >= 2) break;
        const base = `${new URL(candidate, ctx.url).origin}${candidate.replace(/\/\d+(?=\/|$)/, "")}`;
        const baseline = await probe(`${base}/${IDOR_PROBE_IDS[0]}`);
        if (!baseline) continue;
        for (const probeId of IDOR_PROBE_IDS.slice(1)) {
          const p = await probe(`${base}/${probeId}`);
          if (!p) continue;
          const distinctContent =
            p.status === baseline.status &&
            p.body.trim() !== baseline.body.trim() &&
            p.status !== 404;
          if (distinctContent) {
            idorHits.push(`${base}/${probeId}`);
            push({
              id: "idor-probe",
              name: "IDOR / sequentiële id-probe",
              status: "info",
              detail: `Sequentieel id ${probeId} levert andere content op (HTTP ${p.status}) zonder zichtbare auth — mogelijke IDOR, handmatig verifiëren.`,
              active: true,
              evidence: evidenceOf(
                `GET ${base}/${probeId}`,
                `HTTP ${p.status}\n${p.body.slice(0, 300)}`,
              ),
            });
            break;
          }
        }
      }
      if (idorHits.length === 0) {
        push({
          id: "idor-probe",
          name: "IDOR / sequentiële id-probe",
          status: idorCandidates.length > 0 ? "pass" : "info",
          detail:
            idorCandidates.length > 0
              ? "Geen afwijkende content bij opeenvolgende numerieke id's."
              : "Geen numerieke id-segmenten gevonden om te testen.",
          active: true,
          evidence: null,
        });
      }

      // ── 9. input-validation (actief): overlange/invalide invoer ──────────
      const validationHits: string[] = [];
      for (const param of params) {
        if (validationHits.length >= 3) break;
        for (const payload of INPUT_VALIDATION_PAYLOADS.slice(0, ACTIVE_TEST_LIMITS.maxPayloadsPerTest)) {
          const target = new URL(ctx.url);
          target.searchParams.set(param, payload);
          const p = await probe(target.toString());
          if (p && (p.status >= 500 || STACK_TRACE_PATTERN.test(p.body))) {
            validationHits.push(param);
            push({
              id: "input-validation",
              name: "Input validation probe",
              status: "warn",
              detail: `Parameter "${param}" leidt tot ${p.status >= 500 ? `HTTP ${p.status}` : "een stack-trace/exception"} bij onverwachte invoer.`,
              active: true,
              evidence: evidenceOf(`GET ${target.toString()}`, `HTTP ${p.status}\n${p.body.slice(0, 300)}`),
            });
            break;
          }
        }
      }
      if (validationHits.length === 0) {
        push({
          id: "input-validation",
          name: "Input validation probe",
          status: params.length > 0 ? "pass" : "info",
          detail:
            params.length > 0
              ? "Geen 5xx- of stack-trace-reacties op overlange/invalide invoer."
              : "Geen query-parameters gevonden om te testen.",
          active: true,
          evidence: null,
        });
      }

      // ── 10. graphql-introspection (actief): __schema-detectie ────────────
      const gqlPaths = ["/graphql", "/api/graphql"];
      let gqlFound = false;
      for (const path of gqlPaths) {
        const target = new URL(ctx.url);
        target.pathname = `${target.pathname.replace(/\/+$/, "")}${path}`;
        target.searchParams.set("query", "{__schema{types{name}}}");
        const p = await probe(target.toString());
        if (p && p.body.includes("__schema")) {
          gqlFound = true;
          push({
            id: "graphql-introspection",
            name: "GraphQL introspection",
            status: "warn",
            detail: `GraphQL-introspection-reactie gevonden op ${path} (__schema zichtbaar).`,
            active: true,
            evidence: evidenceOf(`GET ${target.toString()}`, `HTTP ${p.status}\n${p.body.slice(0, 300)}`),
          });
          break;
        }
      }
      if (!gqlFound) {
        push({
          id: "graphql-introspection",
          name: "GraphQL introspection",
          status: "info",
          detail: "Geen GraphQL-introspection-reactie gevonden op de common endpoints.",
          active: true,
          evidence: null,
        });
      }

      // ── 11. tenant-isolation (actief): vereist 2 actoren/credentials ─────
      push({
        id: "tenant-isolation",
        name: "Cross-tenant leestoegang",
        status: "info",
        detail:
          "Overgeslagen: tenant-isolation vereist test-accounts/credentials van twee actoren (niet ingesteld voor deze site).",
        active: true,
        evidence: null,
      });

      // ── 12. rate-limit-burst (actief, plan 73/G7): 6 snelle sequentiële ──
      //    GET's op de scan-URL om 429/rate-limit-gedrag te observeren. Geen
      //    load-generatie tegen API-endpoints van derden — alleen de scan-URL.
      const burstResults: ({
        status: number;
        retryAfter: string | null;
        remaining: string | null;
      } | null)[] = [];
      for (let i = 0; i < RATE_LIMIT_BURST_COUNT; i++) {
        burstResults.push(await probeBurstRequest(rateLimit, ctx.url, host));
      }
      const valid = burstResults.filter(
        (r): r is { status: number; retryAfter: string | null; remaining: string | null } =>
          r !== null,
      );
      const got429 = valid.some((r) => r.status === 429);
      const gotRetryAfter = valid.some((r) => r.retryAfter !== null);
      const remainingHitZero = valid.some((r) => r.remaining === "0");
      const rateLimited = got429 || gotRetryAfter || remainingHitZero;
      if (valid.length < RATE_LIMIT_BURST_COUNT / 2) {
        push({
          id: "rate-limit-burst",
          name: "Rate-limit burst-probe",
          status: "info",
          detail:
            "Burst onvolledig (eigen rate-limiter uitgeput of fetch-fouten) — rate-limit-gedrag niet betrouwbaar vastgesteld.",
          active: true,
          evidence: null,
        });
      } else if (rateLimited) {
        const signals: string[] = [];
        if (got429) signals.push("429");
        if (gotRetryAfter) signals.push("retry-after");
        if (remainingHitZero) signals.push("remaining=0");
        push({
          id: "rate-limit-burst",
          name: "Rate-limit burst-probe",
          status: "pass",
          detail: `Rate-limiting trad in onder de burst (${signals.join(", ")}).`,
          active: true,
          evidence: evidenceOf(
            `Burst ${RATE_LIMIT_BURST_COUNT}× GET ${ctx.url}`,
            burstResults
              .map((r, i) => `#${i + 1}: ${r ? `HTTP ${r.status}` : "blocked/error"}`)
              .join("\n"),
          ),
        });
      } else {
        push({
          id: "rate-limit-burst",
          name: "Rate-limit burst-probe",
          status: "warn",
          detail: `Geen rate-limiting waargenomen onder ${valid.length}/${RATE_LIMIT_BURST_COUNT} snelle requests (geen 429, geen retry-after, geen remaining=0).`,
          active: true,
          evidence: evidenceOf(
            `Burst ${RATE_LIMIT_BURST_COUNT}× GET ${ctx.url}`,
            burstResults
              .map((r, i) => `#${i + 1}: ${r ? `HTTP ${r.status}` : "blocked/error"}`)
              .join("\n"),
          ),
        });
      }

      return results;
    },
  };
}