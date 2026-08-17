import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect("/dashboard");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="w-full max-w-2xl text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-4 py-1.5 text-sm text-brand">
          <span className="h-2 w-2 rounded-full bg-brand" />
          100+ checks in ~60 seconden
        </div>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Scan de beveiliging en SEO van elke website
        </h1>
        <p className="mt-4 text-lg text-slate-400">
          Voer een URL in en ontvang ranked findings met ernstniveau,
          hersteladvies en een exporteerbaar rapport.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/register"
            className="rounded-lg bg-brand px-6 py-3 font-semibold text-slate-950 transition hover:bg-brand/90"
          >
            Start gratis — eerste scan
          </Link>
          <Link
            href="/login"
            className="rounded-lg border border-slate-700 px-6 py-3 font-semibold text-slate-200 transition hover:border-slate-500"
          >
            Inloggen
          </Link>
          <Link
            href="/pricing"
            className="rounded-lg border border-slate-700 px-6 py-3 font-semibold text-slate-200 transition hover:border-slate-500"
          >
            Pricing
          </Link>
        </div>
      </div>
    </div>
  );
}
