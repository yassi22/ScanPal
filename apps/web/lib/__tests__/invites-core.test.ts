import { describe, it, expect, beforeEach } from "vitest";
import type { Pool, PoolClient, QueryResult } from "pg";
import {
  createInvitation,
  getInvitation,
  acceptInvitation,
  listMembers,
  listPendingInvitations,
  deleteInvitation,
  updateMemberRole,
  removeMember,
  InviteError,
  INVITATION_TTL_MS,
  generateToken,
} from "../../lib/invites-core";

type Row = Record<string, unknown>;
type QueryResultLike = Partial<QueryResult<Row>>;

type FakeMembership = {
  team_id: string;
  user_id: string;
  role: string;
  status: string;
  invited_by: string | null;
};

type FakeInvitation = {
  id: string;
  team_id: string;
  email: string;
  role: string;
  token: string;
  expires_at: string;
  invited_by: string | null;
  accepted_at: string | null;
  created_at: string;
};

type FakeUser = { id: string; email: string; name: string | null };

function fakePool() {
  const teams: { id: string; name: string }[] = [{ id: "team-1", name: "Anna's team" }];
  const users: FakeUser[] = [
    { id: "u-owner", email: "anna@example.com", name: "Anna" },
    { id: "u-member", email: "bob@example.com", name: "Bob" },
    { id: "u-carol", email: "carol@example.com", name: "Carol" },
    { id: "u-other", email: "other@example.com", name: "Omar" },
  ];
  const memberships: FakeMembership[] = [
    { team_id: "team-1", user_id: "u-owner", role: "owner", status: "accepted", invited_by: null },
    { team_id: "team-1", user_id: "u-member", role: "member", status: "accepted", invited_by: null },
  ];
  const invitations: FakeInvitation[] = [];

  let inviteSeq = 0;

  function handle(sql: string, params: unknown[] = []): QueryResultLike {
    const text = sql.replace(/\s+/g, " ").trim();

    if (text === "begin" || text === "commit" || text === "rollback") {
      return { rowCount: 1, rows: [] };
    }

    if (text.startsWith("select 1 from memberships m join users u")) {
      const [teamId, email] = params as [string, string];
      const rows = memberships.filter(
        (m) =>
          m.team_id === teamId &&
          m.status === "accepted" &&
          users.some((u) => u.id === m.user_id && u.email.toLowerCase() === email.toLowerCase()),
      );
      return { rowCount: rows.length, rows: [] };
    }

    if (text.startsWith("select 1 from invitations where team_id")) {
      const [teamId, email] = params as [string, string];
      const rows = invitations.filter(
        (i) => i.team_id === teamId && i.email === email.toLowerCase() && i.accepted_at === null,
      );
      return { rowCount: rows.length, rows: [] };
    }

    if (text.startsWith("insert into invitations")) {
      const [teamId, email, role, token, expiresAt, invitedBy] = params as [
        string, string, string, string, Date, string,
      ];
      const invitation: FakeInvitation = {
        id: `invite-${++inviteSeq}`,
        team_id: teamId,
        email,
        role,
        token,
        expires_at: expiresAt.toISOString(),
        invited_by: invitedBy,
        accepted_at: null,
        created_at: "2026-08-15T10:00:00.000Z",
      };
      invitations.push(invitation);
      return { rowCount: 1, rows: [{ ...invitation }] };
    }

    if (text.startsWith("select i.id, i.team_id")) {
      const [token] = params as [string];
      const row = invitations.find((i) => i.token === token);
      if (!row) return { rowCount: 0, rows: [] };
      const team = teams.find((t) => t.id === row.team_id);
      return {
        rowCount: 1,
        rows: [{ ...row, team_name: team?.name }],
      };
    }

    if (text.startsWith("insert into memberships")) {
      const [teamId, userId, role, invitedBy] = params as [string, string, string, string | null];
      const existing = memberships.find((m) => m.team_id === teamId && m.user_id === userId);
      if (!existing) {
        memberships.push({ team_id: teamId, user_id: userId, role, status: "accepted", invited_by: invitedBy });
      }
      return { rowCount: 1, rows: [] };
    }

    if (text.startsWith("update invitations set accepted_at")) {
      const [id] = params as [string];
      const invite = invitations.find((i) => i.id === id);
      if (invite) invite.accepted_at = "2026-08-15T12:00:00.000Z";
      return { rowCount: invite ? 1 : 0, rows: [] };
    }

    if (text.startsWith("select u.id as user_id")) {
      const [teamId] = params as [string];
      const rows = memberships
        .filter((m) => m.team_id === teamId && m.status === "accepted")
        .map((m) => {
          const user = users.find((u) => u.id === m.user_id)!;
          return {
            user_id: m.user_id,
            name: user.name,
            email: user.email,
            role: m.role,
            status: m.status,
            created_at: "2026-08-15T10:00:00.000Z",
          };
        });
      return { rowCount: rows.length, rows };
    }

    if (text.startsWith("select id, team_id, email, role, token, expires_at, created_at")) {
      const [teamId] = params as [string];
      const rows = invitations
        .filter((i) => i.team_id === teamId && i.accepted_at === null)
        .map((i) => ({
          id: i.id,
          team_id: i.team_id,
          email: i.email,
          role: i.role,
          token: i.token,
          expires_at: i.expires_at,
          created_at: i.created_at,
        }));
      return { rowCount: rows.length, rows };
    }

    if (text.startsWith("delete from invitations")) {
      const [id, teamId] = params as [string, string];
      const idx = invitations.findIndex((i) => i.id === id && i.team_id === teamId);
      if (idx === -1) return { rowCount: 0, rows: [] };
      invitations.splice(idx, 1);
      return { rowCount: 1, rows: [] };
    }

    if (text.startsWith("select role from memberships")) {
      const [teamId, userId] = params as [string, string];
      const row = memberships.find(
        (m) => m.team_id === teamId && m.user_id === userId && m.status === "accepted",
      );
      return row ? { rowCount: 1, rows: [{ role: row.role }] } : { rowCount: 0, rows: [] };
    }

    if (text.startsWith("select count(*)::int as n")) {
      const [teamId] = params as [string];
      const n = memberships.filter(
        (m) => m.team_id === teamId && m.role === "owner" && m.status === "accepted",
      ).length;
      return { rowCount: 1, rows: [{ n }] };
    }

    if (text.startsWith("update memberships set role")) {
      const [role, teamId, userId] = params as [string, string, string];
      const member = memberships.find((m) => m.team_id === teamId && m.user_id === userId);
      if (member) member.role = role;
      return { rowCount: member ? 1 : 0, rows: [] };
    }

    if (text.startsWith("delete from memberships")) {
      const [teamId, userId] = params as [string, string];
      const idx = memberships.findIndex((m) => m.team_id === teamId && m.user_id === userId);
      if (idx === -1) return { rowCount: 0, rows: [] };
      memberships.splice(idx, 1);
      return { rowCount: 1, rows: [] };
    }

    throw new Error(`Onverwachte query in test-fake: ${text}`);
  }

  const client = {
    query: async (sql: string, params: unknown[] = []) => handle(sql, params),
    release: () => {},
  } as unknown as PoolClient;

  const db = {
    connect: async () => client,
    query: async (sql: string, params: unknown[] = []) => handle(sql, params),
  } as unknown as Pool;

  return { db, teams, users, memberships, invitations, handle };
}

