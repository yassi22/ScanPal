import { NextResponse, after } from "next/server";
import type { NextRequest } from "next/server";
import { pool } from "@/lib/db";
import { getHoneypotByToken, markPatternEvent, recordHoneypotHit } from "@/lib/threats-core";
import { analyzeThreatHit } from "@/lib/threat-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Publieke honeypot-decoy (plan 12): altijd 404 — nooit lekken of het
 * bestaan van een honeypot. Elke hit wordt gelogd en async geanalyseerd
 * (burst/path/UA/IP-regels uit threat_rules).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const response = new NextResponse("Not Found", { status: 404 });
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("Cache-Control", "no-store");

  const honeypot = await getHoneypotByToken(pool, token);
  if (!honeypot || !honeypot.enabled) return response;

  const hit = {
    path: request.nextUrl.pathname + request.nextUrl.search,
    ip:
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      null,
    userAgent: request.headers.get("user-agent"),
  };

  after(() => {
    void (async () => {
      try {
        const { eventId } = await recordHoneypotHit(pool, honeypot, hit);
        if (!eventId) return;
        const match = await analyzeThreatHit(pool, honeypot, hit);
        if (match) await markPatternEvent(pool, eventId, match);
      } catch (err) {
        console.error("honeypot-hit verwerken mislukt:", err);
      }
    })();
  });

  return response;
}
