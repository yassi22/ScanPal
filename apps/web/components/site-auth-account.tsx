"use client";

import { useEffect, useState } from "react";
import { Key, ShieldCheck, WarningCircle, X } from "@phosphor-icons/react";
import { ownershipVerificationStatus } from "@scanpal/shared";

type Props = {
  siteId: string;
  siteUrl: string;
  open: boolean;
  onClose: () => void;
};

type OwnershipInfo = {
  token: string;
  record_name: string;
  record_value: string;
  verified_at: string | null;
};

type CredentialMeta = {
  has_credentials: boolean;
  username: string | null;
  login_url: string | null;
};

export function SiteAuthAccount({ siteId, siteUrl, open, onClose }: Props) {
  const [ownership, setOwnership] = useState<OwnershipInfo | null>(null);
  const [creds, setCreds] = useState<CredentialMeta | null>(null);
  const [loginUrl, setLoginUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    Promise.all([
      fetch(`/api/sites/${siteId}/ownership`),
      fetch(`/api/sites/${siteId}/auth-credentials`),
    ])
      .then(async ([ownRes, credRes]) => {
        setError(null);
        if (ownRes.ok) setOwnership(await ownRes.json());
        if (credRes.ok) {
          const meta = (await credRes.json()) as CredentialMeta;
          setCreds(meta);
          if (meta.username) setUsername(meta.username);
          if (meta.login_url) setLoginUrl(meta.login_url);
        }
      })
      .catch(() => {
        if (active) setError("Ophalen mislukt.");
      });
    return () => {
      active = false;
    };
  }, [open, siteId]);

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/auth-credentials`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          login_url: loginUrl || null,
          username,
          password,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Opslaan mislukt.");
        return;
      }
      setCreds(data);
      setPassword("");
      setNotice("Wegwerp-testaccount opgeslagen.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    setError(null);
    try {
      await fetch(`/api/sites/${siteId}/auth-credentials`, { method: "DELETE" });
      setCreds({ has_credentials: false, username: null, login_url: null });
      setNotice("Wegwerp-testaccount verwijderd.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const ownershipStatus = ownership
    ? ownershipVerificationStatus(ownership.verified_at)
    : "unverified";
  const ready = ownershipStatus === "verified" && Boolean(creds?.has_credentials);

  return (
    <div className="site-auth-account">
      <div className="site-auth-account-heading">
        <span><Key size={16} aria-hidden="true" /></span>
        <strong>Auth-flow test-account</strong>
        <button type="button" onClick={onClose} aria-label="Sluiten">
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      {ready && (
        <p className="site-auth-ready">
          <ShieldCheck size={15} aria-hidden="true" /> Eigendom geverifieerd en
          wegwerp-testaccount ingesteld — de auth-flow-scanner kan draaien.
        </p>
      )}

      <section>
        <h4>1. Domeineigendom</h4>
        {ownershipStatus === "verified" ? (
          <p className="is-success">Geverifieerd via DNS-TXT.</p>
        ) : (
          <div className="site-auth-ownership-hint">
            <p className="is-warning">
              <WarningCircle size={15} aria-hidden="true" /> Verifieer eerst
              domeineigendom. De auth-flow-scanner draait pas na verificatie.
            </p>
            {ownership && (
              <p className="site-auth-record">
                Plaats een TXT-record op <code>{ownership.record_name}</code> met
                waarde <code>{ownership.record_value}</code> en verifieer daarna.
              </p>
            )}
          </div>
        )}
      </section>

      <section>
        <h4>2. Wegwerp-testaccount</h4>
        <p className="site-auth-help">
          Een wegwerp-account op {siteUrl} dat je bezit. De scanner logt in en
          test de login-/reset-flow — alleen tegen dit account, niet-destructief.
        </p>
        {creds?.has_credentials && (
          <p className="is-success">
            Ingesteld: {creds.username}
            {creds.login_url ? ` (${creds.login_url})` : ""}
          </p>
        )}
        <label>
          <span>Login-URL (optioneel)</span>
          <input
            type="url"
            value={loginUrl}
            onChange={(e) => setLoginUrl(e.target.value)}
            placeholder="https://example.com/login"
          />
        </label>
        <label>
          <span>Gebruikersnaam / e-mail</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="test@example.com"
          />
        </label>
        <label>
          <span>Wachtwoord</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={creds?.has_credentials ? "overschrijven…" : "wachtwoord"}
          />
        </label>
        <div className="site-auth-actions">
          <button type="button" onClick={save} disabled={saving || !username || !password}>
            {saving ? "Opslaan…" : "Opslaan"}
          </button>
          {creds?.has_credentials && (
            <button type="button" onClick={remove} disabled={saving} className="is-danger">
              Verwijderen
            </button>
          )}
        </div>
      </section>

      {error && <p className="is-error">{error}</p>}
      {notice && <p className="is-success">{notice}</p>}
    </div>
  );
}
