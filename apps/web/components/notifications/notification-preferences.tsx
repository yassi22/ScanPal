"use client";

import { useEffect, useState } from "react";
import type { NotificationType } from "@scanpal/shared";

const TYPE_META: { type: NotificationType; label: string; description: string }[] = [
  {
    type: "score_drop",
    label: "Score dropped",
    description: "When a site's score drops during a scheduled scan.",
  },
  {
    type: "scan_diff",
    label: "Changes detected",
    description:
      "When a scheduled scan shows new or regressed findings (from medium) or the score drops ≥ 5 points.",
  },
  {
    type: "critical_finding",
    label: "Critical finding",
    description: "When a scan produces one or more critical findings.",
  },
  {
    type: "site_down",
    label: "Site down",
    description: "When a site fails two consecutive checks.",
  },
  {
    type: "site_recovered",
    label: "Site recovered",
    description: "When a site is reachable again after an outage.",
  },
  {
    type: "credit_skip",
    label: "Scan skipped",
    description: "When a scheduled scan is skipped due to the credit limit.",
  },
  {
    type: "scan_failed",
    label: "Scan failed",
    description: "When a scheduled scan fails.",
  },
  {
    type: "scan_done",
    label: "Scan completed",
    description: "When a scan is complete. Off by default.",
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
    <section className="notification-prefs">
      {error && (
        <p className="workspace-alert is-error" role="alert">
          {error}
        </p>
      )}

      {prefs === null ? (
        <div className="notification-prefs-loading">Voorkeuren laden…</div>
      ) : (
        <div className="notification-prefs-list">
          {TYPE_META.map(({ type, label, description }) => (
            <div key={type} className="notification-pref-row">
              <div>
                <strong>{label}</strong>
                <p>{description}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={prefs[type]}
                aria-label={label}
                disabled={busyType === type}
                onClick={() => toggle(type, !prefs[type])}
                className={`notification-toggle${prefs[type] ? " is-on" : ""}`}
              >
                <span className="notification-toggle-thumb" />
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="notification-prefs-note">
        Uitgezet betekent: geen e-mail én geen in-app melding voor dat type.
        Wijzigingen zijn direct actief.
      </p>
    </section>
  );
}
