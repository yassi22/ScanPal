import { chromium } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import type {
  BrowserRunner,
  BrowserRunResult,
  AxeRunResult,
  ConsoleRunResult,
  ResponsiveRunResult,
  RenderRunResult,
  StorageRunResult,
  ClientDepsRunResult,
  AuthFlowRunResult,
  UploadFlowRunResult,
} from "./runner";
import { parseConsoleMessages, parseRequestFailures, extractServerProbe, parseRenderProbe, CSRF_TOKEN_NAMES, AUTH_RATE_LIMIT_MAX_ATTEMPTS, isSessionCookie, UPLOAD_PROBES, buildProbeBody, makeCanaryToken, outputDiffersFromSource } from "@scanpal/shared";
import type {
  CwvMetrics,
  ConsoleCapture,
  ResponsiveCapture,
  RenderCompareCapture,
  StorageSnapshot,
  RuntimeDepsCapture,
  AuthFlowCapture,
  AuthFormCapture,
  AuthFormKind,
  AuthProbeResponse,
  AuthRateLimitAttempt,
  AuthCredentials,
  AuthSessionCapture,
  AuthSessionCookie,
  UploadFlowCapture,
  UploadFormCapture,
  UploadProbe,
  UploadProbeResult,
} from "@scanpal/shared";
import { hasUnsanitizedTraversalEvidence, isSameOriginUrl } from "./upload-safety";

/**
 * Playwright-default BrowserRunner (feature 41). Lanceert een headless Chromium
 * en vangt LCP/CLS/INP via de `web-vitals`-metrics die PerformanceObserver
 * exposeert. Eén page-load; gemiddelde over meerdere loads kan later.
 *
 * De runner wordt lazy geconstrueerd via `createPlaywrightRunner()`; de check-
 * module importeert alleen de interface, niet de Playwright-afhankelijkheid
 * (dat houden tests schoon).
 */

// ── Plan 77: auth-flow-capture helpers ──────────────────────────────────────

const BODY_TRUNCATE = 2048;
const UPLOAD_WAIT_MS = 8_000;
const MAX_UPLOAD_FORMS = 4;
const COMMON_UPLOAD_PATHS = ["/upload", "/profile", "/settings", "/account"] as const;
const COMMON_AUTH_PATHS: { kind: AuthFormKind; paths: string[] }[] = [
  { kind: "login", paths: ["/login", "/signin", "/sign-in", "/account/login", "/auth/login", "/users/sign_in"] },
  { kind: "signup", paths: ["/signup", "/sign-up", "/register", "/registration", "/account/register", "/auth/signup", "/users/sign_up"] },
  { kind: "reset", paths: ["/reset", "/reset-password", "/forgot-password", "/password-reset", "/forgot", "/account/forgot-password", "/auth/forgot-password", "/users/password/new"] },
];

function truncateBody(body: string): string {
  return body.length > BODY_TRUNCATE ? body.slice(0, BODY_TRUNCATE) + "…" : body;
}

type DiscoveredUploadForm = UploadFormCapture & { form_index: number; form_action: string };

async function installUploadOriginGuard(page: import("playwright").Page, verifiedUrl: string): Promise<void> {
  await page.route("**/*", async (route) => {
    const request = route.request();
    const crossOriginNavigation = request.isNavigationRequest() && !isSameOriginUrl(request.url(), verifiedUrl);
    const crossOriginWrite = request.method() !== "GET" && !isSameOriginUrl(request.url(), verifiedUrl);
    if (crossOriginNavigation || crossOriginWrite) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
}

async function captureUploadForms(
  page: import("playwright").Page,
  url: string,
  behindLogin: boolean,
  verifiedUrl: string,
): Promise<DiscoveredUploadForm[]> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    const actualUrl = page.url();
    if (!isSameOriginUrl(actualUrl, verifiedUrl)) return [];
    const forms = (await page.evaluate(
      `() => Array.from(document.querySelectorAll("form")).map((form, index) => {
        const input = form.querySelector("input[type='file']");
        if (!input) return null;
        return { form_index: index, accept_attribute: input.getAttribute("accept"), form_action: form.action };
      }).filter(Boolean)`,
    )) as { form_index: number; accept_attribute: string | null; form_action: string }[];
    return forms.filter((form) => isSameOriginUrl(form.form_action, verifiedUrl)).map((form) => ({
      url: actualUrl,
      https: actualUrl.startsWith("https://"),
      behind_login: behindLogin,
      accept_attribute: form.accept_attribute,
      form_index: form.form_index,
      form_action: form.form_action,
    }));
  } catch {
    return [];
  }
}

async function discoverUploadForms(
  page: import("playwright").Page,
  baseUrl: string,
  behindLogin: boolean,
): Promise<DiscoveredUploadForm[]> {
  const origin = new URL(baseUrl).origin;
  const candidates = [baseUrl, ...COMMON_UPLOAD_PATHS.map((path) => `${origin}${path}`)];
  const found: DiscoveredUploadForm[] = [];
  for (const candidate of candidates) {
    const forms = await captureUploadForms(page, candidate, behindLogin, baseUrl);
    for (const form of forms) {
      const key = `${form.url}#${form.form_index}`;
      if (!found.some((existing) => `${existing.url}#${existing.form_index}` === key)) found.push(form);
    }
  }
  return found;
}

