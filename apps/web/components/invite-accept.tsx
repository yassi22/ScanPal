"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UsersThree } from "@phosphor-icons/react";

type Props = {
  token: string;
  teamName: string;
  email: string;
  role: "owner" | "member";
  loggedIn: boolean;
  loggedInEmail: string | null;
};

export function InviteAccept({
  token,
  teamName,
  email,
  role,
  loggedIn,
  loggedInEmail,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const wrongEmail =
    loggedIn &&
    loggedInEmail &&
    loggedInEmail.toLowerCase() !== email.toLowerCase();

  async function accept() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/invitations/${token}/accept`, {
        method: "POST",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to accept");
      }
      setDone(true);
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <div className="auth-card auth-card--center">
      <div className="auth-badge" aria-hidden="true">
        <UsersThree size={26} weight="regular" />
      </div>
      <span className="auth-eyebrow">Team invitation</span>
      <h1 className="auth-title">You have been invited</h1>
      <p className="auth-subtitle">
        Join <span className="auth-strong">{teamName}</span> on ScanPal
        as <span className="auth-strong">{role === "owner" ? "owner" : "member"}</span>.
      </p>

      {wrongEmail ? (
        <div className="auth-notice auth-notice-warn">
          This invitation is for{" "}
          <span className="auth-strong">{email}</span>, but you are logged in with{" "}
          <span className="auth-strong">{loggedInEmail}</span>.{" "}
          <Link href="/login">
            Log out and log in with the correct account
          </Link>{" "}
          or request a new invitation.
        </div>
      ) : done ? (
        <div className="auth-notice auth-notice-success">
          Invitation accepted! Taking you to the dashboard…
        </div>
      ) : loggedIn ? (
        <>
          {error && <div className="auth-error">{error}</div>}
          <button
            type="button"
            onClick={accept}
            disabled={loading}
            className="auth-primary"
            style={{ marginTop: 24 }}
          >
            {loading ? "Accepting…" : "Accept invitation"}
          </button>
        </>
      ) : (
        <>
          <p className="auth-subtitle" style={{ marginTop: 18 }}>
            Log in or create an account to accept the invitation.
          </p>
          <div className="auth-actions">
            <Link
              href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
              className="auth-primary"
            >
              Log in
            </Link>
            <Link
              href={`/register?next=${encodeURIComponent(`/invite/${token}`)}`}
              className="auth-oauth-button"
            >
              Create account
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
