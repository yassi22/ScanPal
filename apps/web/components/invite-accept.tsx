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
        throw new Error(data?.error ?? "Accepteren mislukt");
      }
      setDone(true);
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Er ging iets mis");
      setLoading(false);
    }
  }

  return (
    <div className="auth-card auth-card--center">
      <div className="auth-badge" aria-hidden="true">
        <UsersThree size={26} weight="regular" />
      </div>
      <span className="auth-eyebrow">Team-uitnodiging</span>
      <h1 className="auth-title">Je bent uitgenodigd</h1>
      <p className="auth-subtitle">
        Word lid van <span className="auth-strong">{teamName}</span> op ScanPal
        als <span className="auth-strong">{role === "owner" ? "owner" : "lid"}</span>.
      </p>

      {wrongEmail ? (
        <div className="auth-notice auth-notice-warn">
          Deze uitnodiging is bestemd voor{" "}
          <span className="auth-strong">{email}</span>, maar je bent ingelogd met{" "}
          <span className="auth-strong">{loggedInEmail}</span>.{" "}
          <Link href="/login">
            Log uit en log in met het juiste account
          </Link>{" "}
          of vraag een nieuwe uitnodiging aan.
        </div>
      ) : done ? (
        <div className="auth-notice auth-notice-success">
          Uitnodiging geaccepteerd! Je wordt naar het dashboard gebracht…
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
            {loading ? "Accepteren…" : "Uitnodiging accepteren"}
          </button>
        </>
      ) : (
        <>
          <p className="auth-subtitle" style={{ marginTop: 18 }}>
            Log in of maak een account om de uitnodiging te accepteren.
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
              Account aanmaken
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
