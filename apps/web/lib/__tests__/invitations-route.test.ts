import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/teams/[teamId]/invitations/route";
import { requireOwner } from "@/lib/authz";
import { pool } from "@/lib/db";
import { createInvitation, InviteError } from "@/lib/invites-core";
import { getPlanForTeam } from "@/lib/credits";
import { sendInviteEmail } from "@/lib/email";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  env: { appUrl: "http://localhost:3000" },
}));
vi.mock("@/lib/authz", () => ({
  requireOwner: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  pool: { query: vi.fn() },
}));
vi.mock("@/lib/credits", () => ({
  getPlanForTeam: vi.fn(),
}));
vi.mock("@/lib/email", () => ({
  sendInviteEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/invites-core", async () => {
  const actual = await vi.importActual<typeof import("@/lib/invites-core")>(
    "@/lib/invites-core",
  );
  return {
    ...actual,
    createInvitation: vi.fn(),
  };
});

const requireOwnerMock = vi.mocked(requireOwner);
const queryMock = vi.mocked(pool.query);
const createInvitationMock = vi.mocked(createInvitation);
const getPlanForTeamMock = vi.mocked(getPlanForTeam);
const sendInviteEmailMock = vi.mocked(sendInviteEmail);

const TEAM_ID = "00000000-0000-4000-8000-000000000001";

function inviteRequest(body: unknown): Promise<Response> {
  const request = new NextRequest(`http://localhost/api/teams/${TEAM_ID}/invitations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ teamId: TEAM_ID }) });
}

beforeEach(() => {
  requireOwnerMock.mockReset();
  queryMock.mockReset();
  createInvitationMock.mockReset();
  getPlanForTeamMock.mockReset();
  sendInviteEmailMock.mockClear();

  requireOwnerMock.mockResolvedValue({
    ok: true,
    user: { id: "u-owner", email: "owner@example.com" },
    membership: { team_id: TEAM_ID, user_id: "u-owner", role: "owner", status: "accepted" },
  } as never);
  queryMock.mockResolvedValue({ rowCount: 1, rows: [{ name: "Team" }] } as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/teams/:teamId/invitations (plan 64 stap 2 — seat-limiet)", () => {
  it("geeft 409 + upsell naar Pro terug wanneer een Free-team de ledenlimiet raakt", async () => {
    createInvitationMock.mockRejectedValue(
      new InviteError("member_limit", "De ledenlimiet van dit plan (3) is bereikt."),
    );
    getPlanForTeamMock.mockResolvedValue({ id: "free" } as never);

    const res = await inviteRequest({ email: "dave@example.com", role: "member" });
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data).toEqual({
      error: "De ledenlimiet van dit plan (3) is bereikt.",
      upsell: { plan: "pro", feature: "seats" },
    });
  });

  it("geeft 409 ZONDER upsell terug wanneer een Pro-team de ledenlimiet raakt", async () => {
    createInvitationMock.mockRejectedValue(
      new InviteError("member_limit", "De ledenlimiet van dit plan (10) is bereikt."),
    );
    getPlanForTeamMock.mockResolvedValue({ id: "pro" } as never);

    const res = await inviteRequest({ email: "dave@example.com", role: "member" });
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data).toEqual({ error: "De ledenlimiet van dit plan (10) is bereikt." });
    expect(data.upsell).toBeUndefined();
  });

  it("geeft 409 ZONDER upsell terug wanneer een Max-team de seats-limiet raakt", async () => {
    createInvitationMock.mockRejectedValue(
      new InviteError("member_limit", "De ledenlimiet van dit plan (3) is bereikt."),
    );
    getPlanForTeamMock.mockResolvedValue({ id: "max" } as never);

    const res = await inviteRequest({ email: "dave@example.com", role: "member" });
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data).toEqual({ error: "De ledenlimiet van dit plan (3) is bereikt." });
    expect(data.upsell).toBeUndefined();
  });

  it("houdt already_member op 409 zonder upsell (ongewijzigd gedrag)", async () => {
    createInvitationMock.mockRejectedValue(
      new InviteError("already_member", "Dit e-mailadres is al lid van het team"),
    );

    const res = await inviteRequest({ email: "bob@example.com", role: "member" });
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data).toEqual({ error: "Dit e-mailadres is al lid van het team" });
    expect(getPlanForTeamMock).not.toHaveBeenCalled();
  });

  it("geeft 201 terug bij een succesvolle uitnodiging", async () => {
    createInvitationMock.mockResolvedValue({
      id: "invite-1",
      team_id: TEAM_ID,
      email: "dave@example.com",
      role: "member",
      token: "t".repeat(64),
      expires_at: new Date().toISOString(),
      invited_by: "u-owner",
      created_at: new Date().toISOString(),
      accepted_at: null,
    } as never);

    const res = await inviteRequest({ email: "dave@example.com", role: "member" });
    expect(res.status).toBe(201);
    expect(sendInviteEmailMock).toHaveBeenCalled();
  });
});
