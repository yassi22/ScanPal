import Link from "next/link";

export const metadata = {
  title: "Terms & licensing",
};

export default function TermsPage() {
  return (
    <main className="flex-1 px-4 py-12">
      <article className="mx-auto max-w-2xl space-y-6 text-sm leading-7 text-slate-300">
        <Link href="/" className="text-slate-400 hover:text-slate-200">← ScanPal</Link>
        <h1 className="text-3xl font-bold text-slate-100">Terms & licensing</h1>
        <p>Raadpleeg de actuele commerciële voorwaarden voordat je rapporten deelt met klanten.</p>
        <p>Neem voor vragen over licentie of klantgebruik contact op met de beheerder van je account.</p>
      </article>
    </main>
  );
}
