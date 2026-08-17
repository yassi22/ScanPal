import Link from "next/link";
import { planList } from "@scanpal/shared";
import { createClient } from "@/lib/supabase/server";
import { PricingCards } from "@/components/pricing-cards";

export const metadata = {
  title: "Pricing — ScanPal",
};

export default async function PricingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-800">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-lg font-bold tracking-tight">
            Scan<span className="text-brand">Pal</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm text-slate-400">
            <Link href="/pricing" className="transition hover:text-slate-200">
              Pricing
            </Link>
            {user ? (
              <Link
                href="/dashboard"
                className="rounded-lg bg-brand px-4 py-2 font-semibold text-slate-950 transition hover:bg-brand/90"
              >
                Dashboard
              </Link>
            ) : (
              <>
                <Link href="/login" className="transition hover:text-slate-200">
                  Inloggen
                </Link>
                <Link
                  href="/register"
                  className="rounded-lg bg-brand px-4 py-2 font-semibold text-slate-950 transition hover:bg-brand/90"
                >
                  Gratis starten
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-16">
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight">
            Simpele prijzen, geen verrassingen
          </h1>
          <p className="mt-4 text-lg text-slate-400">
            Start gratis en upgrade wanneer je meer scans, uptime-monitoring of
            GitHub-scans nodig hebt.
          </p>
        </div>

        <div className="mt-12">
          <PricingCards plans={planList} signedIn={user !== null} />
        </div>
      </main>
    </div>
  );
}
