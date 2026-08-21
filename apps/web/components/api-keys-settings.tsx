"use client";

import { useState } from "react";
import type { ApiKeyView } from "@scanpal/shared";

type Props = {
  isOwner: boolean;
  initialKeys: ApiKeyView[];
};

export function ApiKeysSettings({ isOwner, initialKeys }: Props) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [keys, setKeys] = useState(initialKeys);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  async function createKey(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);
    setCreatedKey(null);
    try {
      const res = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Aanmaken mislukt");
      setKeys((prev) => [data.key, ...prev]);
      setCreatedKey(data.full_key);
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Er ging iets mis");
    } finally {
      setLoading(false);
    }
  }

  async function revokeKey(keyId: string) {
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/api-keys/${keyId}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Intrekken mislukt");
      return;
    }
    setKeys((prev) =>
      prev.map((k) => (k.id === keyId ? { ...k, revoked_at: new Date().toISOString() } : k)),
    );
    setNotice("API-key ingetrokken");
  }

  async function copyKey() {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey);
    setNotice("Key gekopieerd — bewaar hem goed, hij wordt niet meer getoond.");
  }

  if (!isOwner) {
    return (
      <div className="settings-stack">
        {(error || notice) && (
          <p className={`workspace-alert${error ? " is-error" : ""}`} role="alert">
            {error ?? notice}
          </p>
        )}
        <section className="settings-card">
          <p className="settings-muted">
            Alleen de team-owner kan API-keys aanmaken en beheren. Vraag de owner
            van dit team om een key.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="settings-stack">
      {(error || notice) && (
        <p className={`workspace-alert${error ? " is-error" : ""}`} role="alert">
          {error ?? notice}
        </p>
      )}

      {createdKey && (
        <div className="settings-secret-card">
          <h2>Key aangemaakt — bewaar hem nu</h2>
          <p>
            De volledige key wordt maar één keer getoond. Kopieer hem direct;
            ScanPal slaat alleen een hash op.
          </p>
          <div className="settings-secret-reveal">
            <code className="settings-secret-value">{createdKey}</code>
            <button onClick={copyKey} className="dashboard-primary-button">
              Kopiëren
            </button>
          </div>
        </div>
      )}

      <section className="settings-card">
        <h2>Nieuwe key aanmaken</h2>
        <p className="settings-card-intro">
          Een key geeft volledige API-toegang voor je team — gebruik hem voor de
          MCP-server of je eigen integraties.
        </p>
        <form onSubmit={createKey} className="settings-form">
          <div className="settings-form-row">
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="bijv. CI-pipeline"
              className="settings-input"
            />
            <button
              type="submit"
              disabled={loading}
              className="dashboard-primary-button"
            >
              {loading ? "Aanmaken…" : "Key aanmaken"}
            </button>
          </div>
        </form>
      </section>

      <section className="settings-card">
        <h2>Keys ({keys.length})</h2>
        {keys.length === 0 ? (
          <p className="settings-note">
            Nog geen API-keys. Maak er één aan om de REST API of MCP-server te
            gebruiken.
          </p>
        ) : (
          <ul className="settings-item-list">
            {keys.map((key) => {
              const revoked = key.revoked_at !== null;
              return (
                <li key={key.id} className="settings-item">
                  <div className="settings-item-head">
                    <div className="min-w-0">
                      <p className="settings-item-title">
                        {key.name}
                        {revoked && (
                          <span className="settings-chip is-danger">ingetrokken</span>
                        )}
                      </p>
                      <p className="settings-item-sub">
                        <code>{key.prefix}…</code> · aangemaakt{" "}
                        {new Date(key.created_at).toLocaleDateString("nl-NL")}
                        {key.last_used_at
                          ? ` · laatst gebruikt ${new Date(key.last_used_at).toLocaleDateString("nl-NL")}`
                          : " · nog niet gebruikt"}
                      </p>
                    </div>
                    <button
                      onClick={() => revokeKey(key.id)}
                      disabled={revoked}
                      className="settings-link-danger"
                    >
                      Intrekken
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="settings-note">
          Request-limiet geldt per key én per team (afhankelijk van je plan).
        </p>
      </section>
    </div>
  );
}