async function loginForUploadDiscovery(
  page: import("playwright").Page,
  baseUrl: string,
  credentials: AuthCredentials,
): Promise<boolean> {
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
    const urls = await discoverAuthUrls(page, baseUrl);
    const loginUrl = credentials.login_url ?? urls.login;
    if (!loginUrl || !isSameOriginUrl(loginUrl, baseUrl)) return false;
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
    if (!isSameOriginUrl(page.url(), baseUrl)) return false;
    const loginAction = (await page.evaluate(
      `() => { const form = document.querySelector("form:has(input[type='password'])"); return form ? form.action : null; }`,
    )) as string | null;
    if (!loginAction || !isSameOriginUrl(loginAction, baseUrl)) return false;
    const response = await fillAndSubmit(page, [
      { selector: "input[type='email'], input[name*='email' i], input[name*='user' i], input[name*='login' i], input[type='text']", value: credentials.username },
      { selector: "input[type='password']", value: credentials.password },
    ]);
    await page.waitForTimeout(750).catch(() => {});
    return response.status > 0 && response.status < 400 && isSameOriginUrl(page.url(), baseUrl);
  } catch {
    return false;
  }
}

function findStoredUrl(value: unknown, baseUrl: string, filename: string, token: string): string | null {
  const candidates: string[] = [];
  const visit = (item: unknown, depth: number): void => {
    if (depth > 4) return;
    if (typeof item === "string") {
      candidates.push(item);
      for (const match of item.matchAll(/https?:\/\/[^\s"'<>]+|\/[A-Za-z0-9_./%?=&-]+/g)) candidates.push(match[0]);
      return;
    }
    if (Array.isArray(item)) {
      for (const child of item.slice(0, 20)) visit(child, depth + 1);
      return;
    }
    if (item && typeof item === "object") {
      for (const child of Object.values(item).slice(0, 30)) visit(child, depth + 1);
    }
  };
  visit(value, 0);
  for (const candidate of candidates) {
    if (!candidate.includes(filename.replace("../", "")) && !candidate.includes(token)) continue;
    try {
      const parsed = new URL(candidate, baseUrl);
      if (parsed.origin === new URL(baseUrl).origin) return parsed.toString();
    } catch {
      // ignore malformed candidates
    }
  }
  return null;
}

async function uploadProbe(
  page: import("playwright").Page,
  form: DiscoveredUploadForm,
  probe: UploadProbe,
): Promise<{ result: UploadProbeResult; cleaned: boolean; leftover: string | null; error: string | null }> {
  const token = makeCanaryToken();
  const source = buildProbeBody(probe, token);
  let status = 0;
  let accepted = false;
  let storedUrl: string | null = null;
  let retrievedBody = "";
  let retrieved = false;
  let cleaned = false;
  let uploadEvidence = false;
  let traversalEvidence = false;
  let error: string | null = null;
  try {
    await page.goto(form.url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    if (!isSameOriginUrl(page.url(), form.url)) throw new Error("cross-origin redirect vóór upload geweigerd");
    const targetForm = page.locator("form").nth(form.form_index);
    const currentAction = await targetForm.getAttribute("action");
    if (!isSameOriginUrl(currentAction ?? page.url(), form.url)) throw new Error("cross-origin upload-action geweigerd");
    const input = targetForm.locator("input[type='file']").first();
    await input.setInputFiles({ name: probe.filename, mimeType: probe.content_type, buffer: Buffer.from(source) });
    const responsePromise = page
      .waitForResponse((response) => response.request().method() !== "GET", { timeout: UPLOAD_WAIT_MS })
      .catch(() => null);
    const navigationPromise = page.waitForNavigation({ timeout: UPLOAD_WAIT_MS }).catch(() => null);
    const submit = targetForm.locator("button[type='submit'], input[type='submit'], button:not([type])").first();
    if ((await submit.count()) === 0) throw new Error("submit-control niet gevonden");
    await submit.click({ timeout: UPLOAD_WAIT_MS });
    const response = await Promise.race([responsePromise, navigationPromise]);
    status = response?.status() ?? 0;
    if (response) {
      const location = response.headers()["location"];
      if (location) {
        storedUrl = findStoredUrl(location, form.url, probe.filename, token);
        if (probe.id === "upload-path-traversal") {
          traversalEvidence ||= hasUnsanitizedTraversalEvidence(location);
        }
      }
      const responseBody = truncateBody(await response.text().catch(() => ""));
      uploadEvidence ||= responseBody.includes(token) || responseBody.includes(probe.filename.replace("../", ""));
      if (probe.id === "upload-path-traversal") {
        traversalEvidence ||= hasUnsanitizedTraversalEvidence(responseBody);
      }
      if (!storedUrl) {
        try {
          storedUrl = findStoredUrl(JSON.parse(responseBody), form.url, probe.filename, token);
        } catch {
          storedUrl = findStoredUrl(responseBody, form.url, probe.filename, token);
        }
      }
    }
    if (!storedUrl) {
      const domCandidates = (await page.evaluate(
        `() => Array.from(document.querySelectorAll("a[href], img[src], source[src]"))
          .map((el) => el.getAttribute("href") || el.getAttribute("src") || "")`,
      ).catch(() => [])) as string[];
      storedUrl = findStoredUrl(domCandidates, page.url(), probe.filename, token);
      if (probe.id === "upload-path-traversal") {
        traversalEvidence ||= domCandidates.some(hasUnsanitizedTraversalEvidence);
      }
    }
    if (probe.id === "upload-path-traversal" && storedUrl) {
      traversalEvidence ||= hasUnsanitizedTraversalEvidence(storedUrl);
    }
    accepted =
      status >= 200 &&
      status < 400 &&
      (uploadEvidence || storedUrl !== null) &&
      (probe.id !== "upload-path-traversal" || traversalEvidence);
    if (storedUrl) {
      const retrievedResponse = await page.context().request.get(storedUrl, { timeout: UPLOAD_WAIT_MS, maxRedirects: 0 }).catch(() => null);
      if (retrievedResponse && retrievedResponse.ok()) {
        retrieved = true;
        retrievedBody = truncateBody(await retrievedResponse.text().catch(() => ""));
      }
      const deleteControl = page.locator(
        `a[href*="${token}"][href*="delete" i], a[href*="${token}"][href*="remove" i], form[action*="${token}"][action*="delete" i] button, form[action*="${token}"][action*="remove" i] button`,
      ).first();
      if ((await deleteControl.count()) > 0) {
        await deleteControl.click({ timeout: UPLOAD_WAIT_MS }).then(() => { cleaned = true; }).catch(() => {});
      }
    }
  } catch (err) {
    // Een mislukte probe blijft een begrensde observatie; volgende probes lopen door.
    error = err instanceof Error ? err.message : String(err);
  }
  return {
    result: {
      probe_id: probe.id,
      filename: probe.filename,
      content_type: probe.content_type,
      active_type: probe.active_type,
      accepted,
      stored_url: storedUrl,
      retrieved,
      executed: retrieved && outputDiffersFromSource(source, retrievedBody, token),
      retrieved_body: retrievedBody,
      status,
    },
    cleaned,
    leftover: storedUrl && !cleaned ? storedUrl : null,
    error,
  };
}

/**
 * Zichtbare tekst van de pagina (`document.body.innerText`) i.p.v. ruwe HTML.
 * Voorkomt dat verborgen velden — anti-CSRF-tokens, nonces — de body-vergelijking
 * in de user-enumeration-detectie vervuilen. Leeg wanneer niet leesbaar.
 */
async function visibleText(page: import("playwright").Page): Promise<string> {
  try {
    return (await page.evaluate(
      `() => (document.body ? document.body.innerText : "")`,
    )) as string;
  } catch {
    return "";
  }
}

function kindFromHref(href: string): AuthFormKind | null {
  const h = href.toLowerCase();
  if (/(reset|forgot|password-reset|recover)/.test(h)) return "reset";
  if (/(signup|sign-up|register|registration|create.account|join)/.test(h)) return "signup";
  if (/(login|signin|sign-in|auth|account)/.test(h)) return "login";
  return null;
}

async function discoverAuthUrls(page: import("playwright").Page, baseUrl: string): Promise<Partial<Record<AuthFormKind, string>>> {
  const found: Partial<Record<AuthFormKind, string>> = {};
  const origin = new URL(baseUrl).origin;
  try {
    // evaluate-script als string: de worker-tsconfig heeft geen DOM-lib, dus
    // net als de andere runners de browser-code niet tegen Node-types checken.
    const links = (await page.evaluate(
      `() => Array.from(document.querySelectorAll('a[href]')).map((a) => a.href)`,
    )) as string[];
    for (const href of links) {
      const kind = kindFromHref(href);
      if (kind && !found[kind]) {
        try {
          const u = new URL(href, baseUrl);
          if (u.origin === origin) found[kind] = u.toString();
        } catch {
          // ignore malformed
        }
      }
    }
  } catch {
    // ignore
  }
  // Probeer common paden voor ontbrekende kinds.
  for (const { kind, paths } of COMMON_AUTH_PATHS) {
    if (found[kind]) continue;
    for (const path of paths) {
      const candidate = `${origin}${path}`;
      try {
        const res = await page.context().request.get(candidate, { timeout: 8000, maxRedirects: 0 });
        // 200 of redirect naar een auth-pagina telt; 404 niet.
        if (res.status() < 400) {
          found[kind] = candidate;
          break;
        }
        await res.body().catch(() => {});
      } catch {
        // ignore
      }
    }
  }
  return found;
}

function csrfInHtml(formHtml: string): boolean {
  const inputPattern = /<input[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = inputPattern.exec(formHtml))) {
    const name = /name=["']([^"']+)["']/i.exec(match[0])?.[1] ?? "";
    if (CSRF_TOKEN_NAMES.some((n) => name.toLowerCase().includes(n))) return true;
  }
  return false;
}

async function captureFormMeta(
  page: import("playwright").Page,
  url: string,
  kind: AuthFormKind,
): Promise<AuthFormCapture | null> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    const https = page.url().startsWith("https://");
    const formHtml = (await page.evaluate(
      `() => {
        const form = document.querySelector("form");
        if (!form) return null;
        const pw = form.querySelector("input[type='password']");
        if (!pw) return null;
        // SPA/Rails/Laravel/Django zetten het CSRF-token vaak in een <meta>-tag
        // (verstuurd als request-header) i.p.v. een hidden form-input.
        const metaCsrf = !!document.querySelector(
          "meta[name*='csrf' i], meta[name*='xsrf' i], meta[name*='token' i][name*='verif' i]",
        );
        return { html: form.outerHTML.slice(0, 4000), autocomplete: pw.getAttribute("autocomplete"), metaCsrf };
      }`,
    )) as { html: string; autocomplete: string | null; metaCsrf: boolean } | null;
    if (!formHtml) return null;
    return {
      url,
      kind,
      https,
      password_autocomplete: formHtml.autocomplete,
      csrf_token: csrfInHtml(formHtml.html) || formHtml.metaCsrf,
    };
  } catch {
    return null;
  }
}

async function fillAndSubmit(
  page: import("playwright").Page,
  fields: { selector: string; value: string }[],
): Promise<AuthProbeResponse> {
  const start = Date.now();
  try {
    for (const f of fields) {
      const el = await page.$(f.selector);
      if (!el) throw new Error(`veld niet gevonden: ${f.selector}`);
      await el.fill(f.value);
    }
    // Submit + wacht op de eerste van: (a) een klassieke navigatie, of (b) een
    // non-GET-respons (de fetch/XHR-login van een SPA die niet navigeert).
    // De race resolvet zodra één van beide binnen is, zodat een niet-navigerend
    // formulier niet de volle timeout dood-wacht (voorheen 15s × vele probes).
    const WAIT_MS = 8_000;
    const [outcome] = await Promise.all([
      Promise.race<{ status: number } | null>([
        page
          .waitForNavigation({ timeout: WAIT_MS })
          .then((r) => (r ? { status: r.status() } : null))
          .catch(() => null),
        // XHR/SPA-login: lees de status van het auth-POST-antwoord zelf, zodat
        // 429/423 (rate-limit/lockout) en status-gebaseerde user-enumeration ook
        // werken wanneer er geen navigatie plaatsvindt.
        page
          .waitForResponse((r) => r.request().method() !== "GET", { timeout: WAIT_MS })
          .then((r) => ({ status: r.status() }))
          .catch(() => null),
      ]),
      page
        .$("button[type='submit'], input[type='submit'], button:not([type])")
        .then((btn) => btn?.click().catch(() => {})),
    ]);
    // Geen navigatie én geen non-GET-respons → 0 als "onbekend"-sentinel, gelijk
    // aan de catch-tak. Nooit een verzonnen 200, want dat zou als "success"
    // gelezen worden door status-vergelijkingen (user-enumeration) en de
    // 429-lockout-detectie.
    const status = outcome?.status ?? 0;
    const body = truncateBody(await visibleText(page));
    return { status, body, duration_ms: Date.now() - start };
  } catch (err) {
    return { status: 0, body: err instanceof Error ? err.message : String(err), duration_ms: Date.now() - start };
  }
}

/** Aantal reset-samples per adres — mediaan-timing i.p.v. één jitter-gevoelige meting. */
const ENUM_TIMING_SAMPLES = 3;

async function probeReset(
  page: import("playwright").Page,
  resetUrl: string,
  email: string,
): Promise<AuthProbeResponse> {
  const emailSelector = "input[type='email'], input[name*='email' i], input[name*='mail' i], input[id*='email' i]";
  const samples: AuthProbeResponse[] = [];
  for (let i = 0; i < ENUM_TIMING_SAMPLES; i++) {
    try {
      await page.goto(resetUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
    } catch {
      if (samples.length === 0) {
        return { status: 0, body: "reset-pagina niet bereikbaar", duration_ms: 0 };
      }
      break;
    }
    samples.push(await fillAndSubmit(page, [{ selector: emailSelector, value: email }]));
  }
  // Mediane duur over de samples: één uitschieter (GC-pauze, netwerk-jitter)
  // trekt de vergelijking niet meer over de drempel. Status/body van de laatste
  // sample zijn representatief (de flow is deterministisch per adres).
  const durations = samples.map((s) => s.duration_ms).sort((a, b) => a - b);
  const median = durations[Math.floor(durations.length / 2)] ?? 0;
  const last = samples[samples.length - 1]!;
  return { status: last.status, body: last.body, duration_ms: median };
}

async function probeRateLimit(
  page: import("playwright").Page,
  loginUrl: string,
  username: string,
): Promise<AuthRateLimitAttempt[]> {
  const attempts: AuthRateLimitAttempt[] = [];
  for (let i = 0; i < AUTH_RATE_LIMIT_MAX_ATTEMPTS; i++) {
    try {
      await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
    } catch {
      break;
    }
    const userSelector = "input[type='email'], input[name*='email' i], input[name*='user' i], input[name*='login' i], input[type='text']";
    const pwSelector = "input[type='password']";
    const res = await fillAndSubmit(page, [
      { selector: userSelector, value: username },
      { selector: pwSelector, value: `ScanPal-wrong-${i}-${Date.now()}` },
    ]);
    const body = res.body.toLowerCase();
    const locked =
      res.status === 429 ||
      res.status === 423 ||
      /(too many|locked|rate.limit|throttl|attempt.*exceed)/.test(body);
    attempts.push({ status: res.status, body: res.body, locked });
    if (locked) break; // stop zodra rate-limiting/lockout waarneembaar is
  }
  return attempts;
}

async function probePasswordPolicy(
  page: import("playwright").Page,
  url: string,
): Promise<{ accepted: boolean; validation_message: string; measurable: boolean } | null> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    const pw = await page.$("input[type='password']");
    if (!pw) return null;
    await pw.fill("123456");
    // Trigger validatie zonder af te ronden: blur het veld (veel frameworks
    // valideren op blur). Niet op submit klikken → geen account-creatie.
    await pw.evaluate("el => el.blur()").catch(() => {});
    await page.waitForTimeout(500).catch(() => {});
    const result = (await page.evaluate(
      `() => {
        const pw = document.querySelector("input[type='password']");
        if (!pw) return { accepted: true, validation_message: "", measurable: false };
        const valid = pw.validity.valid;
        const msg = pw.validationMessage || "";
        const errEl = document.querySelector("[role='alert'], .error, .invalid-feedback, .field-error");
        const errText = errEl && errEl.textContent ? errEl.textContent.trim().slice(0, 200) : "";
        // Alleen zonder submit is server-side beleid onzichtbaar. We mogen dus
        // enkel oordelen als er een client-side constraint (minlength/pattern)
        // aanwezig is die '123456' toeliet, óf als de site het actief afwees.
        const minLenAttr = pw.getAttribute("minlength");
        const hasConstraint = (minLenAttr !== null && parseInt(minLenAttr, 10) > 0) || pw.hasAttribute("pattern");
        const measurable = hasConstraint || errText.length > 0;
        return { accepted: valid && !errText, validation_message: msg || errText, measurable };
      }`,
    )) as { accepted: boolean; validation_message: string; measurable: boolean };
    return result;
  } catch {
    return null;
  }
}

