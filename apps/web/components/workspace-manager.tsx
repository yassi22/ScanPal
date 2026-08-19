"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Briefcase, PencilSimple, Plus, Trash } from "@phosphor-icons/react";

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
    <section className="workspace-manager-panel">
      <div className="team-panel-heading"><span><Briefcase size={19} aria-hidden="true" /></span><div><h2>Client workspaces</h2><p>Scope properties and members per client. A member without a workspace cannot see any properties.</p></div></div>
      {error && <p className="workspace-alert is-error" role="alert">{error}</p>}
      {isOwner && (
        <div className="workspace-create-form">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Workspace name"
            aria-label="Workspace name"
            maxLength={80}
          />
          <button type="button" onClick={create} disabled={busy || !name.trim()}>
            <Plus size={16} aria-hidden="true" /> {busy ? "Creating…" : "Add workspace"}
          </button>
        </div>
      )}
      <ul className="workspace-manager-list">
        {workspaces.map((workspace) => (
          <li key={workspace.id}>
            <span>{workspace.name}</span>
            {isOwner && (
              <span>
                <button type="button" onClick={() => rename(workspace)}><PencilSimple size={16} aria-hidden="true" /><span>Rename</span></button>
                <button type="button" onClick={() => remove(workspace)} className="is-danger"><Trash size={16} aria-hidden="true" /><span>Delete</span></button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {workspaces.length === 0 && <p className="workspace-empty-note">No client workspaces yet.</p>}
    </section>
  );
}
