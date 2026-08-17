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
      <div className="mt-8">
        {(error || notice) && (
          <div
            className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
              error
                ? "border-red-500/30 bg-red-500/10 text-red-400"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
            }`}
          >
            {error ?? notice}
          </div>
        )}
        <p className="text-sm text-slate-400">
          Alleen de team-owner kan API-keys aanmaken en beheren. Vraag de owner
          van dit team om een key.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-8">
      {(error || notice) && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            error
              ? "border-red-500/30 bg-red-500/10 text-red-400"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
          }`}
        >
          {error ?? notice}
        </div>
      )}

      {createdKey && (
        <div className="rounded-2xl border border-brand/40 bg-brand/10 p-6">
          <h2 className="font-semibold text-slate-100">Key aangemaakt — bewaar hem nu</h2>
          <p className="mt-1 text-sm text-slate-400">
            De volledige key wordt maar één keer getoond. Kopieer hem direct;
            ScanPal slaat alleen een hash op.
          </p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
            <code className="break-all rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-emerald-300">
              {createdKey}
            </code>
            <button
              onClick={copyKey}
              className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-brand/90"
            >
              Kopiëren
            </button>
          </div>
        </div>
      )}

      <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <h2 className="font-semibold">Nieuwe key aanmaken</h2>
        <p className="mt-1 text-sm text-slate-400">
          Een key geeft volledige API-toegang voor je team — gebruik hem voor
          de MCP-server of je eigen integraties.
        </p>
        <form onSubmit={createKey} className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="bijv. CI-pipeline"
            className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm outline-none transition focus:border-brand"
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-brand/90 disabled:opacity-50"
          >
            {loading ? "Aanmaken…" : "Key aanmaken"}
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <h2 className="font-semibold">Keys ({keys.length})</h2>
        {keys.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">
            Nog geen API-keys. Maak er één aan om de REST API of MCP-server te
            gebruiken.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {keys.map((key) => {
              const revoked = key.revoked_at !== null;
              return (
                <li
                  key={key.id}
                  className="flex items-center justify-between gap-4 rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium text-slate-200">
                      {key.name}
                      {revoked && (
                        <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs text-red-400">
                          ingetrokken
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      <code className="text-slate-400">{key.prefix}…</code> ·
                      aangemaakt {new Date(key.created_at).toLocaleDateString("nl-NL")}
                      {key.last_used_at
                        ? ` · laatst gebruikt ${new Date(key.last_used_at).toLocaleDateString("nl-NL")}`
                        : " · nog niet gebruikt"}
                    </p>
                  </div>
                  <button
                    onClick={() => revokeKey(key.id)}
                    disabled={revoked}
                    className="shrink-0 text-xs text-slate-400 underline-offset-2 hover:text-red-400 hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Intrekken
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-4 text-xs text-slate-500">
          Request-limiet geldt per key én per team (afhankelijk van je plan).
        </p>
      </section>
    </div>
  );
}
