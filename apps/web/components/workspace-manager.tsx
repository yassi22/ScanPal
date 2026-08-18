"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Workspace = { id: string; name: string };

export function WorkspaceManager({
  teamId,
  initialWorkspaces,
  isOwner,
}: {
  teamId: string;
  initialWorkspaces: Workspace[];
  isOwner: boolean;
}) {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState(initialWorkspaces);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/teams/${teamId}/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? "Workspace maken mislukt");
      setWorkspaces((current) => [...current, data.workspace]);
      setName("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Workspace maken mislukt");
    } finally {
      setBusy(false);
    }
  }

  async function rename(workspace: Workspace) {
    const nextName = window.prompt("Nieuwe workspace-naam", workspace.name)?.trim();
    if (!nextName || nextName === workspace.name) return;
    const response = await fetch(`/api/teams/${teamId}/workspaces/${workspace.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nextName }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      setError(data?.error ?? "Workspace wijzigen mislukt");
      return;
    }
    const data = await response.json();
    setWorkspaces((current) => current.map((item) => item.id === workspace.id ? data.workspace : item));
    router.refresh();
  }

  async function remove(workspace: Workspace) {
    if (!window.confirm(`Verwijder workspace \"${workspace.name}\"? Sites blijven behouden maar worden ongekoppeld.`)) return;
    const response = await fetch(`/api/teams/${teamId}/workspaces/${workspace.id}`, { method: "DELETE" });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      setError(data?.error ?? "Workspace verwijderen mislukt");
      return;
    }
    setWorkspaces((current) => current.filter((item) => item.id !== workspace.id));
    router.refresh();
  }

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
      <h2 className="font-semibold">Client-workspaces</h2>
      <p className="mt-1 text-sm text-slate-400">
        Organiseer sites en teamleden per klant. Een member zonder workspace ziet geen sites.
      </p>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {isOwner && (
        <div className="mt-4 flex gap-3">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nieuwe workspace"
            maxLength={80}
            className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm outline-none focus:border-brand"
          />
          <button type="button" onClick={create} disabled={busy || !name.trim()} className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-50">
            {busy ? "Maken…" : "Toevoegen"}
          </button>
        </div>
      )}
      <ul className="mt-4 space-y-2">
        {workspaces.map((workspace) => (
          <li key={workspace.id} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm">
            <span className="text-slate-200">{workspace.name}</span>
            {isOwner && (
              <span className="flex gap-3 text-xs">
                <button type="button" onClick={() => rename(workspace)} className="text-slate-400 hover:text-slate-200">Hernoemen</button>
                <button type="button" onClick={() => remove(workspace)} className="text-slate-400 hover:text-red-400">Verwijderen</button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {workspaces.length === 0 && <p className="mt-4 text-sm text-slate-500">Nog geen workspaces.</p>}
    </section>
  );
}
