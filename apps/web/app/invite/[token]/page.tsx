import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { pool } from "@/lib/db";
import { getInvitation } from "@/lib/invites-core";
import { InviteAccept } from "@/components/invite-accept";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invitation = await getInvitation(pool, token);

  const expired = invitation && new Date(invitation.expires_at) < new Date();
  if (!invitation || expired) {
    return (
      <div className="mx-auto mt-24 max-w-md px-6 text-center">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8">
          <h1 className="text-xl font-bold">
            {invitation ? "Uitnodiging verlopen" : "Uitnodiging niet gevonden"}
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            {invitation
              ? "Deze uitnodiging is ouder dan 7 dagen. Vraag de owner om een nieuwe."
              : "Deze link bestaat niet of is al gebruikt."}
          </p>
          <Link
            href="/"
            className="mt-6 inline-block rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-brand/90"
          >
            Naar ScanPal
          </Link>
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="mx-auto mt-24 max-w-md px-6">
      <InviteAccept
        token={token}
        teamName={invitation.team_name ?? "het team"}
        email={invitation.email}
        role={invitation.role}
        loggedIn={Boolean(user)}
        loggedInEmail={user?.email ?? null}
      />
    </div>
  );
}
