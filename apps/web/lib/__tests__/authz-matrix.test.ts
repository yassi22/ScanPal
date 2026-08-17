import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as plansGET } from "@/app/api/plans/route";
import { GET as invitationGET } from "@/app/api/invitations/[token]/route";
import { GET as invitationsListGET, POST as invitationsPOST } from "@/app/api/teams/[teamId]/invitations/route";
import { DELETE as invitationDelete } from "@/app/api/teams/[teamId]/invitations/[invitationId]/route";
import { GET as membersGET } from "@/app/api/teams/[teamId]/members/route";
import { PATCH as memberPATCH, DELETE as memberDELETE } from "@/app/api/teams/[teamId]/members/[userId]/route";
import { requireOwner, requireTeamMember } from "@/lib/authz";
import { pool } from "@/lib/db";
import {
  createInvitation,
  deleteInvitation,
  getInvitation,
  listMembers,
  listPendingInvitations,
  removeMember,
  updateMemberRole,
} from "@/lib/invites-core";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/authz", () => ({
  requireOwner: vi.fn(),
  requireTeamMember: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [{ name: "Team" }] }),
  },
}));
vi.mock("@/lib/invites-core", () => ({
  createInvitation: vi.fn(),
  deleteInvitation: vi.fn(),
  getInvitation: vi.fn(),
  listMembers: vi.fn(),
  listPendingInvitations: vi.fn(),
  removeMember: vi.fn(),
  updateMemberRole: vi.fn(),
  InviteError: class extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));
vi.mock("@/lib/email", () => ({
  sendInviteEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/env", () => ({
  env: { appUrl: "http://localhost:3000" },
}));

const ownerMock = vi.mocked(requireOwner);
const memberMock = vi.mocked(requireTeamMember);
const createInviteMock = vi.mocked(createInvitation);
const listInvitesMock = vi.mocked(listPendingInvitations);
const listMembersMock = vi.mocked(listMembers);
const deleteInviteMock = vi.mocked(deleteInvitation);
const removeMemberMock = vi.mocked(removeMember);
const updateRoleMock = vi.mocked(updateMemberRole);
const getInvitationMock = vi.mocked(getInvitation);

const TEAM_ID = "00000000-0000-4000-8000-0000000000t1";
const INVITE_ID = "00000000-0000-4000-8000-0000000000i1";
const USER_ID = "00000000-0000-4000-8000-0000000000u1";

function ownerCtx() {
  ownerMock.mockResolvedValue({
    ok: true,
    user: { id: "owner-1" },
    membership: { team_id: TEAM_ID, user_id: "owner-1", role: "owner", status: "accepted" },
  } as never);
}

function memberCtx() {
  memberMock.mockResolvedValue({
    ok: true,
    user: { id: "member-1" },
    membership: { team_id: TEAM_ID, user_id: "member-1", role: "member", status: "accepted" },
  } as never);
}

function teamParams() {
  return { params: Promise.resolve({ teamId: TEAM_ID }) };
}

function invitationParams() {
  return { params: Promise.resolve({ teamId: TEAM_ID, invitationId: INVITE_ID }) };
}

function memberParams() {
  return { params: Promise.resolve({ teamId: TEAM_ID, userId: USER_ID }) };
}

function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_INVITE_BODY = { email: "x@y.nl", role: "member" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(pool.query).mockResolvedValue({ rows: [{ name: "Team" }] } as never);
  ownerCtx();
  memberCtx();
  createInviteMock.mockResolvedValue({
    id: INVITE_ID,
    team_id: TEAM_ID,
    email: "x@y.nl",
    role: "member",
    token: "tok",
    expires_at: new Date("2099-01-01T00:00:00Z").toISOString(),
    accepted_at: null,
    created_at: new Date().toISOString(),
  } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("publiek (geen auth vereist)", () => {
  it("GET /api/plans is publiek", async () => {
    const response = await plansGET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.plans.length).toBeGreaterThan(0);
  });

  it("GET /api/invitations/[token] is publiek (token-gebaseerd)", async () => {
    getInvitationMock.mockResolvedValue({
      team_id: TEAM_ID,
      team_name: "Team",
      email: "x@y.nl",
      role: "member",
      expires_at: new Date("2099-01-01T00:00:00Z").toISOString(),
      accepted_at: null,
    } as never);
    const response = await invitationGET(
      new NextRequest("http://localhost/api/invitations/tok"),
      { params: Promise.resolve({ token: "tok" }) },
    );
    expect(response.status).toBe(200);
  });

  it("verlopen uitnodiging → 410", async () => {
    getInvitationMock.mockResolvedValue({
      team_id: TEAM_ID,
      team_name: "Team",
      email: "x@y.nl",
      role: "member",
      expires_at: new Date("2020-01-01T00:00:00Z").toISOString(),
      accepted_at: null,
    } as never);
    const response = await invitationGET(
      new NextRequest("http://localhost/api/invitations/tok"),
      { params: Promise.resolve({ token: "tok" }) },
    );
    expect(response.status).toBe(410);
  });
});

describe("owner-only routes (member → 403, anon → 401)", () => {
  it("POST /api/teams/[id]/invitations: owner → 201", async () => {
    const response = await invitationsPOST(
      jsonRequest(`http://localhost/api/teams/${TEAM_ID}/invitations`, VALID_INVITE_BODY),
      teamParams(),
    );
    expect(response.status).toBe(201);
    expect(createInviteMock).toHaveBeenCalledWith(pool, expect.objectContaining({ teamId: TEAM_ID }));
  });

  it("POST /api/teams/[id]/invitations: member → 403", async () => {
    ownerMock.mockResolvedValue({ ok: false, status: 403 } as never);
    const response = await invitationsPOST(
      jsonRequest(`http://localhost/api/teams/${TEAM_ID}/invitations`, VALID_INVITE_BODY),
      teamParams(),
    );
    expect(response.status).toBe(403);
    expect(createInviteMock).not.toHaveBeenCalled();
  });

  it("POST /api/teams/[id]/invitations: anon → 401", async () => {
    ownerMock.mockResolvedValue({ ok: false, status: 401 } as never);
    const response = await invitationsPOST(
      jsonRequest(`http://localhost/api/teams/${TEAM_ID}/invitations`, VALID_INVITE_BODY),
      teamParams(),
    );
    expect(response.status).toBe(401);
  });

  it("DELETE /api/teams/[id]/invitations/[invitationId]: owner → 200, member → 403", async () => {
    deleteInviteMock.mockResolvedValue(true);

    const asOwner = await invitationDelete(
      new NextRequest(`http://localhost/api/teams/${TEAM_ID}/invitations/${INVITE_ID}`, { method: "DELETE" }),
      invitationParams(),
    );
    expect(asOwner.status).toBe(200);

    ownerMock.mockResolvedValue({ ok: false, status: 403 } as never);
    const asMember = await invitationDelete(
      new NextRequest(`http://localhost/api/teams/${TEAM_ID}/invitations/${INVITE_ID}`, { method: "DELETE" }),
      invitationParams(),
    );
    expect(asMember.status).toBe(403);
    expect(deleteInviteMock).toHaveBeenCalledTimes(1);
  });

  it("PATCH /api/teams/[id]/members/[userId]: owner → 200, member → 403", async () => {
    updateRoleMock.mockResolvedValue(true as never);

    const asOwner = await memberPATCH(
      jsonRequest(`http://localhost/api/teams/${TEAM_ID}/members/${USER_ID}`, { role: "member" }),
      memberParams(),
    );
    expect(asOwner.status).toBe(200);

    ownerMock.mockResolvedValue({ ok: false, status: 403 } as never);
    const asMember = await memberPATCH(
      jsonRequest(`http://localhost/api/teams/${TEAM_ID}/members/${USER_ID}`, { role: "member" }),
      memberParams(),
    );
    expect(asMember.status).toBe(403);
  });

  it("DELETE /api/teams/[id]/members/[userId]: owner → 200, member → 403", async () => {
    removeMemberMock.mockResolvedValue(true as never);

    const asOwner = await memberDELETE(
      new NextRequest(`http://localhost/api/teams/${TEAM_ID}/members/${USER_ID}`, { method: "DELETE" }),
      memberParams(),
    );
    expect(asOwner.status).toBe(200);

    ownerMock.mockResolvedValue({ ok: false, status: 403 } as never);
    const asMember = await memberDELETE(
      new NextRequest(`http://localhost/api/teams/${TEAM_ID}/members/${USER_ID}`, { method: "DELETE" }),
      memberParams(),
    );
    expect(asMember.status).toBe(403);
  });
});

describe("member-routes (lid → 200, anon → 401)", () => {
  it("GET /api/teams/[id]/invitations: lid → 200", async () => {
    listInvitesMock.mockResolvedValue([] as never);
    const response = await invitationsListGET(
      new NextRequest(`http://localhost/api/teams/${TEAM_ID}/invitations`),
      teamParams(),
    );
    expect(response.status).toBe(200);
  });

  it("GET /api/teams/[id]/invitations: anon → 401", async () => {
    memberMock.mockResolvedValue({ ok: false, status: 401 } as never);
    const response = await invitationsListGET(
      new NextRequest(`http://localhost/api/teams/${TEAM_ID}/invitations`),
      teamParams(),
    );
    expect(response.status).toBe(401);
  });

  it("GET /api/teams/[id]/members: lid → 200, anon → 401", async () => {
    listMembersMock.mockResolvedValue([] as never);
    const asMember = await membersGET(
      new NextRequest(`http://localhost/api/teams/${TEAM_ID}/members`),
      teamParams(),
    );
    expect(asMember.status).toBe(200);

    memberMock.mockResolvedValue({ ok: false, status: 401 } as never);
    const anon = await membersGET(
      new NextRequest(`http://localhost/api/teams/${TEAM_ID}/members`),
      teamParams(),
    );
    expect(anon.status).toBe(401);
  });
});
