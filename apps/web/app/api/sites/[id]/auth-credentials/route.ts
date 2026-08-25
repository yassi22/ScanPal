import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authCredentialsInputSchema, registrableDomain } from "@scanpal/shared";
import { getSessionUser } from "@/lib/supabase/server";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";
import {
  CredentialsNotConfiguredError,
  deleteAuthCredentials,
  getAuthCredentialsMeta,
  saveAuthCredentials,
} from "@scanpal/scan-core";

export const runtime = "nodejs";

async function authorizeSite(siteId: string) {
  const user = await getSessionUser();
  if (!user) return null;
  const result = await pool.query(
    `select s.team_id, s.url, m.role, m.workspace_id from sites s
     join memberships m on m.team_id = s.team_id
     where s.id = $1 and m.user_id = $2 and m.status = 'accepted'
       and (m.role = 'owner' or s.workspace_id = m.workspace_id)`,
    [siteId, user.id],
  );
  if (result.rowCount === 0) return null;
  return {
    teamId: result.rows[0].team_id as string,
    siteUrl: result.rows[0].url as string,
    workspaceId:
      result.rows[0].role === "owner"
        ? undefined
        : (result.rows[0].workspace_id as string | null),
  };
}

/**
 * De scanner logt met dit account in op de opgegeven `login_url`. Bind die URL
 * aan het (via domeineigendom geverifieerde) site-domein, zodat het wegwerp-
 * account nooit tegen een derde host wordt ingezonden.
 */
function loginUrlOnSiteDomain(siteUrl: string, loginUrl: string): boolean {
  try {
    const siteDomain = registrableDomain(new URL(siteUrl).hostname);
    const loginDomain = registrableDomain(new URL(loginUrl).hostname);
    return Boolean(siteDomain) && siteDomain === loginDomain;
  } catch {
    return false;
  }
}

/** GET: metadata (zonder password) — of er een wegwerp-account is. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authorization = await authorizeSite(id);
  if (!authorization) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const meta = await getAuthCredentialsMeta(pool, {
    siteId: id,
    teamId: authorization.teamId,
    workspaceId: authorization.workspaceId,
  });
  return NextResponse.json(meta);
}

/** PUT: opslaan/overschrijven van het wegwerp-testaccount (password encrypted). */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authorization = await authorizeSite(id);
  if (!authorization) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = authCredentialsInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ongeldige invoer" },
      { status: 400 },
    );
  }

  if (parsed.data.login_url && !loginUrlOnSiteDomain(authorization.siteUrl, parsed.data.login_url)) {
    return NextResponse.json(
      { error: "Login-URL moet op hetzelfde domein als de site staan." },
      { status: 400 },
    );
  }

  if (!env.authCredentialKey) {
    return NextResponse.json(
      { error: "Auth-credentials zijn niet geconfigureerd (AUTH_CREDENTIAL_KEY ontbreekt)." },
      { status: 503 },
    );
  }

  try {
    await saveAuthCredentials(pool, {
      siteId: id,
      teamId: authorization.teamId,
      workspaceId: authorization.workspaceId,
      loginUrl: parsed.data.login_url ?? null,
      username: parsed.data.username,
      password: parsed.data.password,
      key: env.authCredentialKey,
    });
    const meta = await getAuthCredentialsMeta(pool, {
      siteId: id,
      teamId: authorization.teamId,
      workspaceId: authorization.workspaceId,
    });
    return NextResponse.json(meta);
  } catch (err) {
    if (err instanceof CredentialsNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    console.error("auth-credentials opslaan mislukt:", err);
    return NextResponse.json(
      { error: "Opslaan mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }
}

/** DELETE: verwijder het wegwerp-testaccount. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authorization = await authorizeSite(id);
  if (!authorization) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await deleteAuthCredentials(pool, {
    siteId: id,
    teamId: authorization.teamId,
    workspaceId: authorization.workspaceId,
  });
  return NextResponse.json({ has_credentials: false });
}
