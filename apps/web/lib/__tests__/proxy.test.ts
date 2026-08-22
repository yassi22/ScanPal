import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Supabase-sessie is altijd "niet ingelogd": zo bewijzen we dat de webhook-
// bypass werkt zónder cookie, en dat beschermde routes dan wél redirecten.
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}));

import { proxy } from "@/proxy";

const ORIGIN = "http://localhost:3000";

function req(path: string, method = "GET") {
  return new NextRequest(new URL(path, ORIGIN), { method });
}

describe("proxy (auth-middleware)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-1234567890");
  });

  it("laat een Stripe-webhook zonder sessie door (geen 307 naar /login)", async () => {
    const res = await proxy(req("/api/webhooks/stripe", "POST"));
    // NextResponse.next() zet geen Location; een redirect zou dat wel doen.
    expect(res.headers.get("location")).toBeNull();
    expect([200, undefined]).toContain(res.status);
  });

  it("laat GitHub- en Vercel-webhooks eveneens door", async () => {
    for (const path of ["/api/webhooks/github", "/api/webhooks/vercel"]) {
      const res = await proxy(req(path, "POST"));
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("redirect een beschermde route zonder sessie nog steeds naar /login", async () => {
    const res = await proxy(req("/dashboard"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });
});
