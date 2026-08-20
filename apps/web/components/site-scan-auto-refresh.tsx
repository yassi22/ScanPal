"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Live-refresh voor de site-detailpagina. De pagina zelf is een
 * `force-dynamic` server component zonder eigen polling — zodra een scan in de
 * worker-pipeline afrondt, blijft het scherm anders op de oude status/score
 * staan tot een handmatige reload. Deze thin client-component peilt de
 * site-status (net als `sites-manager` op de overzichtspagina, 3s-interval) en
 * roept `router.refresh()` bij elke statuswijziging aan, zodat de server
 * component opnieuw rendert met de nieuwe score. Polling stopt zodra de scan in
 * een eindtoestand zit (completed/failed/canceled).
 *
 * De huidige status leeft in een ref (niet in state): het interval wordt zo
 * één keer per mount opgezet en niet bij elke statusovergang afgebroken — dat
 * maakt de poll ongevoelig voor de identiteit van `router` tussen renders.
 */
const ACTIVE_SCAN = new Set(["queued", "running"]);

export function SiteScanAutoRefresh({
  siteId,
  initialStatus,
}: {
  siteId: string;
  initialStatus: string | null;
}) {
  const router = useRouter();
  const statusRef = useRef<string | null>(initialStatus);

  useEffect(() => {
    if (!statusRef.current || !ACTIVE_SCAN.has(statusRef.current)) return;

    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/sites/${siteId}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        const next: string | null = data?.site?.last_scan_status ?? null;
        if (cancelled || !next || next === statusRef.current) return;
        statusRef.current = next;
        if (!ACTIVE_SCAN.has(next)) {
          clearInterval(timer);
        }
        // Re-render de server component met de verse status/score.
        router.refresh();
      } catch {
        // netwerkfout — volgende tick probeert opnieuw
      }
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [siteId, router]);

  return null;
}