async function snapshotCookies(ctx: import("playwright").BrowserContext): Promise<{ cookies: AuthSessionCookie[]; sessionId: string | null }> {
  const cookies = await ctx.cookies();
  const mapped: AuthSessionCookie[] = cookies.map((c) => ({
    name: c.name,
    secure: c.secure,
    http_only: c.httpOnly,
    same_site: c.sameSite,
  }));
  // Zelfde sessie-cookie-heuristiek als de check-laag (isSessionCookie): niet
  // dupliceren, zodat CSRF-cookies ook hier niet als sessie-id gelden.
  const session = cookies.find((c) => isSessionCookie(c.name));
  return { cookies: mapped, sessionId: session ? session.value : null };
}

/**
 * Slaagde de login daadwerkelijk? Heuristiek: het login-formulier is weg (geen
 * wachtwoord-veld meer), er staat geen zichtbare foutmelding, én er is een
 * sessie-achtige cookie gezet. Zonder deze poort zou een stil mislukte login
 * (verkeerde selector, SPA-login, MFA-challenge, lockout) toch een "sessie
 * veilig"-pass opleveren op nul geobserveerde cookies.
 */
async function detectLoginSuccess(
  page: import("playwright").Page,
  cookiesAfter: AuthSessionCookie[],
): Promise<boolean> {
  try {
    const dom = (await page.evaluate(
      `() => {
        const hasPassword = !!document.querySelector("input[type='password']");
        const errEl = document.querySelector("[role='alert'], .error, .invalid-feedback, .field-error, [aria-invalid='true']");
        const errText = errEl && errEl.textContent ? errEl.textContent.trim() : "";
        return { hasPassword: hasPassword, hasError: errText.length > 0 };
      }`,
    )) as { hasPassword: boolean; hasError: boolean };
    const hasSessionCookie = cookiesAfter.some((c) => isSessionCookie(c.name));
    return !dom.hasPassword && !dom.hasError && hasSessionCookie;
  } catch {
    return false;
  }
}

