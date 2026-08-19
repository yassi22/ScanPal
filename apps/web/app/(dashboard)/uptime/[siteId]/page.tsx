import Link from "next/link";
import { notFound } from "next/navigation";
import { pool } from "@/lib/db";
import { getUptimeDetail } from "@/lib/uptime-core";
import { UptimeDetailView } from "@/components/uptime/uptime-detail";
import { getDashboardContext } from "@/lib/dashboard-context";

export const dynamic = "force-dynamic";

export default async function UptimeSitePage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;

  const result = await getDashboardContext();

  const detail = await getUptimeDetail(pool, result.team.id, siteId, 30);
  if (!detail) notFound();

  return (
    <div>
      <Link
        href="/uptime"
        className="text-sm text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline"
      >
        ← Uptime
      </Link>

      <UptimeDetailView siteId={siteId} initial={detail} />
    </div>
  );
}
