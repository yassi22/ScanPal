import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { baasSecurityCheck } from "../baas-security";
import type { CheckContext } from "../../types";

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function jsResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/javascript" },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function okRateLimit() {
  return vi.fn().mockResolvedValue({ ok: true });
}

type RouteHandler = (url: string, opts?: { headers?: Record<string, string> }) => Response;

function makeFetch(routes: Record<string, RouteHandler> | ((url: string, opts?: { headers?: Record<string, string> }) => Response)) {
  return vi.fn(async (url: string, opts?: { headers?: Record<string, string> }) => {
    if (typeof routes === "function") return routes(url, opts);
    // Match longest prefix first.
    const key = Object.keys(routes).sort((a, b) => b.length - a.length).find((k) => url.startsWith(k));
    if (key) return routes[key](url, opts);
    return new Response("Not found", { status: 404 });
  });
}

function ctx(fetchImpl: ReturnType<typeof makeFetch>, rateLimit = okRateLimit()): CheckContext {
  return {
    url: "https://example.com/",
    scanId: "scan-1",
    activeTests: false,
    rateLimit: rateLimit as never,
    fetchPage: fetchImpl as never,
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("no global fetch", { status: 500 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("baas-security check (plan 74)", () => {
  it("Supabase open schema (zonder key) → high/fail", async () => {
    const fetchImpl = makeFetch({
      "https://example.com/": () => htmlResponse(`<script src="/app.js"></script>`),
      "https://example.com/app.js": () =>
        jsResponse(`createClient("https://abcdefgh.supabase.co", "sb_publishable_${"A".repeat(40)}");`),
      "https://abcdefgh.supabase.co/rest/v1/": () =>
        jsonResponse({ definitions: { users: {}, posts: {} } }),
    });
    const results = await baasSecurityCheck.run(ctx(fetchImpl));
    const supa = results.find((r) => r.id === "supabase-security")!;
    expect(supa).toBeDefined();
    expect(supa.status).toBe("fail");
    expect(supa.severity).toBe("high");
    expect(supa.detail).toContain("tabelnamen lekken");
    // Evidence bevat de project-URL maar geen ruwe key.
    const evidence = supa.evidence as { fingerprints: { project_url: string }[] };
    expect(evidence.fingerprints[0].project_url).toBe("https://abcdefgh.supabase.co");
    expect(JSON.stringify(evidence)).not.toContain("sb_publishable_");
  });

  it("Supabase beschermd (401 zonder anon-key) → info", async () => {
    const fetchImpl = makeFetch({
      "https://example.com/": () => htmlResponse(`<script>fetch("https://prot.supabase.co/rest/v1/");</script>`),
      "https://prot.supabase.co/rest/v1/": () => new Response("unauthorized", { status: 401 }),
    });
    const results = await baasSecurityCheck.run(ctx(fetchImpl));
    const supa = results.find((r) => r.id === "supabase-security")!;
    expect(supa.status).toBe("info");
    expect(supa.severity).toBe("info");
  });

  it("Firebase open Realtime DB (.json → 200) → high/fail", async () => {
    const fetchImpl = makeFetch({
      "https://example.com/": () =>
        htmlResponse(`const firebaseConfig = { projectId: "myapp", databaseURL: "https://myapp.firebaseio.com" };`),
      "https://myapp.firebaseio.com/.json": () => jsonResponse({ users: true }),
    });
    const results = await baasSecurityCheck.run(ctx(fetchImpl));
    const fb = results.find((r) => r.id === "firebase-security")!;
    expect(fb).toBeDefined();
    expect(fb.status).toBe("fail");
    expect(fb.severity).toBe("high");
    expect(fb.detail).toContain("Realtime Database");
  });

  it("Firebase beschermd (.json → 401) → info", async () => {
    const fetchImpl = makeFetch({
      "https://example.com/": () =>
        htmlResponse(`const firebaseConfig = { projectId: "protapp", databaseURL: "https://protapp.firebaseio.com" };`),
      "https://protapp.firebaseio.com/.json": () => new Response("unauthorized", { status: 401 }),
    });
    const results = await baasSecurityCheck.run(ctx(fetchImpl));
    const fb = results.find((r) => r.id === "firebase-security")!;
    expect(fb.status).toBe("info");
    expect(fb.severity).toBe("info");
  });

  it("Firebase open Storage bucket → high/fail", async () => {
    const fetchImpl = makeFetch({
      "https://example.com/": () =>
        htmlResponse(`const firebaseConfig = { projectId: "storeapp", storageBucket: "storeapp.appspot.com" };`),
      "https://storeapp.firebaseio.com/.json": () => new Response("unauthorized", { status: 401 }),
      "https://firebasestorage.googleapis.com/v0/b/storeapp.appspot.com/o": () =>
        jsonResponse({ items: [{ name: "a" }, { name: "b" }] }),
    });
    const results = await baasSecurityCheck.run(ctx(fetchImpl));
    const fb = results.find((r) => r.id === "firebase-security")!;
    expect(fb.status).toBe("fail");
    expect(fb.severity).toBe("high");
    expect(fb.detail).toContain("Storage");
  });

  it("Convex open functies → low/warn", async () => {
    const fetchImpl = makeFetch({
      "https://example.com/": () => htmlResponse(`const url = "https://happy-123.convex.cloud";`),
      "https://happy-123.convex.cloud/api/list_functions": () =>
        jsonResponse({ functions: [{ name: "a" }, { name: "b" }, { name: "c" }] }),
    });
    const results = await baasSecurityCheck.run(ctx(fetchImpl));
    const cvx = results.find((r) => r.id === "convex-security")!;
    expect(cvx).toBeDefined();
    expect(cvx.status).toBe("warn");
    expect(cvx.severity).toBe("low");
  });

  it("Convex beschermd (404) → info", async () => {
    const fetchImpl = makeFetch({
      "https://example.com/": () => htmlResponse(`const url = "https://prot-123.convex.cloud";`),
      "https://prot-123.convex.cloud/api/list_functions": () => new Response("nf", { status: 404 }),
    });
    const results = await baasSecurityCheck.run(ctx(fetchImpl));
    const cvx = results.find((r) => r.id === "convex-security")!;
    expect(cvx.status).toBe("info");
  });

  it("geen BaaS-platform → lege findings", async () => {
    const fetchImpl = makeFetch({
      "https://example.com/": () => htmlResponse(`<html><body>gewone site</body></html>`),
    });
    const results = await baasSecurityCheck.run(ctx(fetchImpl));
    expect(results).toEqual([]);
  });

  it("geen HTML-pagina → lege findings (niet controleerbaar)", async () => {
    const fetchImpl = makeFetch({
      "https://example.com/": () => jsonResponse({ ok: true }),
    });
    const results = await baasSecurityCheck.run(ctx(fetchImpl));
    expect(results).toEqual([]);
  });

  it("gebruikt per-host rate-limit voor probes", async () => {
    const rate = okRateLimit();
    const fetchImpl = makeFetch({
      "https://example.com/": () => htmlResponse(`fetch("https://rl.supabase.co/rest/v1/");`),
      "https://rl.supabase.co/rest/v1/": () => new Response("unauthorized", { status: 401 }),
    });
    await baasSecurityCheck.run(ctx(fetchImpl, rate));
    expect(rate).toHaveBeenCalledWith("baas-probe:rl.supabase.co", expect.any(Number));
  });

  it("past per-host rate-limit toe op bundel-downloads (zelfde key als secrets-in-bundles)", async () => {
    const rate = okRateLimit();
    const fetchImpl = makeFetch({
      "https://example.com/": () => htmlResponse(`<script src="/app.js"></script>`),
      "https://example.com/app.js": () =>
        jsResponse(`createClient("https://abcdefgh.supabase.co", "sb_publishable_${"A".repeat(40)}");`),
      "https://abcdefgh.supabase.co/rest/v1/": () => new Response("unauthorized", { status: 401 }),
    });
    await baasSecurityCheck.run(ctx(fetchImpl, rate));
    // Bundle-download deelt de `bundle-scan:<host>`-key met secrets-in-bundles.
    expect(rate).toHaveBeenCalledWith("bundle-scan:example.com", expect.any(Number));
  });

  it("globaal probe-budget: resterende fingerprints als info (niet geprobed)", async () => {
    // 4 Supabase-projecten → cap is 3, maar budget (9) ruim; de 4e wordt niet
    // geprobed (per-platform cap) en gerapporteerd als not_probed.
    const fetchImpl = makeFetch((url) => {
      if (url === "https://example.com/") {
        return htmlResponse(
          `https://p1.supabase.co https://p2.supabase.co https://p3.supabase.co https://p4.supabase.co`,
        );
      }
      if (/^https:\/\/p[1-3]\.supabase\.co\/rest\/v1\//.test(url)) {
        return new Response("unauthorized", { status: 401 });
      }
      return new Response("nf", { status: 404 });
    });
    const results = await baasSecurityCheck.run(ctx(fetchImpl));
    const supa = results.find((r) => r.id === "supabase-security")!;
    expect(supa.status).toBe("info");
    const evidence = supa.evidence as { fingerprints: { project_url: string }[] };
    expect(evidence.fingerprints.map((f) => f.project_url)).toContain("https://p4.supabase.co");
  });
});
