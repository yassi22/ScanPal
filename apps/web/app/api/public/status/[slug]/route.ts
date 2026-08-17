import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isValidPublicStatusSlug, publicStatusSchema } from "@scanpal/shared";
import { pool } from "@/lib/db";
import { getPublicStatus } from "@/lib/public-status-core";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Publieke status-feed (plan 57): `GET /api/public/status/[slug]` — geen
 * sessie/key nodig, alleen uptime-data (nooit findings/scores/PII).
 * Redis-rate limit per IP (plan 26) + cache-headers; de pagina/feed is
 * noindex en een onbekende slug → 404 (geen existence-leak).
 */

const PUBLIC_RATE_LIMIT_PER_MINUTE = 60;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!isValidPublicStatusSlug(slug)) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  try {
    const limit = await checkRateLimit(
      `public:${ip}`,
      PUBLIC_RATE_LIMIT_PER_MINUTE,
    );
    if (!limit.ok) {
      return NextResponse.json(
        { error: "Te veel verzoeken" },
        {
          status: 429,
          headers: { "Retry-After": String(limit.retryAfterSeconds) },
        },
      );
    }
  } catch (err) {
    // Fail-open: de publieke statuspagina moet blijven werken als Redis
    // even down is (anders is de statuspagina onbruikbaar).
    console.error("publieke rate-limit mislukt:", err);
  }

  const rawDays = request.nextUrl.searchParams.get("days");
  const days: 30 | 90 = rawDays === "90" ? 90 : 30;

  const status = await getPublicStatus(pool, slug, days);
  if (!status) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const parsed = publicStatusSchema.safeParse(status);
  if (!parsed.success) {
    console.error("publieke status voldoet niet aan het contract:", parsed.error);
    return NextResponse.json(
      { error: "Ophalen mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }

  const response = NextResponse.json(parsed.data);
  response.headers.set(
    "Cache-Control",
    "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
  );
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}