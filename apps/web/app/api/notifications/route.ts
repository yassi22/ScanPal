import { NextResponse } from "next/server";
import {
  notificationTypeSchema,
  notificationsListQuerySchema,
  notificationsListResponseSchema,
} from "@scanpal/shared";
import { getSessionUser } from "@/lib/supabase/server";
import { pool } from "@/lib/db";
import { listNotifications } from "@/lib/notifications-core";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const rawUnread = url.searchParams.get("unread");
  const unread =
    rawUnread === "true" ? true : rawUnread === "false" ? false : undefined;
  const rawType = url.searchParams.get("type");
  let type: string | undefined;
  if (rawType) {
    const parsedType = notificationTypeSchema.safeParse(rawType);
    if (!parsedType.success) {
      return NextResponse.json({ error: "Ongeldig type-filter" }, { status: 400 });
    }
    type = parsedType.data;
  }

  const parsed = notificationsListQuerySchema.safeParse({
    unread,
    type,
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ongeldige filters" },
      { status: 400 },
    );
  }

  const result = await listNotifications(pool, {
    userId: user.id,
    ...parsed.data,
  });
  const response = notificationsListResponseSchema.safeParse(result);
  if (!response.success) {
    console.error("notificaties voldoen niet aan het contract:", response.error);
    return NextResponse.json(
      { error: "Ophalen mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }

  return NextResponse.json(response.data);
}
