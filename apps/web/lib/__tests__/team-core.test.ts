import { describe, it, expect, beforeEach } from "vitest";
import { ensureUserTeam } from "../../lib/team-core";
import type { Pool, PoolClient, QueryResult } from "pg";

type Row = Record<string, unknown>;
type QueryResultLike = Partial<QueryResult<Row>>;

function fakePool() {
  let teamSeq = 0;
  const teams: { id: string; name: string }[] = [];
  const memberships: { team_id: string; user_id: string; role: string; status: string }[] = [];
  const users: { id: string; email: string; name: string | null; onboarding_completed_at: Date | null }[] = [];

  function handle(sql: string, params: unknown[]): QueryResultLike {
    const text = sql.replace(/\s+/g, " ").trim();

    if (text.startsWith("insert into users")) {
      const [id, email, name] = params as [string, string, string | null];
      const existing = users.find((u) => u.id === id);
      if (existing) {
        existing.email = email;
        existing.name = name ?? existing.name;
      } else {
        users.push({ id, email, name, onboarding_completed_at: null });
      }
      return { rowCount: 1, rows: [] };
    }

    if (text.startsWith("select team_id, role, status from memberships")) {
      const [userId] = params;
      const rows = memberships
        .filter((m) => m.user_id === userId)
        .map((m) => ({ ...m }));
      return { rowCount: rows.length, rows };
    }

    if (text.startsWith("insert into teams")) {
      const [name] = params as [string];
      const id = `team-${++teamSeq}`;
      teams.push({ id, name });
      return { rowCount: 1, rows: [{ id }] };
    }

    if (text.startsWith("insert into memberships")) {
      const [teamId, userId] = params as [string, string];
      memberships.push({ team_id: teamId, user_id: userId, role: "owner", status: "accepted" });
      return { rowCount: 1, rows: [] };
    }

    if (text.startsWith("select id, name from teams")) {
      const [id] = params;
      const rows = teams.filter((t) => t.id === id).map((t) => ({ ...t }));
      return { rowCount: rows.length, rows };
    }

    if (text.startsWith("select id, email, onboarding_completed_at from users")) {
      const [id] = params;
      const rows = users
        .filter((u) => u.id === id)
        .map((u) => ({ ...u }));
      return { rowCount: rows.length, rows };
    }

    if (text === "begin" || text === "commit" || text === "rollback") {
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

  return { db, teams, memberships, users, handle };
}

describe("ensureUserTeam", () => {
  let state: ReturnType<typeof fakePool>;

  beforeEach(() => {
    state = fakePool();
  });

  const user = {
    id: "11111111-1111-1111-1111-111111111111",
    email: "anna@example.com",
    name: "Anna",
  };

  it("maakt bij eerste login een team met owner-membership", async () => {
    const result = await ensureUserTeam(state.db, user);

    expect(result.team.name).toBe("Anna's team");
    expect(result.membership.role).toBe("owner");
    expect(state.teams).toHaveLength(1);
    expect(state.memberships).toHaveLength(1);
    expect(state.memberships[0].role).toBe("owner");
    expect(result.user.id).toBe(user.id);
  });

  it("is idempotent: tweede login maakt geen nieuw team", async () => {
    const first = await ensureUserTeam(state.db, user);
    const second = await ensureUserTeam(state.db, user);

    expect(state.teams).toHaveLength(1);
    expect(state.memberships).toHaveLength(1);
    expect(second.team.id).toBe(first.team.id);
    expect(second.membership.role).toBe("owner");
  });

  it("gebruikt 'Mijn team' als de gebruiker geen naam heeft", async () => {
    const result = await ensureUserTeam(state.db, {
      ...user,
      name: null,
    });

    expect(result.team.name).toBe("Mijn team");
  });

  it("gooit door bij een fout en rolt de transactie terug", async () => {
    const client = {
      query: async (sql: string, params: unknown[] = []) => {
        const text = sql.replace(/\s+/g, " ").trim();
        if (text.startsWith("insert into teams")) {
          throw new Error("boom");
        }
        return state.handle(sql, params);
      },
      release: () => {},
    } as unknown as PoolClient;

    const broken = {
      connect: async () => client,
    } as unknown as Pool;

    await expect(ensureUserTeam(broken, user)).rejects.toThrow("boom");
    expect(state.teams).toHaveLength(0);
  });
});
