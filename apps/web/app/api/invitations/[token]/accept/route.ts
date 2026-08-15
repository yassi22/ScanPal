import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { pool } from "@/lib/db";
import { acceptInvitation, InviteError } from "@/lib/invites-core";

export const runtime = "nodejs";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await acceptInvitation(pool, {
      token,
      userId: user.id,
      email: user.email ?? "",
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof InviteError) {
      const status =
        err.code === "not_found"
          ? 404
          : err.code === "expired"
            ? 410
            : err.code === "email_mismatch"
              ? 403
              : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("uitnodiging accepteren mislukt:", err);
    return NextResponse.json(
      { error: "Accepteren mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }
}