const inviteInput = { teamId: "team-1", email: "carol@example.com", invitedBy: "u-owner" };

describe("createInvitation", () => {
  let state: ReturnType<typeof fakePool>;

  beforeEach(() => {
    state = fakePool();
  });

  it("maakt een uitnodiging met token en vervaldatum van 7 dagen", async () => {
    const invite = await createInvitation(state.db, { ...inviteInput, role: "member" });

    expect(invite.token).toHaveLength(64);
    expect(invite.email).toBe("carol@example.com");
    expect(invite.role).toBe("member");
    expect(invite.invited_by).toBe("u-owner");

    const expires = new Date(invite.expires_at).getTime();
    const created = Date.now();
    expect(expires - created).toBeGreaterThan(INVITATION_TTL_MS - 5000);
    expect(expires - created).toBeLessThan(INVITATION_TTL_MS + 5000);
    expect(state.invitations).toHaveLength(1);
  });

  it("normaliseert het e-mailadres naar lowercase", async () => {
    const invite = await createInvitation(state.db, {
      ...inviteInput,
      email: "CAROL@Example.COM",
      role: "member",
    });
    expect(invite.email).toBe("carol@example.com");
  });

  it("weigert een tweede openstaande uitnodiging voor hetzelfde adres", async () => {
    await createInvitation(state.db, { ...inviteInput, role: "member" });

    await expect(
      createInvitation(state.db, { ...inviteInput, role: "owner" }),
    ).rejects.toMatchObject({ code: "pending_exists" });
  });

  it("weigert een uitnodiging voor een bestaand lid", async () => {
    await expect(
      createInvitation(state.db, { ...inviteInput, email: "bob@example.com", role: "member" }),
    ).rejects.toMatchObject({ code: "already_member" });
  });

  it("generates tokens die uniek zijn", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
  });
});

