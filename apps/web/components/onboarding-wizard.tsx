"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ScanState = {
  id: string;
  siteId: string;
  url: string;
  status: string;
  progress: number;
  score: number | null;
  findings: { checks?: { id: string; name: string; status: string; detail: string }[] } | null;
  error?: string | null;
};

const STEPS = ["URL", "Scan", "Resultaat"];

export function OnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanState | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function startScan(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch("/api/onboarding/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Er ging iets mis");
      setScan({
        id: data.scan.id,
        siteId: data.site.id,
        url: data.site.url,
        status: data.scan.status,
        progress: data.scan.progress,
        score: data.scan.score,
        findings: data.scan.findings,
      });
      setStep(1);
      if (data.scan.status !== "completed" && data.scan.status !== "failed") {
        startPolling(data.scan.id);
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Er ging iets mis");
    } finally {
      setSubmitting(false);
    }
  }

  const startPolling = useCallback((scanId: string) => {
    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/scans/${scanId}`);
      if (!res.ok) return;
      const data = await res.json();
      setScan((prev) =>
        prev ? { ...prev, status: data.status, progress: data.progress, score: data.score, findings: data.findings } : prev,
      );
      if (data.status === "completed" || data.status === "failed") {
        if (pollRef.current) clearInterval(pollRef.current);
        setStep(2);
      }
    }, 1500);
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function finish() {
    await fetch("/api/onboarding/complete", { method: "POST" });
    router.push("/dashboard");
    router.refresh();
  }

  const checks = scan?.findings?.checks ?? [];

  return (
    <div>
      <div className="mb-8 flex items-center gap-2">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                i < step
                  ? "bg-brand text-slate-950"
                  : i === step
                    ? "border-2 border-brand text-brand"
                    : "border border-slate-700 text-slate-500"
              }`}
            >
              {i + 1}
            </div>
            <span
              className={`text-sm ${i === step ? "text-slate-200" : "text-slate-500"}`}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && <div className="h-px w-6 bg-slate-800" />}
          </div>
        ))}
      </div>

      {step === 0 && (
        <form onSubmit={startScan} className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8">
          <h1 className="text-2xl font-bold">Scan je eerste website</h1>
          <p className="mt-2 text-sm text-slate-400">
            Voer de URL van een website in. ScanPal voert direct een eerste set
            checks uit — straks worden dat er 100+.
          </p>

          {formError && (
            <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {formError}
            </div>
          )}

          <label className="mt-6 block">
            <span className="text-sm font-medium text-slate-300">Website URL</span>
            <input
              type="text"
              required
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="voorbeeld.nl"
              className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none transition focus:border-brand"
            />
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="mt-6 w-full rounded-lg bg-brand px-4 py-3 font-semibold text-slate-950 transition hover:bg-brand/90 disabled:opacity-50"
          >
            {submitting ? "Starten…" : "Start scan"}
          </button>
        </form>
      )}

      {step === 1 && scan && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8">
          <h1 className="text-2xl font-bold">Bezig met scannen…</h1>
          <p className="mt-2 text-sm text-slate-400">{scan.url}</p>

          <div className="mt-6">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400">
                {scan.status === "failed" ? "Scan mislukt" : "Checks uitvoeren…"}
              </span>
              <span className="font-semibold text-brand">{scan.progress}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-brand transition-all duration-500"
                style={{ width: `${scan.progress}%` }}
              />
            </div>
          </div>

          {scan.status === "failed" && (
            <button
              onClick={() => setStep(0)}
              className="mt-6 rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium transition hover:border-slate-500"
            >
              Opnieuw proberen
            </button>
          )}
        </div>
      )}

      {step === 2 && scan && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8">
          <h1 className="text-2xl font-bold">Scan voltooid</h1>
          <p className="mt-2 text-sm text-slate-400">{scan.url}</p>

          <div className="mt-6 flex items-center gap-4">
            <div
              className={`flex h-20 w-20 items-center justify-center rounded-full text-2xl font-bold ${
                (scan.score ?? 0) >= 80
                  ? "bg-emerald-500/15 text-emerald-400"
                  : (scan.score ?? 0) >= 50
                    ? "bg-amber-500/15 text-amber-400"
                    : "bg-red-500/15 text-red-400"
              }`}
            >
              {scan.score}
            </div>
            <div>
              <p className="font-semibold">Gezondheidsscore</p>
              <p className="text-sm text-slate-400">
                Eerste indruk op basis van {checks.length} checks.
              </p>
            </div>
          </div>

          <ul className="mt-6 space-y-2">
            {checks.map((check) => (
              <li
                key={check.id}
                className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm"
              >
                <span
                  className={
                    check.status === "pass"
                      ? "text-emerald-400"
                      : check.status === "warn"
                        ? "text-amber-400"
                        : "text-red-400"
                  }
                >
                  {check.status === "pass" ? "✓" : check.status === "warn" ? "!" : "✕"}
                </span>
                <div>
                  <p className="font-medium text-slate-200">{check.name}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{check.detail}</p>
                </div>
              </li>
            ))}
          </ul>

          <button
            onClick={finish}
            className="mt-8 w-full rounded-lg bg-brand px-4 py-3 font-semibold text-slate-950 transition hover:bg-brand/90"
          >
            Naar dashboard
          </button>
        </div>
      )}
    </div>
  );
}