async function probeSession(
  page: import("playwright").Page,
  ctx: import("playwright").BrowserContext,
  loginUrl: string,
  credentials: AuthCredentials,
): Promise<AuthSessionCapture | null> {
  try {
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
    const before = await snapshotCookies(ctx);
    const userSelector = "input[type='email'], input[name*='email' i], input[name*='user' i], input[name*='login' i], input[type='text']";
    const pwSelector = "input[type='password']";
    await fillAndSubmit(page, [
      { selector: userSelector, value: credentials.username },
      { selector: pwSelector, value: credentials.password },
    ]);
    await page.waitForTimeout(1500).catch(() => {});
    const after = await snapshotCookies(ctx);
    const loggedIn = await detectLoginSuccess(page, after.cookies);
    return {
      logged_in: loggedIn,
      cookies: after.cookies,
      session_id_before: before.sessionId,
      session_id_after: after.sessionId,
    };
  } catch {
    return null;
  }
}

async function probeMfa(page: import("playwright").Page): Promise<{ available: boolean; enforced: boolean; signal: string }> {
  try {
    const text = ((await page.evaluate(
      `() => document.body ? document.body.innerText : ""`,
    )) as string).toLowerCase();
    const hasMfa = /(mfa|multi.factor|two.factor|2fa|authenticator|totp|passkey|otp|verification code)/.test(text);
    const enforced = /(required.*mfa|mfa.*required|two.factor.*required|must.*enable.*mfa)/.test(text);
    return { available: hasMfa, enforced, signal: hasMfa ? "MFA/2FA-signaal gevonden op de post-login-pagina" : "geen MFA-signaal gevonden" };
  } catch {
    return { available: false, enforced: false, signal: "niet meetbaar" };
  }
}

