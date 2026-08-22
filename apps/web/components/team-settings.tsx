"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Branding } from "@scanpal/shared";
import { useAccessibleDialog } from "@/lib/use-accessible-dialog";
import {
  CheckCircle,
  EnvelopeSimple,
  IdentificationBadge,
  PaintBrush,
  Plus,
  Trash,
  UsersThree,
  WarningCircle,
} from "@phosphor-icons/react";

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
  branding: Branding;
  whiteLabelEnabled: boolean;
};

type Upsell = { plan: string; error: string } | null;

export function TeamSettings({
  teamId,
  teamName,
  isOwner,
  currentUserId,
  members: initialMembers,
  invitations: initialInvitations,
  branding: initialBranding,
  whiteLabelEnabled,
}: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"owner" | "member">("member");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [members, setMembers] = useState(initialMembers);
  const [invitations, setInvitations] = useState(initialInvitations);
  const [upsell, setUpsell] = useState<Upsell>(null);
  const [upgrading, setUpgrading] = useState(false);
  const upsellDialogRef = useAccessibleDialog(upsell !== null, () => setUpsell(null));
  const [branding, setBranding] = useState<Branding>(initialBranding);
  const [brandingSaving, setBrandingSaving] = useState(false);

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
      if (data?.upsell) {
        setUpsell({ plan: data.upsell.plan, error: data.error });
        return;
      }
      if (!res.ok) throw new Error(data?.error ?? "Uitnodigen mislukt");
      setEmail("");
      setInvitations((prev) => [...prev, data.invitation]);
      if (data.email?.sent === false) {
        setError(
          "Invitation created, but the email could not be sent. Check the Resend configuration.",
        );
      } else {
        setNotice(`Invitation sent to ${email}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Er ging iets mis");
    } finally {
      setLoading(false);
    }
  }

  async function upgrade() {
    setUpgrading(true);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: upsell?.plan ?? "pro" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Checkout starten mislukt");
      window.location.assign(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout starten mislukt");
      setUpgrading(false);
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
      setError(data?.error ?? "Failed to cancel");
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
      setError(data?.error ?? "Failed to delete");
      return;
    }
    setMembers((prev) => prev.filter((m) => m.user_id !== userId));
    router.refresh();
  }

  async function saveBranding(e: React.FormEvent) {
    e.preventDefault();
    setBrandingSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/teams/${teamId}/branding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(branding),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Branding opslaan mislukt");
      setBranding(data.branding);
      setNotice("Branding opgeslagen");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Branding opslaan mislukt");
    } finally {
      setBrandingSaving(false);
    }
  }

  return (
    <div className="team-settings">
      {(error || notice) && (
        <div className={`workspace-alert ${error ? "is-error" : "is-success"}`} role={error ? "alert" : "status"}>
          {error ? <WarningCircle size={18} aria-hidden="true" /> : <CheckCircle size={18} aria-hidden="true" />}
          <span>{error ?? notice}</span>
        </div>
      )}

      <section className="team-members-panel">
        <div className="team-panel-heading">
          <span><UsersThree size={19} aria-hidden="true" /></span>
          <div><h2>Members</h2><p>{members.length} {members.length === 1 ? "person has" : "people have"} access to this team.</p></div>
          {isOwner && <a className="team-mobile-invite-link" href="#team-invite">Invite</a>}
        </div>
        <ul className="team-member-list">
          {members.map((member) => (
            <li key={member.user_id} className="team-member-row">
              <span className="team-member-avatar" aria-hidden="true">{(member.name ?? member.email).slice(0, 2).toUpperCase()}</span>
              <div className="team-member-identity">
                <strong>
                  {member.name ?? member.email}
                  {member.user_id === currentUserId && <small>You</small>}
                </strong>
                {member.name && <span>{member.email}</span>}
              </div>
              <div className="team-member-actions">
                {isOwner ? (
                  <>
                    <select
                      value={member.role}
                      onChange={(e) => changeRole(member.user_id, e.target.value as "owner" | "member")}
                      aria-label={`Role for ${member.name ?? member.email}`}
                    >
                      <option value="member">Member</option>
                      <option value="owner">Owner</option>
                    </select>
                    <button type="button" onClick={() => removeMember(member.user_id)} aria-label={`Remove ${member.name ?? member.email}`}>
                      <Trash size={16} aria-hidden="true" />
                    </button>
                  </>
                ) : (
                  <span className="team-role-label">{member.role === "owner" ? "Owner" : "Member"}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
        {!isOwner && <p className="team-owner-note">Only an owner can invite and manage members.</p>}
      </section>

      {isOwner && (
        <section className="team-invite-panel" id="team-invite">
          <div className="team-panel-heading"><span><EnvelopeSimple size={19} aria-hidden="true" /></span><div><h2>Invite a teammate</h2><p>The invitation link stays valid for seven days.</p></div></div>
          <form onSubmit={sendInvite} className="team-invite-form">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@company.com"
              aria-label="Email address"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "owner" | "member")}
              aria-label="Workspace role"
            >
              <option value="member">Member</option>
              <option value="owner">Owner</option>
            </select>
            <button
              type="submit"
              disabled={loading}
            >
              <Plus size={16} aria-hidden="true" /> {loading ? "Sending…" : "Send invite"}
            </button>
          </form>

          {invitations.length > 0 && (
            <div className="team-pending-invites">
              <h3>Pending invitations</h3>
              <ul>
                {invitations.map((invite) => (
                  <li key={invite.id}>
                    <div>
                      <strong>{invite.email}</strong>
                      <span>
                        {invite.role === "owner" ? "Owner" : "Member"} · expires{" "}
                        {new Date(invite.expires_at).toLocaleDateString("en-GB")}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => cancelInvite(invite.id)}
                      aria-label={`Cancel invitation for ${invite.email}`}
                    >
                      <Trash size={16} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="team-identity-panel">
        <span><IdentificationBadge size={20} aria-hidden="true" /></span>
        <div><small>Team identity</small><strong>{teamName}</strong><p>The team name is currently managed by ScanPal.</p></div>
      </section>

      <section className="team-branding-panel">
        <div className="team-panel-heading">
          <span><PaintBrush size={19} aria-hidden="true" /></span>
          <div>
            <h2>Report identity</h2>
            <p>Use your own report name, logo, and accent in shared evidence.</p>
            <Link href="/terms">Terms and licensing</Link>
          </div>
          {!whiteLabelEnabled && <small className="team-plan-badge">Max</small>}
        </div>
        {whiteLabelEnabled ? (
          <form onSubmit={saveBranding} className="team-branding-form">
            <label>
              <span>Report name</span>
              <input
                value={branding.report_name ?? ""}
                onChange={(e) => setBranding((prev) => ({ ...prev, report_name: e.target.value || null }))}
                placeholder="Northstar security report"
                maxLength={120}
              />
            </label>
            <label>
              <span>Logo URL</span>
              <input
                type="url"
                value={branding.logo_url ?? ""}
                onChange={(e) => setBranding((prev) => ({ ...prev, logo_url: e.target.value || null }))}
                placeholder="https://example.com/logo.png"
                maxLength={2048}
              />
            </label>
            <label className="team-color-field">
              <input
                type="color"
                value={branding.primary_color ?? "#22d3ee"}
                onChange={(e) => setBranding((prev) => ({ ...prev, primary_color: e.target.value }))}
              />
              <span>Accent color</span>
            </label>
            <label className="team-check-field">
              <input
                type="checkbox"
                checked={branding.hide_branding ?? false}
                onChange={(e) => setBranding((prev) => ({ ...prev, hide_branding: e.target.checked }))}
              />
              <span>Hide the ScanPal attribution</span>
            </label>
            <button
              type="submit"
              disabled={!isOwner || brandingSaving}
            >
              {brandingSaving ? "Saving…" : "Save identity"}
            </button>
          </form>
        ) : (
          <p className="team-locked-note">White-label reports are available on the Max plan.</p>
        )}
      </section>

      {upsell && (
        <div className="workspace-modal-backdrop" role="presentation">
          <div ref={upsellDialogRef} tabIndex={-1} className="workspace-modal" role="dialog" aria-modal="true" aria-labelledby="team-upgrade-title">
            <span className="workspace-modal-icon"><UsersThree size={22} aria-hidden="true" /></span>
            <h2 id="team-upgrade-title">Member limit reached</h2>
            <p>{upsell.error}</p>
            <div>
              <button
                type="button"
                onClick={upgrade}
                disabled={upgrading}
                className="dashboard-primary-button"
              >
                {upgrading
                  ? "Opening checkout…"
                  : `Upgrade to ${upsell.plan === "pro" ? "Pro" : upsell.plan}`}
              </button>
              <button
                type="button"
                onClick={() => setUpsell(null)}
                disabled={upgrading}
                className="dashboard-light-button"
              >
                Maybe later
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
