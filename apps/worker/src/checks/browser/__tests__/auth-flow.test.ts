import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAuthFlowCheck } from "../auth-flow";
import type { AuthFlowCapture, AuthCredentials } from "@scanpal/shared";
import type { BrowserRunner, AuthFlowRunResult } from "../runner";
import type { CheckContext } from "../../types";

const CREDENTIALS: AuthCredentials = {
  login_url: "https://example.com/login",
  username: "tester@example.com",
  password: "disposable-pass",
};

function ctx(over: Partial<CheckContext> = {}): CheckContext {
  return {
    url: "https://example.com/",
    scanId: "scan-1",
    activeTests: true,
    ownershipVerified: true,
    authCredentials: CREDENTIALS,
    rateLimit: vi.fn().mockResolvedValue({ ok: true }) as never,
    ...over,
  };
}

function makeRunner(result: AuthFlowRunResult): BrowserRunner {
  return {
    captureVitals: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    runAxe: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    captureConsole: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    captureResponsive: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    captureRenderCompare: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    captureStorage: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    captureClientDeps: vi.fn().mockResolvedValue({ ok: false, error: "unused" }),
    captureAuthFlow: vi.fn().mockResolvedValue(result),
  };
}

function capture(over: Partial<AuthFlowCapture> = {}): AuthFlowCapture {
  return {
    forms: [],
    reset_probe: null,
    rate_limit_attempts: [],
    password_policy: null,
    session: null,
    mfa: null,
    errors: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createAuthFlowCheck — gating", () => {
  it("retourneert [] wanneer activeTests uit staat", async () => {
    const runner = makeRunner({ ok: true, capture: capture() });
    const check = createAuthFlowCheck(runner);
    const result = await check.run(ctx({ activeTests: false }));
    expect(result).toEqual([]);
    expect(runner.captureAuthFlow).not.toHaveBeenCalled();
  });

  it("slaat over met 7 info-findingen wanneer ownership niet geverifieerd is", async () => {
    const runner = makeRunner({ ok: true, capture: capture() });
    const check = createAuthFlowCheck(runner);
    const result = await check.run(ctx({ ownershipVerified: false }));
    expect(result).toHaveLength(7);
    expect(result.every((f) => f.status === "info")).toBe(true);
    expect(result.every((f) => f.active === true)).toBe(true);
    expect(result[0]!.detail).toContain("eigendom");
    expect(runner.captureAuthFlow).not.toHaveBeenCalled();
  });

  it("slaat over met 7 info-findingen wanneer er geen test-account is", async () => {
    const runner = makeRunner({ ok: true, capture: capture() });
    const check = createAuthFlowCheck(runner);
    const result = await check.run(ctx({ authCredentials: null }));
    expect(result).toHaveLength(7);
    expect(result.every((f) => f.status === "info")).toBe(true);
    expect(result[0]!.detail).toContain("test-account");
    expect(runner.captureAuthFlow).not.toHaveBeenCalled();
  });

  it("slaat over bij rate-limit", async () => {
    const rateLimit = vi.fn().mockResolvedValue({ ok: false, retryAfterSeconds: 30 });
    const runner = makeRunner({ ok: true, capture: capture() });
    const check = createAuthFlowCheck(runner);
    const result = await check.run(ctx({ rateLimit: rateLimit as never }));
    expect(result).toHaveLength(7);
    expect(result.every((f) => f.status === "info")).toBe(true);
    expect(result[0]!.detail).toContain("rate-limit");
    expect(runner.captureAuthFlow).not.toHaveBeenCalled();
  });

  it("slaat over bij een browser-capture-fout (geen storing)", async () => {
    const runner = makeRunner({ ok: false, error: "page timeout" });
    const check = createAuthFlowCheck(runner);
    const result = await check.run(ctx());
    expect(result).toHaveLength(7);
    expect(result.every((f) => f.status === "info")).toBe(true);
    expect(result[0]!.detail).toContain("mislukt");
  });
});

