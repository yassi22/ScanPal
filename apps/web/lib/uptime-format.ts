import type { SiteStatus } from "@scanpal/shared";

export const STATUS_LABELS: Record<SiteStatus, string> = {
  up: "Online",
  down: "Offline",
  unknown: "Onbekend",
};

export function statusLabel(state: SiteStatus): string {
  return STATUS_LABELS[state];
}

export function hostOf(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname;
  } catch {
    return url;
  }
}

/** "99,97" of null → "—" */
export function formatUptimePct(value: number | null): string {
  if (value === null) return "—";
  return `${value.toLocaleString("nl-NL", { maximumFractionDigits: 2 })}%`;
}

/** Latency in ms, afgerond op hele ms. */
export function formatLatency(value: number | null): string {
  if (value === null) return "—";
  return `${Math.round(value)} ms`;
}

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("nl-NL", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDuration(fromMs: number, toMs: number): string {
  const totalMinutes = Math.max(0, Math.round((toMs - fromMs) / 60000));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) {
    return minutes > 0 ? `${hours} u ${minutes} min` : `${hours} u`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours > 0 ? `${days} d ${restHours} u` : `${days} d`;
}

/**
 * Label bij een down-site: "Down sinds 15 aug 10:05". Bij een andere
 * status of ontbrekende timestamp → null (toon dan niets).
 */
export function downSinceLabel(state: SiteStatus, changedAt: string | null): string | null {
  if (state !== "down" || !changedAt) return null;
  return `Down sinds ${formatDateTime(changedAt)}`;
}

/** Incident-duur als "12 min" / "2 u 5 min" / "1 d 3 u". */
export function incidentDuration(startedAt: string, endedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  return formatDuration(start, end);
}

/** Test-hulp: "99,97" → 99.97 (nl-NL komma) */
export function parseFormattedPct(value: string): number | null {
  if (value === "—") return null;
  return Number(value.replace("%", "").replace(",", "."));
}