async function runAuthFlowCapture(url: string, credentials: AuthCredentials): Promise<AuthFlowCapture> {
  const errors: string[] = [];
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // 1) Discovery vanaf de homepage.
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
    } catch (err) {
      errors.push(`homepage niet bereikbaar: ${err instanceof Error ? err.message : String(err)}`);
    }
    const urls = await discoverAuthUrls(page, url);
    const loginUrl = credentials.login_url ?? urls.login ?? undefined;
    const signupUrl = urls.signup ?? undefined;
    const resetUrl = urls.reset ?? undefined;

    // 2) Passieve form-meta per gevonden auth-pagina.
    const forms: AuthFormCapture[] = [];
    for (const [kind, u] of Object.entries(urls) as [AuthFormKind, string][]) {
      const meta = await captureFormMeta(page, u, kind);
      if (meta) forms.push(meta);
    }

    // 3) Reset-probe (user-enumeration): onbestaand vs. eigen wegwerp-mail.
    let resetProbe: AuthFlowCapture["reset_probe"] = null;
    if (resetUrl) {
      const nonexistent = await probeReset(page, resetUrl, `no-such-user-${Date.now()}@example.com`);
      const known = await probeReset(page, resetUrl, credentials.username);
      resetProbe = { nonexistent, known };
    }

    // 4) Session-security: login met het eigen account, cookies voor/na. Draait
    // VÓÓR de rate-limit-burst (stap 6): een correct rate-limitende site zou het
    // wegwerp-account anders al gelockt hebben tegen de tijd dat we inloggen,
    // wat de sessie-observatie zou vervuilen.
    let session: AuthFlowCapture["session"] = null;
    let mfa: AuthFlowCapture["mfa"] = null;
    if (loginUrl) {
      const sessionPage = await ctx.newPage();
      session = await probeSession(sessionPage, ctx, loginUrl, credentials);
      // MFA alleen meten wanneer de login echt slaagde — anders lezen we de
      // login-pagina zelf en zouden we een MFA-signaal verzinnen.
      if (session?.logged_in) {
        mfa = await probeMfa(sessionPage);
      }
      await sessionPage.close().catch(() => {});
    }

    // 5) Password-policy (signup bij voorkeur, anders reset) — geen account-creatie.
    const policyUrl = signupUrl ?? resetUrl ?? null;
    const passwordPolicy = policyUrl ? await probePasswordPolicy(page, policyUrl) : null;

    // 6) Rate-limit-burst als LAATSTE (alleen tegen het eigen wegwerp-account):
    // dit kan het account tijdelijk locken, dus na de sessie-/policy-observaties.
    const rateLimitAttempts: AuthRateLimitAttempt[] = loginUrl
      ? await probeRateLimit(page, loginUrl, credentials.username)
      : [];

    return {
      forms,
      reset_probe: resetProbe,
      rate_limit_attempts: rateLimitAttempts,
      password_policy: passwordPolicy,
      session,
      mfa,
      errors,
    };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return {
      forms: [],
      reset_probe: null,
      rate_limit_attempts: [],
      password_policy: null,
      session: null,
      mfa: null,
      errors,
    };
  } finally {
    await browser?.close().catch(() => {});
  }
}