describe("createAuthFlowCheck — findings uit een capture", () => {
  it("produceert precies 7 findings met active:true", async () => {
    const runner = makeRunner({ ok: true, capture: capture() });
    const check = createAuthFlowCheck(runner);
    const result = await check.run(ctx());
    expect(result).toHaveLength(7);
    expect(result.every((f) => f.active === true)).toBe(true);
    const ids = result.map((f) => f.id);
    expect(ids).toContain("auth-transport");
    expect(ids).toContain("auth-csrf");
    expect(ids).toContain("auth-user-enumeration");
    expect(ids).toContain("auth-rate-limit");
    expect(ids).toContain("auth-password-policy");
    expect(ids).toContain("auth-session-security");
    expect(ids).toContain("auth-mfa");
  });

  it("auth-transport: warn bij een onveilige auth-pagina", async () => {
    const runner = makeRunner({
      ok: true,
      capture: capture({
        forms: [
          { url: "http://example.com/login", kind: "login", https: false, password_autocomplete: "current-password", csrf_token: true },
        ],
      }),
    });
    const check = createAuthFlowCheck(runner);
    const result = await check.run(ctx());
    const transport = result.find((f) => f.id === "auth-transport")!;
    expect(transport.status).toBe("warn");
    expect(transport.detail).toContain("HTTPS");
  });

  it("auth-transport: warn bij verkeerde autocomplete", async () => {
    const runner = makeRunner({
      ok: true,
      capture: capture({
        forms: [
          { url: "https://example.com/login", kind: "login", https: true, password_autocomplete: "off", csrf_token: true },
        ],
      }),
    });
    const check = createAuthFlowCheck(runner);
    const result = await check.run(ctx());
    const transport = result.find((f) => f.id === "auth-transport")!;
    expect(transport.status).toBe("warn");
    expect(transport.detail).toContain("autocomplete");
  });

  it("auth-csrf: warn bij een formulier zonder CSRF-token", async () => {
    const runner = makeRunner({
      ok: true,
      capture: capture({
        forms: [
          { url: "https://example.com/login", kind: "login", https: true, password_autocomplete: "current-password", csrf_token: false },
        ],
      }),
    });
    const check = createAuthFlowCheck(runner);
    const result = await check.run(ctx());
    const csrf = result.find((f) => f.id === "auth-csrf")!;
    expect(csrf.status).toBe("warn");
    expect(csrf.detail).toContain("CSRF");
  });

  it("auth-user-enumeration: warn bij verschillende reset-status", async () => {
    const runner = makeRunner({
      ok: true,
      capture: capture({
        reset_probe: {
          nonexistent: { status: 404, body: "not found", duration_ms: 100 },
          known: { status: 200, body: "ok", duration_ms: 100 },
        },
      }),
    });
    const check = createAuthFlowCheck(runner);
    const result = await check.run(ctx());
    const enumFinding = result.find((f) => f.id === "auth-user-enumeration")!;
    expect(enumFinding.status).toBe("warn");
    expect(enumFinding.evidence).not.toBeNull();
  });

  it("auth-user-enumeration: pass bij uniforme reset-respons", async () => {
    const runner = makeRunner({
      ok: true,
      capture: capture({
        reset_probe: {
          nonexistent: { status: 200, body: "reset sent", duration_ms: 100 },
          known: { status: 200, body: "reset sent", duration_ms: 110 },
        },
      }),
    });
    const check = createAuthFlowCheck(runner);
    const result = await check.run(ctx());
    const enumFinding = result.find((f) => f.id === "auth-user-enumeration")!;
    expect(enumFinding.status).toBe("pass");
  });

  it("auth-rate-limit: pass bij lockout binnen de burst", async () => {
    const runner = makeRunner({
      ok: true,
      capture: capture({
        rate_limit_attempts: [
          { status: 401, body: "bad", locked: false },
          { status: 423, body: "locked", locked: true },
        ],
      }),
    });
    const check = createAuthFlowCheck(runner);
    const result = await check.run(ctx());
    const rl = result.find((f) => f.id === "auth-rate-limit")!;
    expect(rl.status).toBe("pass");
    expect(rl.detail).toContain("lockout");
  });

  it("auth-rate-limit: warn zonder lockout", async () => {
    const runner = makeRunner({
      ok: true,
      capture: capture({
        rate_limit_attempts: [
          { status: 401, body: "bad", locked: false },
          { status: 401, body: "bad", locked: false },
          { status: 401, body: "bad", locked: false },
        ],
      }),
    });
    const check = createAuthFlowCheck(runner);
    const result = await check.run(ctx());
    const rl = result.find((f) => f.id === "auth-rate-limit")!;
    expect(rl.status).toBe("warn");
  });

  it("auth-password-policy: warn bij geaccepteerd zwak wachtwoord", async () => {
    const runner = makeRunner({
      ok: true,
      capture: capture({
        password_policy: { accepted: true, validation_message: "" },
      }),
    });
    const check = createAuthFlowCheck(runner);
    const result = await check.run(ctx());
    const policy = result.find((f) => f.id === "auth-password-policy")!;
    expect(policy.status).toBe("warn");
    expect(policy.detail).toContain("123456");
  });

  it("auth-password-policy: pass bij afgewezen zwak wachtwoord", async () => {
    const runner = makeRunner({
      ok: true,
      capture: capture({
        password_policy: { accepted: false, validation_message: "too weak" },
      }),
    });
    const check = createAuthFlowCheck(runner);
    const result = await check.run(ctx());
    const policy = result.find((f) => f.id === "auth-password-policy")!;
    expect(policy.status).toBe("pass");
  });

  it("auth-session-security: warn bij session-fixatie", async () => {
    const runner = makeRunner({
      ok: true,
      capture: capture({
        session: {
          logged_in: true,
          cookies: [{ name: "session", secure: true, http_only: true, same_site: "lax" }],
          session_id_before: "abc",
          session_id_after: "abc",
        },
      }),
    });
    const check = createAuthFlowCheck(runner);
    const result = await check.run(ctx());
    const sess = result.find((f) => f.id === "auth-session-security")!;
    expect(sess.status).toBe("warn");
    expect(sess.detail).toContain("fixatie");
  });

  it("auth-session-security: warn bij ontbrekende cookie-flags", async () => {
    const runner = makeRunner({
      ok: true,
      capture: capture({
        session: {
          logged_in: true,
          cookies: [{ name: "session", secure: false, http_only: false, same_site: "" }],
          session_id_before: "abc",
          session_id_after: "xyz",
        },
      }),
    });
    const check = createAuthFlowCheck(runner);
    const result = await check.run(ctx());
    const sess = result.find((f) => f.id === "auth-session-security")!;
    expect(sess.status).toBe("warn");
    expect(sess.detail).toContain("Secure");
  });

  it("auth-session-security: info (geen pass) wanneer de login niet slaagde", async () => {
    // Regressie: een stil mislukte login levert lege cookies + logged_in:false;
    // dat mag GEEN "sessie veilig"-pass worden.
    const runner = makeRunner({
      ok: true,
      capture: capture({
        session: {
          logged_in: false,
          cookies: [],
          session_id_before: null,
          session_id_after: null,
        },
      }),
    });
    const check = createAuthFlowCheck(runner);
    const result = await check.run(ctx());
    const sess = result.find((f) => f.id === "auth-session-security")!;
    expect(sess.status).toBe("info");
    expect(sess.evidence).toBeNull();
  });

  it("auth-mfa: warn wanneer MFA beschikbaar maar niet afgedwongen", async () => {
    const runner = makeRunner({
      ok: true,
      capture: capture({
        mfa: { available: true, enforced: false, signal: "enable 2FA" },
      }),
    });
    const check = createAuthFlowCheck(runner);
    const result = await check.run(ctx());
    const mfa = result.find((f) => f.id === "auth-mfa")!;
    expect(mfa.status).toBe("warn");
    expect(mfa.detail).toContain("niet afgedwongen");
  });

  it("auth-mfa: pass wanneer MFA afgedwongen is", async () => {
    const runner = makeRunner({
      ok: true,
      capture: capture({
        mfa: { available: true, enforced: true, signal: "TOTP required" },
      }),
    });
    const check = createAuthFlowCheck(runner);
    const result = await check.run(ctx());
    const mfa = result.find((f) => f.id === "auth-mfa")!;
    expect(mfa.status).toBe("pass");
  });

  it("kapt evidence af boven de grens", async () => {
    const longSignal = "x".repeat(10_000);
    const runner = makeRunner({
      ok: true,
      capture: capture({
        mfa: { available: true, enforced: false, signal: longSignal },
      }),
    });
    const check = createAuthFlowCheck(runner);
    const result = await check.run(ctx());
    const mfa = result.find((f) => f.id === "auth-mfa")!;
    const evidence = mfa.evidence as { request: string; response: string };
    expect(evidence.response.length).toBe(4097);
    expect(evidence.response.endsWith("…")).toBe(true);
  });
});
