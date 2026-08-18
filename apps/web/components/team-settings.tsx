"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Member = {
  user_id: string;
  name: string | null;
  email: string;
  role: "owner" | "member";
  status: string;
  created_at: string;
};

type PendingInvitation = {
  id: string;
  team_id: string;
  email: string;
  role: "owner" | "member";
  expires_at: string;
  created_at: string;
};

type Props = {
  teamId: string;
  teamName: string;
  isOwner: boolean;
  currentUserId: string;
  members: Member[];
  invitations: PendingInvitation[];
};

export function TeamSettings({
  teamId,
  teamName,
  isOwner,
  currentUserId,
  members: initialMembers,
  invitations: initialInvitations,
}: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"owner" | "member">("member");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [members, setMembers] = useState(initialMembers);
  const [invitations, setInvitations] = useState(initialInvitations);

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/teams/${teamId}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Uitnodigen mislukt");
      setEmail("");
      setNotice(`Uitnodiging gestuurd naar ${email}`);
      setInvitations((prev) => [...prev, data.invitation]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Er ging iets mis");
    } finally {
      setLoading(false);
    }
  }

  async function cancelInvite(invitationId: string) {
    setError(null);
    setNotice(null);
    const res = await fetch(
      `/api/teams/${teamId}/invitations/${invitationId}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Annuleren mislukt");
      return;
    }
    setInvitations((prev) => prev.filter((i) => i.id !== invitationId));
    router.refresh();
  }

  async function changeRole(userId: string, newRole: "owner" | "member") {
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/teams/${teamId}/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Rol wijzigen mislukt");
      return;
    }
    setMembers((prev) =>
      prev.map((m) => (m.user_id === userId ? { ...m, role: newRole } : m)),
    );
    router.refresh();
  }

  async function removeMember(userId: string) {
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/teams/${teamId}/members/${userId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Verwijderen mislukt");
      return;
    }
    setMembers((prev) => prev.filter((m) => m.user_id !== userId));
    router.refresh();
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

      {isOwner && (
        <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
          <h2 className="font-semibold">Leden uitnodigen</h2>
          <p className="mt-1 text-sm text-slate-400">
            De uitgenodigde ontvangt een e-mail met een link die 7 dagen geldig is.
          </p>
          <form onSubmit={sendInvite} className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="collega@bedrijf.nl"
              className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm outline-none transition focus:border-brand"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "owner" | "member")}
              className="rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm outline-none transition focus:border-brand"
            >
              <option value="member">Lid</option>
              <option value="owner">Owner</option>
            </select>
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-brand/90 disabled:opacity-50"
            >
              {loading ? "Versturen…" : "Uitnodigen"}
            </button>
          </form>

          {invitations.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-medium text-slate-300">
                Openstaande uitnodigingen
              </h3>
              <ul className="mt-2 space-y-2">
                {invitations.map((invite) => (
                  <li
                    key={invite.id}
                    className="flex items-center justify-between gap-4 rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm"
                  >
                    <div>
                      <span className="text-slate-200">{invite.email}</span>
                      <span className="ml-2 text-xs text-slate-500">
                        als {invite.role === "owner" ? "owner" : "lid"} · verloopt{" "}
                        {new Date(invite.expires_at).toLocaleDateString("nl-NL")}
                      </span>
                    </div>
                    <button
                      onClick={() => cancelInvite(invite.id)}
                      className="text-xs text-slate-400 underline-offset-2 hover:text-red-400 hover:underline"
                    >
                      Annuleren
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <h2 className="font-semibold">Leden ({members.length})</h2>
        <ul className="mt-4 space-y-2">
          {members.map((member) => (
            <li
              key={member.user_id}
              className="flex items-center justify-between gap-4 rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-200">
                  {member.name ?? member.email}
                  {member.user_id === currentUserId && (
                    <span className="ml-2 text-xs font-normal text-slate-500">
                      (jij)
                    </span>
                  )}
                </p>
                {member.name && (
                  <p className="truncate text-xs text-slate-500">{member.email}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {isOwner ? (
                  <>
                    <select
                      value={member.role}
                      onChange={(e) =>
                        changeRole(member.user_id, e.target.value as "owner" | "member")
                      }
                      className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs outline-none transition focus:border-brand"
                    >
                      <option value="member">Lid</option>
                      <option value="owner">Owner</option>
                    </select>
                    <button
                      onClick={() => removeMember(member.user_id)}
                      className="text-xs text-slate-400 underline-offset-2 hover:text-red-400 hover:underline"
                    >
                      Verwijderen
                    </button>
                  </>
                ) : (
                  <span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300">
                    {member.role === "owner" ? "Owner" : "Lid"}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
        {!isOwner && (
          <p className="mt-4 text-xs text-slate-500">
            Alleen de owner kan leden uitnodigen en beheren.
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <h2 className="font-semibold">Team</h2>
        <p className="mt-1 text-sm text-slate-400">
          De teamnaam <span className="font-medium text-slate-200">{teamName}</span>{" "}
          wordt later bewerkbaar gemaakt.
        </p>
      </section>
    </div>
  );
}
