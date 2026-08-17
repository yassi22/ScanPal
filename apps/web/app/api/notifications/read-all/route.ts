import { NextResponse } from "next/server";
import { readAllResponseSchema } from "@scanpal/shared";
import { getSessionUser } from "@/lib/supabase/server";
import { pool } from "@/lib/db";
import { markAllNotificationsRead } from "@/lib/notifications-core";

export const runtime = "nodejs";

export async function POST() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const updated = await markAllNotificationsRead(pool, user.id);
  const parsed = readAllResponseSchema.safeParse({ updated });
  if (!parsed.success) {
    console.error("read-all antwoord voldoet niet aan het contract:", parsed.error);
    return NextResponse.json(
      { error: "Verwerken mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }

  return NextResponse.json(parsed.data);
}
