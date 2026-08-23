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
} from "./runner";
import { parseConsoleMessages, parseRequestFailures, extractServerProbe, parseRenderProbe } from "@scanpal/shared";
import type {
  CwvMetrics,
  ConsoleCapture,
  ResponsiveCapture,
  RenderCompareCapture,
  StorageSnapshot,
  RuntimeDepsCapture,
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
  };
}
