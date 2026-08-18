import {
  checkById,
  parseConsoleMessages,
  parseRequestFailures,
  consoleEvidence,
  consoleOverallStatus,
  type ConsoleEvidence,
} from "@scanpal/shared";
import type { CheckImplementation } from "../types";
import type { BrowserRunner } from "./runner";

/**
 * Feature 44 — Console-errors + network-failures (category aeo, homepage-only).
 * Draait één Playwright-load en vangt `page.on('console')` en
 * `page.on('requestfailed')`/`response`-events via de injectable BrowserRunner.
 * Status: fail bij console-error of failed-request, warn bij warnings, anders pass.
 */
export function createConsoleErrorsCheck(runner: BrowserRunner): CheckImplementation {
  return {
    id: "console-errors",
    category: "aeo",
    async run(ctx) {
      const name = checkById("console-errors")?.name ?? "Console-errors & network-failures";

      const rate = await ctx.rateLimit(`console:${new URL(ctx.url).hostname}`, 5, 60);
      if (!rate.ok) {
        return [
          {
            id: "console-errors",
            name,
            status: "warn",
            detail: "Rate-limit bereikt — console-capture niet uitgevoerd",
          },
        ];
      }

      const res = await runner.captureConsole(ctx.url);
      if (!res.ok) {
        return [
          {
            id: "console-errors",
            name,
            status: "warn",
            detail: `Console-capture mislukt: ${res.error}`,
          },
        ];
      }

      // Runner retourneert reeds geparseerde capture, maar parse opnieuw ter
      // verdediging tegen een onverwachte runner-implementatie (schema-mock).
      const capture = {
        messages: parseConsoleMessages(res.capture.messages),
        failed_requests: parseRequestFailures(res.capture.failed_requests),
      };
      const status = consoleOverallStatus(capture);
      const evidence: ConsoleEvidence = consoleEvidence(capture);
      const by = evidence.by_type;

      const detail =
        capture.messages.length === 0 && capture.failed_requests.length === 0
          ? "Geen console-messages of failed-requests gevonden."
          : `${capture.messages.length} message(s) ` +
            `(error=${by.error}, warning=${by.warning}), ` +
            `${capture.failed_requests.length} failed request(s).`;

      return [
        {
          id: "console-errors",
          name,
          status,
          detail,
          evidence,
        },
      ];
    },
  };
}
