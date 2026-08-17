import { NextResponse } from "next/server";
import {
  apiKeyCreatedSchema,
  apiKeyListResponseSchema,
  createApiKeySchema,
} from "@scanpal/shared";
import { requireSessionOwner } from "@/lib/api-auth";
import { pool } from "@/lib/db";
import { createApiKey, listApiKeys } from "@/lib/api-keys-core";

export const runtime = "nodejs";

function ownerError(status: 401 | 403) {
  return NextResponse.json(
    { error: status === 403 ? "Alleen de team-owner kan API-keys beheren" : "Unauthorized" },
    { status },
  );
}

/**
 * GET /api/api-keys — lijst (prefix, name, last_used_at, revoked_at).
 * Alleen de team-owner (sessie); members → 403 (plan 14, feature 25).
 */
export async function GET() {
  const auth = await requireSessionOwner();
  if (!auth.ok) return ownerError(auth.status);

  const keys = await listApiKeys(pool, auth.ctx.teamId);
  const parsed = apiKeyListResponseSchema.safeParse({ keys });
  if (!parsed.success) {
    console.error("api-key-lijst voldoet niet aan het contract:", parsed.error);
    return NextResponse.json(
      { error: "Ophalen mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }

  return NextResponse.json(parsed.data);
}

/**
 * POST /api/api-keys — maak een key aan; de full key is 1× zichtbaar
 * (DB slaat alleen sha256 op). Alleen de team-owner.
 */
export async function POST(request: Request) {
  const auth = await requireSessionOwner();
  if (!auth.ok) return ownerError(auth.status);

  const body = await request.json().catch(() => null);
  const parsed = createApiKeySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ongeldige invoer" },
      { status: 400 },
    );
  }

  const { view, fullKey } = await createApiKey(pool, {
    teamId: auth.ctx.teamId,
    createdBy: auth.ctx.userId,
    name: parsed.data.name,
  });

  const parsedCreated = apiKeyCreatedSchema.safeParse({
    key: view,
    full_key: fullKey,
  });
  if (!parsedCreated.success) {
    console.error("aangemaakte key voldoet niet aan het contract:", parsedCreated.error);
    return NextResponse.json(
      { error: "Aanmaken mislukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }

  return NextResponse.json(parsedCreated.data, { status: 201 });
}