describe("acceptInvitation", () => {
  let state: ReturnType<typeof fakePool>;
  let token: string;

  beforeEach(async () => {
    state = fakePool();
    const invite = await createInvitation(state.db, { ...inviteInput, role: "member" });
    token = invite.token;
  });

  it("maakt een membership aan en markeert de uitnodiging als geaccepteerd", async () => {
    const result = await acceptInvitation(state.db, {
      token,
      userId: "u-carol",
      email: "carol@example.com",
    });

    expect(result.status).toBe("accepted");
    expect(result.teamId).toBe("team-1");

    const membership = state.memberships.find(
      (m) => m.user_id === "u-carol" && m.team_id === "team-1",
    );
    expect(membership).toBeDefined();
    expect(membership?.role).toBe("member");
    expect(membership?.status).toBe("accepted");
    expect(membership?.invited_by).toBe("u-owner");
    expect(state.invitations[0].accepted_at).not.toBeNull();
  });

  it("is idempotent: tweede accept geeft al already_accepted", async () => {
    await acceptInvitation(state.db, { token, userId: "u-carol", email: "carol@example.com" });
    const second = await acceptInvitation(state.db, {
      token,
      userId: "u-carol",
      email: "carol@example.com",
    });

    expect(second.status).toBe("already_accepted");
    expect(state.memberships.filter((m) => m.user_id === "u-carol")).toHaveLength(1);
  });

  it("weigert een verlopen uitnodiging", async () => {
    state.invitations[0].expires_at = new Date(Date.now() - 1000).toISOString();

    await expect(
      acceptInvitation(state.db, { token, userId: "u-other", email: "other@example.com" }),
    ).rejects.toMatchObject({ code: "expired" });
  });

  it("weigert accept met een ander e-mailadres dan de uitnodiging", async () => {
    await expect(
      acceptInvitation(state.db, { token, userId: "u-other", email: "someone-else@example.com" }),
    ).rejects.toMatchObject({ code: "email_mismatch" });
  });

  it("weigert een onbekende token", async () => {
    await expect(
      acceptInvitation(state.db, { token: "does-not-exist", userId: "u-other", email: "other@example.com" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("werkt ook als de gebruiker al lid is (on conflict do nothing)", async () => {
    state.memberships.push({
      team_id: "team-1",
      user_id: "u-carol",
      role: "member",
      status: "accepted",
      invited_by: null,
    });

    const result = await acceptInvitation(state.db, {
      token,
      userId: "u-carol",
      email: "carol@example.com",
    });

    expect(result.status).toBe("accepted");
    expect(state.memberships.filter((m) => m.user_id === "u-carol")).toHaveLength(1);
    expect(state.invitations[0].accepted_at).not.toBeNull();
  });
});

describe("getInvitation / listPendingInvitations / deleteInvitation", () => {
  let state: ReturnType<typeof fakePool>;
  let token: string;

  beforeEach(async () => {
    state = fakePool();
    const invite = await createInvitation(state.db, { ...inviteInput, role: "member" });
    token = invite.token;
  });

  it("vindt een uitnodiging op token inclusief teamnaam", async () => {
    const invite = await getInvitation(state.db, token);
    expect(invite).not.toBeNull();
    expect(invite?.team_name).toBe("Anna's team");
    expect(invite?.email).toBe("carol@example.com");
  });

  it("geeft null voor een onbekende token", async () => {
    const invite = await getInvitation(state.db, "nope");
    expect(invite).toBeNull();
  });

  it("toont openstaande uitnodigingen en verbergt geaccepteerde", async () => {
    await acceptInvitation(state.db, { token, userId: "u-carol", email: "carol@example.com" });
    const pending = await listPendingInvitations(state.db, "team-1");
    expect(pending).toHaveLength(0);

    await createInvitation(state.db, { ...inviteInput, email: "dave@example.com", role: "member" });
    const pending2 = await listPendingInvitations(state.db, "team-1");
    expect(pending2).toHaveLength(1);
    expect(pending2[0].email).toBe("dave@example.com");
  });

  it("verwijdert een openstaande uitnodiging", async () => {
    const invite = await getInvitation(state.db, token);
    const deleted = await deleteInvitation(state.db, { teamId: "team-1", invitationId: invite!.id });
    expect(deleted).toBe(true);
    expect(await getInvitation(state.db, token)).toBeNull();
  });

  it("geeft false bij verwijderen van een niet-bestaande uitnodiging", async () => {
    const deleted = await deleteInvitation(state.db, { teamId: "team-1", invitationId: "nope" });
    expect(deleted).toBe(false);
  });
});

describe("updateMemberRole / removeMember (laatste-owner-waarborg)", () => {
  let state: ReturnType<typeof fakePool>;

  beforeEach(() => {
    state = fakePool();
  });

  it("demoteert een member naar owner en omgekeerd", async () => {
    await updateMemberRole(state.db, { teamId: "team-1", userId: "u-member", role: "owner" });
    expect(state.memberships.find((m) => m.user_id === "u-member")?.role).toBe("owner");

    await updateMemberRole(state.db, { teamId: "team-1", userId: "u-member", role: "member" });
    expect(state.memberships.find((m) => m.user_id === "u-member")?.role).toBe("member");
  });

  it("blokkeert demotie van de laatste owner", async () => {
    await expect(
      updateMemberRole(state.db, { teamId: "team-1", userId: "u-owner", role: "member" }),
    ).rejects.toMatchObject({ code: "last_owner" });
  });

  it("staat demotie toe als er twee owners zijn", async () => {
    state.memberships.find((m) => m.user_id === "u-member")!.role = "owner";

    await updateMemberRole(state.db, { teamId: "team-1", userId: "u-owner", role: "member" });
    expect(state.memberships.find((m) => m.user_id === "u-owner")?.role).toBe("member");
  });

  it("blokkeert verwijderen van de laatste owner", async () => {
    await expect(
      removeMember(state.db, { teamId: "team-1", userId: "u-owner" }),
    ).rejects.toMatchObject({ code: "last_owner" });
  });

  it("verwijdert een lid", async () => {
    await removeMember(state.db, { teamId: "team-1", userId: "u-member" });
    expect(state.memberships.filter((m) => m.user_id === "u-member")).toHaveLength(0);
  });

  it("geeft not_found voor een onbekend lid", async () => {
    await expect(
      removeMember(state.db, { teamId: "team-1", userId: "ghost" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("rolwijzigen van een onbekend lid geeft not_found", async () => {
    await expect(
      updateMemberRole(state.db, { teamId: "team-1", userId: "ghost", role: "owner" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("listMembers", () => {
  it("geeft leden met naam en rol, zonder pending", async () => {
    const state = fakePool();
    const members = await listMembers(state.db, "team-1");

    expect(members).toHaveLength(2);
    expect(members.map((m) => m.email)).toEqual(["anna@example.com", "bob@example.com"]);
    expect(members[0].role).toBe("owner");
    expect(members[1].role).toBe("member");
  });
});

describe("InviteError", () => {
  it("heeft een code", () => {
    const err = new InviteError("expired", "verlopen");
    expect(err.code).toBe("expired");
    expect(err.message).toBe("verlopen");
    expect(err).toBeInstanceOf(Error);
  });
});
