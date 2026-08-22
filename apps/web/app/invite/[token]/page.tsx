import Link from "next/link";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
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
      <div className="auth-card auth-card--center">
        <div className="auth-badge auth-badge--warn" aria-hidden="true">
          <WarningCircle size={26} weight="regular" />
        </div>
        <h1 className="auth-title">
          {invitation ? "Invitation expired" : "Invitation not found"}
        </h1>
        <p className="auth-subtitle">
          {invitation
            ? "This invitation is older than 7 days. Ask the owner for a new one."
            : "This link does not exist or has already been used."}
        </p>
        <Link href="/" className="auth-primary auth-primary--inline">
          Go to ScanPal
        </Link>
      </div>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <InviteAccept
      token={token}
      teamName={invitation.team_name ?? "the team"}
      email={invitation.email}
      role={invitation.role}
      loggedIn={Boolean(user)}
      loggedInEmail={user?.email ?? null}
    />
  );
}
