"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { EnvelopeSimple, GithubLogo, GoogleLogo } from "@phosphor-icons/react";
import { createClient } from "@/lib/supabase/client";

/**
 * Open-redirect-hardening (client): alleen relatieve paden; `//x`, absolute
 * URL's en externe schemes → fallback. Spiegel van de server-side `safeNext`
 * in de auth-callback-route, voor de hash-flow (implicit grant).
 */
function safeNext(raw: string | null): string {
  if (!raw) return "/dashboard";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  return raw;
}

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get("next"));
  const oauthError = searchParams.get("error");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(
    oauthError === "auth" ? "Inloggen is mislukt. Probeer het opnieuw." : null,
  );
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
      <div className="auth-card auth-sent">
        <div className="auth-sent-icon" aria-hidden="true">
          <EnvelopeSimple size={26} weight="regular" />
        </div>
        <h2 className="auth-title">Check je inbox</h2>
        <p className="auth-subtitle" style={{ margin: "10px auto 0" }}>
          We hebben een magische link gestuurd naar{" "}
          <span className="auth-sent-email">{email}</span>. Klik op de link om{" "}
          {mode === "login" ? "in te loggen" : "je account te activeren"}.
        </p>
        <button
          type="button"
          onClick={() => setSent(false)}
          className="auth-sent-reset"
        >
          Ander e-mailadres gebruiken
        </button>
      </div>
    );
  }

  return (
    <div className="auth-card">
      <span className="auth-eyebrow">
        {mode === "login" ? "Inloggen" : "Nieuw account"}
      </span>
      <h1 className="auth-title">
        {mode === "login" ? "Welkom terug" : "Account aanmaken"}
      </h1>
      <p className="auth-subtitle">
        {mode === "login"
          ? "Log in met een magische link — geen wachtwoord nodig."
          : "Je eerste scan staat klaar zodra je account actief is."}
      </p>

      {error && <div className="auth-error">{error}</div>}

      <form onSubmit={handleMagicLink} className="auth-form">
        <label className="auth-field">
          <span className="auth-label">E-mailadres</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jij@bedrijf.nl"
            className="auth-input"
          />
        </label>
        <button type="submit" disabled={loading} className="auth-primary">
          {loading
            ? "Versturen…"
            : mode === "login"
              ? "Stuur magische link"
              : "Maak account aan"}
        </button>
      </form>

      <div className="auth-divider">of</div>

      <div className="auth-oauth">
        <button
          type="button"
          onClick={() => handleOAuth("google")}
          className="auth-oauth-button"
        >
          <GoogleLogo size={18} weight="bold" aria-hidden="true" />
          Doorgaan met Google
        </button>
        <button
          type="button"
          onClick={() => handleOAuth("github")}
          className="auth-oauth-button"
        >
          <GithubLogo size={18} weight="fill" aria-hidden="true" />
          Doorgaan met GitHub
        </button>
      </div>

      <p className="auth-footer">
        {mode === "login" ? (
          <>
            Nog geen account?{" "}
            <a href="/register" className="auth-footer-link">
              Registreer
            </a>
          </>
        ) : (
          <>
            Al een account?{" "}
            <a href="/login" className="auth-footer-link">
              Log in
            </a>
          </>
        )}
      </p>
    </div>
  );
}
