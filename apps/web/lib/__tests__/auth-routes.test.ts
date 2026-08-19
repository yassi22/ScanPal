import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as magicLinkPOST } from "@/app/api/auth/magic-link/route";
import { GET as callbackGET } from "@/app/api/auth/callback/route";
import { POST as logoutPOST } from "@/app/api/auth/logout/route";
import { GET as meGET } from "@/app/api/me/route";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { ensureUserTeam, getOrCreateUserTeam } from "@/lib/team";
import { pool } from "@/lib/db";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  getSessionUser: vi.fn(),
}));
vi.mock("@/lib/team", () => ({
  ensureUserTeam: vi.fn(),
  getOrCreateUserTeam: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  pool: { query: vi.fn() },
}));
vi.mock("@/lib/env", () => ({
  env: { appUrl: "http://localhost:3000" },
}));

const createClientMock = vi.mocked(createClient);
const getUserMock = vi.mocked(getSessionUser);
const ensureTeamMock = vi.mocked(ensureUserTeam);
const teamContextMock = vi.mocked(getOrCreateUserTeam);

const USER = {
  id: "user-1",
  email: "a@b.nl",
  user_metadata: {},
  app_metadata: {},
};

function teamResult(overrides: Record<string, unknown> = {}) {
  return {
    team: { id: "team-1", name: "Anna's team" },
    membership: {
      team_id: "team-1",
      user_id: "user-1",
      role: "owner",
      status: "accepted",
    },
    user: {
      id: "user-1",
      email: "a@b.nl",
      onboarding_completed_at: null,
    },
    ...overrides,
  };
}

