import { NextResponse } from "next/server";
import {
  notificationPreferenceUpdateSchema,
  notificationPreferencesResponseSchema,
} from "@scanpal/shared";
import { getSessionUser } from "@/lib/supabase/server";
import { pool } from "@/lib/db";
import {
  listNotificationPreferences,
  setNotificationPreference,
} from "@/lib/notifications-core";

export const runtime = "nodejs";

async function authUser() {
  const user = await getSessionUser();
  if (!user) return null;
  return user;
}

export async function GET() {
  const user = await authUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const preferences = await listNotificationPreferences(pool, user.id);
  const parsed = notificationPreferencesResponseSchema.safeParse({
    preferences,
  });
  if (!parsed.success) {
    console.error("voorkeuren voldoen niet aan het contract:", parsed.error);
    return NextResponse.json(
      { error: "Ophalen mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }

  return NextResponse.json(parsed.data);
}

export async function PATCH(request: Request) {
  const user = await authUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = notificationPreferenceUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ongeldige voorkeur" },
      { status: 400 },
    );
  }

  await setNotificationPreference(
    pool,
    user.id,
    parsed.data.type,
    parsed.data.enabled,
  );

  const preferences = await listNotificationPreferences(pool, user.id);
  const response = notificationPreferencesResponseSchema.safeParse({
    preferences,
  });
  if (!response.success) {
    console.error("voorkeuren voldoen niet aan het contract:", response.error);
    return NextResponse.json(
      { error: "Opslaan mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }

  return NextResponse.json(response.data);
}
