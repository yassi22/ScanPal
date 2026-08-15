"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

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
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand/15 text-2xl text-brand">
        👥
      </div>
      <h1 className="text-xl font-bold">Team-uitnodiging</h1>
      <p className="mt-2 text-sm text-slate-400">
        Je bent uitgenodigd om lid te worden van{" "}
        <span className="font-semibold text-slate-200">{teamName}</span> op
        ScanPal als <span className="text-slate-200">{role === "owner" ? "owner" : "lid"}</span>.
      </p>

      {wrongEmail ? (
        <div className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
          Deze uitnodiging is bestemd voor{" "}
          <span className="font-medium">{email}</span>, maar je bent ingelogd
          met <span className="font-medium">{loggedInEmail}</span>.{" "}
          <Link href="/login" className="underline hover:text-amber-300">
            Log uit en log in met het juiste account
          </Link>{" "}
          of vraag een nieuwe uitnodiging aan.
        </div>
      ) : done ? (
        <div className="mt-6 text-sm text-emerald-400">
          Uitnodiging geaccepteerd! Je wordt naar het dashboard gebracht…
        </div>
      ) : loggedIn ? (
        <>
          {error && (
            <div className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}
          <button
            onClick={accept}
            disabled={loading}
            className="mt-6 w-full rounded-lg bg-brand px-4 py-2.5 font-semibold text-slate-950 transition hover:bg-brand/90 disabled:opacity-50"
          >
            {loading ? "Accepteren…" : "Uitnodiging accepteren"}
          </button>
        </>
      ) : (
        <>
          <p className="mt-6 text-sm text-slate-400">
            Log in of maak een account om de uitnodiging te accepteren.
          </p>
          <div className="mt-4 space-y-3">
            <Link
              href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
              className="block w-full rounded-lg bg-brand px-4 py-2.5 font-semibold text-slate-950 transition hover:bg-brand/90"
            >
              Log in
            </Link>
            <Link
              href={`/register?next=${encodeURIComponent(`/invite/${token}`)}`}
              className="block w-full rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-medium transition hover:border-slate-500"
            >
              Account aanmaken
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
