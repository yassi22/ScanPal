import { NextResponse } from "next/server";
import { magicLinkInputSchema } from "@scanpal/shared";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = magicLinkInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ongeldige invoer" },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      emailRedirectTo: `${env.appUrl}/api/auth/callback`,
      shouldCreateUser: true,
    },
  });

  if (error) {
    console.error("magic-link signInWithOtp mislukt:", error.code, error.message);
    if (error.code === "over_email_send_rate_limit") {
      return NextResponse.json(
        { error: "Te veel verzoeken vanaf dit adres. Wacht een uur en probeer het opnieuw." },
        { status: 429 },
      );
    }
    return NextResponse.json(
      { error: "Kon de magische link niet versturen. Probeer het opnieuw." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
