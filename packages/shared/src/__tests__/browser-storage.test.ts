import { describe, it, expect } from "vitest";
import {
  classifyStorageEntry,
  classifyStorage,
  storageEntrySeverity,
  decodeJwtMeta,
  type StorageSnapshot,
} from "../browser-storage";

// Een geldige JWT met exp in de verre toekomst (header {"alg":"HS256"}, payload
// {"exp": 9999999999}). Handgemaakt: header.payload.sig.
const JWT_FAR = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjk5OTk5OTk5OTl9.sig1234567890ab";
// JWT zonder exp.
const JWT_NO_EXP = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig1234567890ab";

function makeJwt(exp?: number): string {
  const header = btoa(JSON.stringify({ alg: "HS256" }));
  const payload = btoa(JSON.stringify(exp !== undefined ? { exp } : { sub: "x" }));
  return `${header}.${payload}.sig1234567890ab`;
}

describe("decodeJwtMeta", () => {
  it("decodeert alg en exp", () => {
    const jwt = makeJwt(9999999999);
    const meta = decodeJwtMeta(jwt);
    expect(meta).not.toBeNull();
    expect(meta!.alg).toBe("HS256");
    expect(meta!.exp_present).toBe(true);
  });

  it("null voor non-JWT", () => {
    expect(decodeJwtMeta("not-a-jwt")).toBeNull();
    expect(decodeJwtMeta("a.b.c")).toBeNull();
  });
});

describe("classifyStorageEntry", () => {
  it("classificeert een service-role-key als secret", () => {
    const e = classifyStorageEntry("local", "supabase", "sb_secret_abcdefghijklmnopqrstuvwxyz");
    expect(e.kind).toBe("secret");
    expect(e.secret_type).toBe("supabase_service_role");
  });

  it("classificeert een sk_live_-key als secret", () => {
    const e = classifyStorageEntry("local", "stripe", "sk_live_1234567890abcdefghijkl");
    expect(e.kind).toBe("secret");
    expect(e.secret_type).toBe("stripe_secret_key");
  });

  it("classificeert een JWT als jwt", () => {
    const e = classifyStorageEntry("local", "token", JWT_FAR);
    expect(e.kind).toBe("jwt");
    expect(e.jwt).not.toBeNull();
    expect(e.jwt!.alg).toBe("HS256");
  });

  it("classificeert een session-token op key-naam", () => {
    const e = classifyStorageEntry("local", "access_token", "some-opaque-value-123456");
    expect(e.kind).toBe("session-token");
  });

  it("classificeert een gewone niet-gevoelige entry als other", () => {
    const e = classifyStorageEntry("local", "theme", "dark");
    expect(e.kind).toBe("other");
  });

  it("maskeert de waarde (nooit volledig)", () => {
    const e = classifyStorageEntry("local", "stripe", "sk_live_1234567890abcdefghijkl");
    expect(e.masked).not.toContain("1234567890abcdefghijkl");
    expect(e.masked.length).toBeLessThan("sk_live_1234567890abcdefghijkl".length);
  });

  it("korte waarde wordt gemaskeerd met eerste teken + …", () => {
    const e = classifyStorageEntry("local", "theme", "abc");
    expect(e.masked).toBe("a…");
  });
});

describe("classifyStorage", () => {
  it("classificeert local + session samen", () => {
    const snapshot: StorageSnapshot = {
      local: { theme: "dark", token: "access_token_value_123456" },
      session: { temp: "x" },
    };
    const entries = classifyStorage(snapshot);
    expect(entries).toHaveLength(3);
    expect(entries.filter((e) => e.store === "local")).toHaveLength(2);
    expect(entries.filter((e) => e.store === "session")).toHaveLength(1);
  });

  it("lege storage → lege array", () => {
    const entries = classifyStorage({ local: {}, session: {} });
    expect(entries).toEqual([]);
  });
});

describe("storageEntrySeverity", () => {
  it("critical voor service-role-key", () => {
    const e = classifyStorageEntry("local", "k", "sb_secret_abcdefghijklmnopqrstuvwxyz");
    expect(storageEntrySeverity(e)).toBe("critical");
  });

  it("critical voor private key (PEM)", () => {
    const pem =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA1234567890abcdefghijklmnopqrstuvwxyz\n-----END RSA PRIVATE KEY-----";
    const e = classifyStorageEntry("local", "key", pem);
    expect(storageEntrySeverity(e)).toBe("critical");
  });

  it("medium voor JWT zonder exp", () => {
    const e = classifyStorageEntry("local", "token", JWT_NO_EXP);
    expect(storageEntrySeverity(e)).toBe("medium");
  });

  it("medium voor JWT met exp > 30 dagen", () => {
    const e = classifyStorageEntry("local", "token", JWT_FAR);
    expect(storageEntrySeverity(e)).toBe("medium");
  });

  it("low voor session-token", () => {
    const e = classifyStorageEntry("local", "access_token", "opaque-value-123456");
    expect(storageEntrySeverity(e)).toBe("low");
  });

  it("info voor other", () => {
    const e = classifyStorageEntry("local", "theme", "dark");
    expect(storageEntrySeverity(e)).toBe("info");
  });
});