function mockSupabase(
  exchangeResult:
    | { data?: { user: typeof USER }; error: unknown }
    | undefined = undefined,
) {
  const supabase = {
    auth: {
      signInWithOtp: vi.fn(),
      exchangeCodeForSession: vi.fn().mockResolvedValue(
        exchangeResult ?? { data: { user: USER }, error: null },
      ),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  };
  createClientMock.mockResolvedValue(supabase as never);
  return supabase;
}

function callbackRequest(url: string): NextRequest {
  return new NextRequest(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue(USER as never);
  ensureTeamMock.mockResolvedValue(teamResult() as never);
  teamContextMock.mockResolvedValue(teamResult() as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/auth/magic-link", () => {
  it("200 en stuurt een OTP bij een geldig e-mailadres", async () => {
    const supabase = mockSupabase();
    supabase.auth.signInWithOtp.mockResolvedValue({ error: null });

    const response = await magicLinkPOST(
      new Request("http://localhost/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "a@b.nl" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "a@b.nl",
      options: {
        emailRedirectTo: "http://localhost:3000/api/auth/callback",
        shouldCreateUser: true,
      },
    });
  });

  it("400 bij een ongeldig e-mailadres (geen OTP-aanroep)", async () => {
    const supabase = mockSupabase();

    const response = await magicLinkPOST(
      new Request("http://localhost/api/auth/magic-link", {
        method: "POST",
        body: JSON.stringify({ email: "geen-email" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(supabase.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("400 bij een lege body", async () => {
    const response = await magicLinkPOST(
      new Request("http://localhost/api/auth/magic-link", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("429 bij het Supabase rate-limit (`over_email_send_rate_limit`)", async () => {
    const supabase = mockSupabase();
    supabase.auth.signInWithOtp.mockResolvedValue({
      error: { code: "over_email_send_rate_limit", message: "rate limited" },
    });

    const response = await magicLinkPOST(
      new Request("http://localhost/api/auth/magic-link", {
        method: "POST",
        body: JSON.stringify({ email: "a@b.nl" }),
      }),
    );

    expect(response.status).toBe(429);
  });

  it("500 bij een andere Supabase-fout", async () => {
    const supabase = mockSupabase();
    supabase.auth.signInWithOtp.mockResolvedValue({
      error: { code: "some_error", message: "kapot" },
    });

    const response = await magicLinkPOST(
      new Request("http://localhost/api/auth/magic-link", {
        method: "POST",
        body: JSON.stringify({ email: "a@b.nl" }),
      }),
    );

    expect(response.status).toBe(500);
  });
});

describe("GET /api/auth/callback", () => {
  it("wisselt de code in en stuurt door naar `next` (relatief)", async () => {
    const supabase = mockSupabase();
    supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { user: USER }, error: null });

    const response = await callbackGET(
      callbackRequest("http://localhost/api/auth/callback?code=abc&next=/dashboard/sites"),
    );

    expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(ensureTeamMock).toHaveBeenCalledWith(
      pool,
      {
        id: "user-1",
        email: "a@b.nl",
        name: null,
        avatar_url: null,
        auth_provider: null,
      },
      { recordLogin: true },
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/dashboard/sites");
  });

  it("accepteert ook `token` als fallback voor `code`", async () => {
    const supabase = mockSupabase();
    supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { user: USER }, error: null });

    const response = await callbackGET(
      callbackRequest("http://localhost/api/auth/callback?token=xyz"),
    );

    expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith("xyz");
    expect(response.headers.get("location")).toBe("http://localhost/dashboard");
  });

  it("open-redirect-hardening: absolute `next`-URL → /dashboard", async () => {
    const supabase = mockSupabase();
    supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { user: USER }, error: null });

    const response = await callbackGET(
      callbackRequest("http://localhost/api/auth/callback?code=abc&next=https://evil.example/phish"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/dashboard");
  });

  it("open-redirect-hardening: protocol-relative `next` (`//`) → /dashboard", async () => {
    const supabase = mockSupabase();
    supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { user: USER }, error: null });

    const response = await callbackGET(
      callbackRequest("http://localhost/api/auth/callback?code=abc&next=//evil.example"),
    );

    expect(response.headers.get("location")).toBe("http://localhost/dashboard");
  });

  it("open-redirect-hardening: lege `next` → /dashboard", async () => {
    const supabase = mockSupabase();
    supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { user: USER }, error: null });

    const response = await callbackGET(
      callbackRequest("http://localhost/api/auth/callback?code=abc&next="),
    );

    expect(response.headers.get("location")).toBe("http://localhost/dashboard");
  });

  it("mislukte code-wissel → /login?error=auth zonder crash", async () => {
    const supabase = mockSupabase();
    supabase.auth.exchangeCodeForSession.mockResolvedValue({
      error: { code: "bad_code", message: "ongeldig" },
    });

    const response = await callbackGET(
      callbackRequest("http://localhost/api/auth/callback?code=kapot"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login?error=auth");
  });

  it("zonder code of token → /login?error=auth", async () => {
    const response = await callbackGET(
      callbackRequest("http://localhost/api/auth/callback?next=/dashboard"),
    );

    expect(response.headers.get("location")).toBe("http://localhost/login?error=auth");
  });
});

describe("POST /api/auth/logout", () => {
  it("tekent uit en stuurt door naar /login", async () => {
    const supabase = mockSupabase();

    const response = await logoutPOST();

    expect(supabase.auth.signOut).toHaveBeenCalled();
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
  });
});

describe("GET /api/me", () => {
  it("401 zonder sessie", async () => {
    getUserMock.mockResolvedValue(null as never);
    const response = await meGET();
    expect(response.status).toBe(401);
    expect(teamContextMock).not.toHaveBeenCalled();
  });

  it("nieuwe user → team + owner-membership via de read-first teamcontext", async () => {
    const response = await meGET();

    expect(response.status).toBe(200);
    expect(teamContextMock).toHaveBeenCalledWith(pool, {
      id: "user-1",
      email: "a@b.nl",
      name: null,
      avatar_url: null,
      auth_provider: null,
    });
    const body = await response.json();
    expect(body.user).toMatchObject({ id: "user-1", email: "a@b.nl" });
    expect(body.team).toMatchObject({ id: "team-1" });
    expect(body.membership).toMatchObject({ role: "owner" });
    expect(body.onboarding_completed).toBe(false);
  });

  it("onboarding-completed vlag aan zodra die gezet is", async () => {
    teamContextMock.mockResolvedValue(
      teamResult({
        user: { id: "user-1", email: "a@b.nl", onboarding_completed_at: new Date("2026-08-16T08:00:00Z") },
      }) as never,
    );

    const response = await meGET();
    const body = await response.json();
    expect(body.onboarding_completed).toBe(true);
    expect(body.user.onboarding_completed_at).toBe("2026-08-16T08:00:00.000Z");
  });

  it("geeft de naam van de OAuth-provider door aan de teamcontext", async () => {
    getUserMock.mockResolvedValue({
      ...USER,
      user_metadata: { full_name: "Anna Jansen", avatar_url: "https://img/x.png" },
      app_metadata: { provider: "google" },
    } as never);

    await meGET();

    expect(teamContextMock).toHaveBeenCalledWith(pool, {
      id: "user-1",
      email: "a@b.nl",
      name: "Anna Jansen",
      avatar_url: "https://img/x.png",
      auth_provider: "google",
    });
  });
});
