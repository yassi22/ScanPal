import { chromium } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import type { BrowserRunner, BrowserRunResult, AxeRunResult } from "./runner";
import type { CwvMetrics } from "@scanpal/shared";

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
  };
}
