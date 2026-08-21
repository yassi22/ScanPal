"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Props = {
  initialName: string | null;
  initialAvatarUrl: string | null;
};

export function ProfileSettings({ initialName, initialAvatarUrl }: Props) {
  const [name, setName] = useState(initialName ?? "");
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({
        data: {
          full_name: name.trim() || null,
          avatar_url: avatarUrl.trim() || null,
        },
      });
      if (error) throw new Error(error.message);
      setNotice("Profiel opgeslagen");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Er ging iets mis");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="settings-card">
      {(error || notice) && (
        <p className={`workspace-alert${error ? " is-error" : ""}`} role="alert">
          {error ?? notice}
        </p>
      )}

      <h2>Profiel</h2>
      <p className="settings-card-intro">
        Werk je weergavenaam en avatar bij. Deze verschijnen in je account en in
        rapporten.
      </p>

      <form onSubmit={save} className="settings-form">
        <label className="settings-field">
          <span>Naam</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Je naam"
            className="settings-input"
          />
        </label>
        <label className="settings-field">
          <span>Avatar-URL</span>
          <input
            type="url"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="https://…/avatar.png"
            className="settings-input"
          />
        </label>
        <div>
          <button
            type="submit"
            disabled={loading}
            className="dashboard-primary-button"
          >
            {loading ? "Opslaan…" : "Opslaan"}
          </button>
        </div>
      </form>
    </section>
  );
}
