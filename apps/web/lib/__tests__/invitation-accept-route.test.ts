import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/invitations/[token]/accept/route";
import { getSessionUser } from "@/lib/supabase/server";
import { acceptInvitation, InviteError } from "@/lib/invites-core";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  pool: { query: vi.fn() },
}));
vi.mock("@/lib/supabase/server", () => ({
  getSessionUser: vi.fn(),
}));
vi.mock("@/lib/invites-core", async () => {
  const actual = await vi.importActual<typeof import("@/lib/invites-core")>(
    "@/lib/invites-core",
  );
  return {
    ...actual,
    acceptInvitation: vi.fn(),
  };
});

const getSessionUserMock = vi.mocked(getSessionUser);
const acceptInvitationMock = vi.mocked(acceptInvitation);

const TOKEN = "a".repeat(64);
const USER = { id: "u-carol", email: "carol@example.com", user_metadata: {}, app_metadata: {} };

function acceptRequest(): Promise<Response> {
  const request = new NextRequest(`http://localhost/api/invitations/${TOKEN}/accept`, {
    method: "POST",
  });
  return POST(request, { params: Promise.resolve({ token: TOKEN }) });
}

beforeEach(() => {
  getSessionUserMock.mockReset();
  acceptInvitationMock.mockReset();
  getSessionUserMock.mockResolvedValue(USER as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/invitations/:token/accept (plan 64 stap 2 — seat-limiet)", () => {
  it("geeft 409 (zonder upsell) terug wanneer de ledenlimiet is bereikt", async () => {
    acceptInvitationMock.mockRejectedValue(
      new InviteError("member_limit", "De ledenlimiet van dit plan (3) is bereikt."),
    );

    const res = await acceptRequest();
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data).toEqual({ error: "De ledenlimiet van dit plan (3) is bereikt." });
    expect(data.upsell).toBeUndefined();
  });

  it("geeft 200 terug bij een succesvolle accept (ongewijzigd gedrag)", async () => {
    acceptInvitationMock.mockResolvedValue({ status: "accepted", teamId: "team-1" });

    const res = await acceptRequest();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({ status: "accepted", teamId: "team-1" });
  });
});
