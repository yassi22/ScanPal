import { NextResponse } from "next/server";
import { markReadResponseSchema } from "@scanpal/shared";
import { getSessionUser } from "@/lib/supabase/server";
import { pool } from "@/lib/db";
import { markNotificationRead } from "@/lib/notifications-core";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const notification = await markNotificationRead(pool, user.id, id);
  if (!notification) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = markReadResponseSchema.safeParse({ notification });
  if (!parsed.success) {
    console.error("gelezen-melding voldoet niet aan het contract:", parsed.error);
    return NextResponse.json(
      { error: "Ophalen mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }

  return NextResponse.json(parsed.data);
}
