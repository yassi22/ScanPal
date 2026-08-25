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
} from "./runner";
import { parseConsoleMessages, parseRequestFailures, extractServerProbe, parseRenderProbe, CSRF_TOKEN_NAMES, AUTH_RATE_LIMIT_MAX_ATTEMPTS, isSessionCookie } from "@scanpal/shared";
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
} from "@scanpal/shared";

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
const COMMON_AUTH_PATHS: { kind: AuthFormKind; paths: string[] }[] = [
  { kind: "login", paths: ["/login", "/signin", "/sign-in", "/account/login", "/auth/login", "/users/sign_in"] },
  { kind: "signup", paths: ["/signup", "/sign-up", "/register", "/registration", "/account/register", "/auth/signup", "/users/sign_up"] },
  { kind: "reset", paths: ["/reset", "/reset-password", "/forgot-password", "/password-reset", "/forgot", "/account/forgot-password", "/auth/forgot-password", "/users/password/new"] },
];

function truncateBody(body: string): string {
  return body.length > BODY_TRUNCATE ? body.slice(0, BODY_TRUNCATE) + "…" : body;
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
        return { html: form.outerHTML.slice(0, 4000), autocomplete: pw.getAttribute("autocomplete") };
      }`,
    )) as { html: string; autocomplete: string | null } | null;
    if (!formHtml) return null;
    return {
      url,
      kind,
      https,
      password_autocomplete: formHtml.autocomplete,
      csrf_token: csrfInHtml(formHtml.html),
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
    // Submit + wacht op navigatie/response.
    const [navRes] = await Promise.all([
      page.waitForNavigation({ timeout: 15_000 }).catch(() => null),
      page
        .$("button[type='submit'], input[type='submit'], button:not([type])")
        .then((btn) => btn?.click().catch(() => {})),
    ]);
    // Geen navigatie-status (XHR/SPA-login die niet navigeert) → 0 als enige
    // "onbekend"-sentinel, gelijk aan de catch-tak. Nooit een verzonnen 200,
    // want dat zou als "success" gelezen worden door status-vergelijkingen
    // (user-enumeration) en de 429-lockout-detectie.
    const status = navRes?.status() ?? 0;
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
): Promise<{ accepted: boolean; validation_message: string } | null> {
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
        if (!pw) return { accepted: true, validation_message: "" };
        const valid = pw.validity.valid;
        const msg = pw.validationMessage || "";
        const errEl = document.querySelector("[role='alert'], .error, .invalid-feedback, .field-error");
        const errText = errEl && errEl.textContent ? errEl.textContent.trim().slice(0, 200) : "";
        return { accepted: valid && !errText, validation_message: msg || errText };
      }`,
    )) as { accepted: boolean; validation_message: string };
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
  };
}
