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

      <form
        onSubmit={save}
        className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/50 p-6"
      >
        <div>
          <label className="text-sm font-medium text-slate-300">Naam</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Je naam"
            className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm outline-none transition focus:border-brand"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-300">
            Avatar-URL
          </label>
          <input
            type="url"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="https://…/avatar.png"
            className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm outline-none transition focus:border-brand"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-brand/90 disabled:opacity-50"
        >
          {loading ? "Opslaan…" : "Opslaan"}
        </button>
      </form>
    </div>
  );
}
