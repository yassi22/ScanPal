"use client";

import { useEffect, useState } from "react";
import type { NotificationType } from "@scanpal/shared";

const TYPE_META: { type: NotificationType; label: string; description: string }[] = [
  {
    type: "score_drop",
    label: "Score gedaald",
    description: "Wanneer de score van een site daalt bij een geplande scan.",
  },
  {
    type: "scan_diff",
    label: "Wijzigingen gedetecteerd",
    description:
      "Wanneer een geplande scan nieuwe of teruggekeerde bevindingen toont (vanaf medium) of de score ≥ 5 punten daalt.",
  },
  {
    type: "critical_finding",
    label: "Kritieke bevinding",
    description: "Wanneer een scan een of meer kritieke bevindingen oplevert.",
  },
  {
    type: "site_down",
    label: "Site down",
    description: "Wanneer een site twee opeenvolgende checks faalt.",
  },
  {
    type: "site_recovered",
    label: "Site hersteld",
    description: "Wanneer een site weer bereikbaar is na een storing.",
  },
  {
    type: "credit_skip",
    label: "Scan overgeslagen",
    description: "Wanneer een geplande scan wordt overgeslagen door de credit-limiet.",
  },
  {
    type: "scan_failed",
    label: "Scan mislukt",
    description: "Wanneer een geplande scan mislukt.",
  },
  {
    type: "scan_done",
    label: "Scan voltooid",
    description: "Wanneer een scan klaar is. Staat standaard uit.",
  },
];

function toPrefMap(
  preferences: { type: NotificationType; enabled: boolean }[],
): Record<NotificationType, boolean> {
  const map = {} as Record<NotificationType, boolean>;
  for (const preference of preferences) {
    map[preference.type] = preference.enabled;
  }
  return map;
}

export function NotificationPreferences() {
  const [prefs, setPrefs] = useState<Record<NotificationType, boolean> | null>(null);
  const [busyType, setBusyType] = useState<NotificationType | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/notifications/preferences")
      .then((res) => {
        if (!res.ok) throw new Error("Voorkeuren laden mislukt");
        return res.json();
      })
      .then((data) => {
        setPrefs(toPrefMap(data.preferences));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Er ging iets mis"));
  }, []);

  async function toggle(type: NotificationType, enabled: boolean) {
    setBusyType(type);
    setError(null);
    try {
      const res = await fetch("/api/notifications/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, enabled }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Opslaan mislukt");
      }
      const data = await res.json();
      setPrefs(toPrefMap(data.preferences));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Er ging iets mis");
    } finally {
      setBusyType(null);
    }
  }

  return (
    <div className="mt-8">
      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {prefs === null ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 text-sm text-slate-400">
          Voorkeuren laden…
        </div>
      ) : (
        <div className="space-y-3">
          {TYPE_META.map(({ type, label, description }) => (
            <div
              key={type}
              className="flex items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/50 px-5 py-4"
            >
              <div>
                <p className="font-medium text-slate-200">{label}</p>
                <p className="mt-0.5 text-sm text-slate-400">{description}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={prefs[type]}
                aria-label={label}
                disabled={busyType === type}
                onClick={() => toggle(type, !prefs[type])}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  prefs[type] ? "bg-brand" : "bg-slate-700"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                    prefs[type] ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="mt-6 text-xs text-slate-600">
        Uitgezet betekent: geen e-mail én geen in-app melding voor dat type.
        Wijzigingen zijn direct actief.
      </p>
    </div>
  );
}
