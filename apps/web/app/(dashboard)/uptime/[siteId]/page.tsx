import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureUserTeam } from "@/lib/team";
import { pool } from "@/lib/db";
import { getUptimeDetail } from "@/lib/uptime-core";
import { UptimeDetailView } from "@/components/uptime/uptime-detail";

export const dynamic = "force-dynamic";

export default async function UptimeSitePage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const result = await ensureUserTeam(pool, {
    id: user?.id ?? "",
    email: user?.email ?? "",
    name: user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? null,
    avatar_url: user?.user_metadata?.avatar_url ?? null,
    auth_provider: user?.app_metadata?.provider ?? null,
  });

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