async function runUploadFlowCapture(
  url: string,
  credentials: AuthCredentials | null,
): Promise<UploadFlowCapture> {
  const errors: string[] = [];
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await installUploadOriginGuard(page, url);

    const publicForms = await discoverUploadForms(page, url, false);
    let protectedForms: DiscoveredUploadForm[] = [];
    if (credentials) {
      const loggedIn = await loginForUploadDiscovery(page, url, credentials);
      if (loggedIn) {
        protectedForms = (await discoverUploadForms(page, url, true)).filter(
          (candidate) => !publicForms.some(
            (publicForm) => publicForm.url === candidate.url && publicForm.form_index === candidate.form_index,
          ),
        );
      } else {
        errors.push("upload-discovery achter login niet mogelijk: login niet bevestigd");
      }
    }

    const discoveredForms = [...publicForms, ...protectedForms].slice(0, MAX_UPLOAD_FORMS);
    const probes: UploadProbeResult[] = [];
    const leftoverFiles: string[] = [];
    let uploadedCanaries = 0;
    let cleanedCanaries = 0;
    for (const form of discoveredForms) {
      for (const probe of UPLOAD_PROBES) {
        const observation = await uploadProbe(page, form, probe);
        probes.push(observation.result);
        if (observation.result.accepted) uploadedCanaries += 1;
        if (observation.cleaned) cleanedCanaries += 1;
        if (observation.leftover) leftoverFiles.push(observation.leftover);
        if (observation.error) errors.push(`${form.url} (${probe.id}): ${observation.error}`);
      }
    }

    return {
      forms: discoveredForms.map(({ form_index: _formIndex, form_action: _formAction, ...form }) => form),
      probes,
      leftover_files: [...new Set(leftoverFiles)],
      cleaned_up: uploadedCanaries > 0 && cleanedCanaries === uploadedCanaries,
      errors,
    };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { forms: [], probes: [], leftover_files: [], cleaned_up: false, errors };
  } finally {
    await browser?.close().catch(() => {});
  }
}

