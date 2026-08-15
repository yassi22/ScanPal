"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/dashboard";
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handle = async () => {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const accessToken = hash.get("access_token");
      if (accessToken) {
        const supabase = createClient();
        await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: hash.get("refresh_token") ?? "",
        });
        window.location.replace(next);
      }
    };
    handle();
  }, [next]);

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Er ging iets mis");
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Er ging iets mis");
    } finally {
      setLoading(false);
    }
  }

  async function handleOAuth(provider: "google" | "github") {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) setError(error.message);
  }

  if (sent) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand/15 text-2xl text-brand">
          ✉️
        </div>
        <h2 className="text-xl font-semibold">Check je inbox</h2>
        <p className="mt-2 text-sm text-slate-400">
          We hebben een magische link gestuurd naar{" "}
          <span className="font-medium text-slate-200">{email}</span>. Klik op de
          link om {mode === "login" ? "in te loggen" : "je account te activeren"}.
        </p>
        <button
          onClick={() => setSent(false)}
          className="mt-6 text-sm text-brand hover:underline"
        >
          Ander e-mailadres gebruiken
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-bold">
        {mode === "login" ? "Welkom terug" : "Account aanmaken"}
      </h1>
      <p className="mt-1 text-sm text-slate-400">
        {mode === "login"
          ? "Log in met een magische link — geen wachtwoord nodig."
          : "Je eerste scan staat klaar zodra je account actief is."}
      </p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <form onSubmit={handleMagicLink} className="mt-6 space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-slate-300">E-mailadres</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jij@bedrijf.nl"
            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm outline-none transition focus:border-brand"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-brand px-4 py-2.5 font-semibold text-slate-950 transition hover:bg-brand/90 disabled:opacity-50"
        >
          {loading
            ? "Versturen…"
            : mode === "login"
              ? "Stuur magische link"
              : "Maak account aan"}
        </button>
      </form>

      <div className="my-6 flex items-center gap-3 text-xs text-slate-500">
        <div className="h-px flex-1 bg-slate-800" />
        of
        <div className="h-px flex-1 bg-slate-800" />
      </div>

      <div className="space-y-3">
        <button
          onClick={() => handleOAuth("google")}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-medium transition hover:border-slate-500"
        >
          Doorgaan met Google
        </button>
        <button
          onClick={() => handleOAuth("github")}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-medium transition hover:border-slate-500"
        >
          Doorgaan met GitHub
        </button>
      </div>

      <p className="mt-6 text-center text-sm text-slate-500">
        {mode === "login" ? (
          <>
            Nog geen account?{" "}
            <a href="/register" className="text-brand hover:underline">
              Registreer
            </a>
          </>
        ) : (
          <>
            Al een account?{" "}
            <a href="/login" className="text-brand hover:underline">
              Log in
            </a>
          </>
        )}
      </p>
    </div>
  );
}
