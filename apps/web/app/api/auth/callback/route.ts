import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureUserTeam } from "@/lib/team";
import { pool } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Open-redirect-hardening: alleen relatieve paden toestaan (`/x`, geen
 * `//x`). Absolute URL's of externe schemes → fallback `/dashboard`.
 */
function safeNext(raw: string | null): string {
  if (!raw) return "/dashboard";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  return raw;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code") ?? searchParams.get("token");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      await ensureUserTeam(
        pool,
        {
          id: data.user.id,
          email: data.user.email ?? "",
          name:
            data.user.user_metadata?.full_name ??
            data.user.user_metadata?.name ??
            null,
          avatar_url: data.user.user_metadata?.avatar_url ?? null,
          auth_provider: data.user.app_metadata?.provider ?? null,
        },
        { recordLogin: true },
      );
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  return NextResponse.redirect(new URL("/login?error=auth", origin));
}