export function createPlaywrightRunner(): BrowserRunner {
  return {
    async captureVitals(url): Promise<BrowserRunResult> {
      let browser;
      try {
        browser = await chromium.launch({ headless: true });
        const ctx = await browser.newContext();
        const page = await ctx.newPage();

        const lcpArr: number[] = [];
        const clsArr: number[] = [];
        let inp: number | null = null;

        await page.exposeFunction("__scanpalPushLcp", (v: number) => lcpArr.push(v));
        await page.exposeFunction("__scanpalPushCls", (v: number) => clsArr.push(v));
        await page.exposeFunction("__scanpalPushInp", (v: number) => {
          if (inp === null || v > inp) inp = v;
        });

        // Init-script als string: het draait in de browser-context (window,
        // PerformanceObserver) en wordt door tsc NIET gecheckt tegen de Node
        // DOM-lib. De push-functies zijn via exposeFunction beschikbaar.
        await page.addInitScript(`
          (function () {
            var w = window;
            // LCP
            new w.PerformanceObserver(function (list) {
              list.getEntries().forEach(function (e) {
                w.__scanpalPushLcp && w.__scanpalPushLcp(e.startTime);
              });
            }).observe({ type: "largest-contentful-paint", buffered: true });
            // CLS
            var cls = 0;
            new w.PerformanceObserver(function (list) {
              list.getEntries().forEach(function (e) {
                if (!e.hadRecentInput) cls += e.value || 0;
              });
              w.__scanpalPushCls && w.__scanpalPushCls(cls);
            }).observe({ type: "layout-shift", buffered: true });
            // INP
            new w.PerformanceObserver(function (list) {
              list.getEntries().forEach(function (e) {
                w.__scanpalPushInp && w.__scanpalPushInp(e.duration || 0);
              });
            }).observe({ type: "event", buffered: true });
          })();
        `);

        await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
        // Geef de observer even tijd om laatste entries te vangen.
        await page.waitForTimeout(2500).catch(() => {});

        const metrics: CwvMetrics = {
          lcp_ms: lcpArr.length > 0 ? Math.round(lcpArr[lcpArr.length - 1]) : null,
          cls: clsArr.length > 0 ? Number(clsArr[clsArr.length - 1].toFixed(4)) : null,
          inp_ms: inp !== null ? Math.round(inp) : null,
        };
        return { ok: true, metrics };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      } finally {
        await browser?.close().catch(() => {});
      }
    },
    async runAxe(url): Promise<AxeRunResult> {
      let browser;
      try {
        browser = await chromium.launch({ headless: true });
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
        const results = await new AxeBuilder({ page }).analyze();
        return { ok: true, violations: results.violations };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      } finally {
        await browser?.close().catch(() => {});
      }
    },
    async captureConsole(url): Promise<ConsoleRunResult> {
      let browser;
      try {
        browser = await chromium.launch({ headless: true });
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        const messages: unknown[] = [];
        const failedRequests: unknown[] = [];

        page.on("console", (msg) => {
          const type = msg.type();
          const text = msg.text();
          const location = msg.location()?.url;
          messages.push({
            type,
            text,
            ...(location ? { location } : {}),
          });
        });
        page.on("pageerror", (err) => {
          messages.push({ type: "error", text: err.message });
        });
        page.on("requestfailed", (req) => {
          failedRequests.push({
            url: req.url(),
            method: req.method(),
            status: null,
            error: req.failure()?.errorText,
          });
        });
        page.on("response", (res) => {
          const status = res.status();
          if (status >= 400) {
            failedRequests.push({
              url: res.url(),
              method: res.request().method(),
              status,
            });
          }
        });

        await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
        await page.waitForTimeout(1500).catch(() => {});

        const capture: ConsoleCapture = {
          messages: parseConsoleMessages(messages.slice(0, 100)),
          failed_requests: parseRequestFailures(failedRequests.slice(0, 50)),
        };
        return { ok: true, capture };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      } finally {
        await browser?.close().catch(() => {});
      }
    },
    async captureResponsive(url): Promise<ResponsiveRunResult> {
      let browser;
      try {
        browser = await chromium.launch({ headless: true });

        async function probeViewport(width: number, height: number) {
          const ctx = await browser!.newContext({ viewport: { width, height } });
          const page = await ctx.newPage();
          await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
          await page.waitForTimeout(1000).catch(() => {});

          const result = await page.evaluate(
            `({ w, h }) => {
              const docEl = document.documentElement;
              const body = document.body;
              const scrollWidth = Math.max(
                docEl.scrollWidth,
                body ? body.scrollWidth : 0,
              );
              const overflowPx = Math.max(0, scrollWidth - w);
              return {
                width: w,
                height: h,
                horizontal_scroll: overflowPx > 0,
                overflow_px: overflowPx,
              };
            }`,
            { w: width, h: height },
          );

          // Tap-target-audit: zoek naar interactieve elementen die kleiner zijn
          // dan 24×24 CSS-pixels (alleen op mobile).
          let tapTargetIssues: { selector: string; width_px: number; height_px: number }[] = [];
          if (width < 500) {
            tapTargetIssues = await page.evaluate(
              `(minPx) => {
                const selector = "a, button, input, select, textarea, [role='button'], [role='link'], [tabindex]";
                const els = Array.from(document.querySelectorAll(selector));
                const issues = [];
                for (const el of els) {
                  const rect = el.getBoundingClientRect();
                  if (rect.width <= 0 || rect.height <= 0) continue;
                  if (rect.width >= minPx && rect.height >= minPx) continue;
                  const id = el.id ? "#" + el.id : "";
                  const cls = el.className && typeof el.className === "string"
                    ? "." + el.className.trim().split(/\\s+/).join(".")
                    : "";
                  const tag = el.tagName.toLowerCase();
                  issues.push({
                    selector: (tag + id + cls).slice(0, 120) || tag,
                    width_px: Math.round(rect.width),
                    height_px: Math.round(rect.height),
                  });
                }
                return issues;
              }`,
              24,
            );
          }

          await ctx.close();
          return { ...result, tap_target_issues: tapTargetIssues };
        }

        const mobile = await probeViewport(375, 667);
        const desktop = await probeViewport(1280, 720);

        const capture: ResponsiveCapture = {
          mobile: {
            width: mobile.width,
            height: mobile.height,
            horizontal_scroll: mobile.horizontal_scroll,
            overflow_px: mobile.overflow_px,
          },
          desktop: {
            width: desktop.width,
            height: desktop.height,
            horizontal_scroll: desktop.horizontal_scroll,
            overflow_px: desktop.overflow_px,
          },
          tap_target_issues: mobile.tap_target_issues,
        };
        return { ok: true, capture };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      } finally {
        await browser?.close().catch(() => {});
      }
    },
    async captureRenderCompare(url): Promise<RenderRunResult> {
      let browser;
      try {
        browser = await chromium.launch({ headless: true });
        const ctx = await browser.newContext();

        // 1) Server-probe: ruwe HTML via de APIRequestContext (geen JS-uitvoering).
        const resp = await ctx.request.get(url, { timeout: 30_000 });
        const html = await resp.text();
        const server = extractServerProbe(html);

        // 2) Gerenderde probe: JS-enabled page-load, metrics uit de live DOM.
        const page = await ctx.newPage();
        await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
        await page.waitForTimeout(1500).catch(() => {});

        const rawRendered = await page.evaluate(
          `() => {
            const visibleText = (document.body ? document.body.innerText : "").trim();
            const headings = document.querySelectorAll("h1,h2,h3,h4,h5,h6").length;
            const title = (document.title || "").trim();
            const metaEl = document.querySelector('meta[name="description"]');
            const meta = metaEl ? (metaEl.getAttribute("content") || "").trim() : "";
            const links = document.querySelectorAll("a[href]").length;
            return {
              text_length: visibleText.length,
              heading_count: headings,
              title: title.length > 0 ? title : null,
              meta_description: meta.length > 0 ? meta : null,
              link_count: links,
            };
          }`,
        );
        const rendered = parseRenderProbe(rawRendered);
        if (!rendered) {
          return { ok: false, error: "Gerenderde DOM-probe onleesbaar" };
        }

        const capture: RenderCompareCapture = { server, rendered };
        return { ok: true, capture };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      } finally {
        await browser?.close().catch(() => {});
      }
    },
    async captureStorage(url): Promise<StorageRunResult> {
      let browser;
      try {
        browser = await chromium.launch({ headless: true });
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
        // Korte wacht zodat SPA's die pas na hydratatie in storage schrijven
        // meetbaar zijn (plan 70, open vraag 1).
        await page.waitForTimeout(1500).catch(() => {});

        const snapshot = (await page.evaluate(
          `() => {
            const read = (store) => {
              const out = {};
              try {
                for (let i = 0; i < store.length; i++) {
                  const k = store.key(i);
                  if (k === null) continue;
                  const v = store.getItem(k);
                  if (v !== null) out[k] = v;
                }
              } catch (e) {}
              return out;
            };
            return {
              local: read(window.localStorage),
              session: read(window.sessionStorage),
            };
          }`,
        )) as StorageSnapshot;
        return { ok: true, snapshot };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      } finally {
        await browser?.close().catch(() => {});
      }
    },
    async captureClientDeps(url): Promise<ClientDepsRunResult> {
      let browser;
      try {
        browser = await chromium.launch({ headless: true });
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
        // Korte wacht zodat SPA's die libs pas na hydratatie injecteren
        // meetbaar zijn.
        await page.waitForTimeout(1500).catch(() => {});

        const capture = (await page.evaluate(
          `() => {
            const g = (v) => (typeof v === "string" && v.length > 0 ? v : null);
            const r = {};
            try { r.jquery = g(window.jQuery && window.jQuery.fn && window.jQuery.fn.jquery); } catch (e) {}
            try { r.react = g(window.React && window.React.version); } catch (e) {}
            try { r.vue = g(window.Vue && window.Vue.version); } catch (e) {}
            try { r.angular = g(window.angular && window.angular.version && window.angular.version.full); } catch (e) {}
            try { r.lodash = g(window._ && window._.VERSION); } catch (e) {}
            try { r.moment = g(window.moment && window.moment.version); } catch (e) {}
            try { r.bootstrap = g(window.bootstrap && window.bootstrap.Tooltip && window.bootstrap.Tooltip.VERSION); } catch (e) {}
            return r;
          }`,
        )) as RuntimeDepsCapture;
        return { ok: true, capture };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      } finally {
        await browser?.close().catch(() => {});
      }
    },
    async captureAuthFlow(url, credentials): Promise<AuthFlowRunResult> {
      try {
        const capture = await runAuthFlowCapture(url, credentials);
        return { ok: true, capture };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    async captureUploadFlow(url, credentials): Promise<UploadFlowRunResult> {
      try {
        const capture = await runUploadFlowCapture(url, credentials);
        return { ok: true, capture };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
