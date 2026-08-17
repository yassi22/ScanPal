import type { CheckImplementation } from "../types";
import { fetchPage } from "../types";

export const reachabilityCheck: CheckImplementation = {
  id: "reachability",
  category: "http",
  async run(ctx) {
    try {
      const response = await fetchPage(ctx.url, { timeoutMs: 10000 });
      if (response.ok) {
        return [
          {
            id: "reachability",
            name: "Reachability",
            status: "pass",
            detail: `${response.status} ${response.statusText} — site is bereikbaar`,
          },
        ];
      }
      return [
        {
          id: "reachability",
          name: "Reachability",
          status: "warn",
          detail: `HTTP ${response.status} ${response.statusText} — site reageert maar geeft een foutstatus`,
        },
      ];
    } catch (err) {
      const message = err instanceof Error ? err.message : "Onbekende fout";
      return [
        {
          id: "reachability",
          name: "Reachability",
          status: "fail",
          detail: `Kon de site niet bereiken: ${message}`,
        },
      ];
    }
  },
};