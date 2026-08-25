import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Pool } from "pg";
import {
  CredentialsNotConfiguredError,
  decryptCredential,
  deleteAuthCredentials,
  encryptCredential,
  getAuthCredentialsMeta,
  loadAuthCredentials,
  saveAuthCredentials,
} from "../credentials";

const KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
const SITE_ID = "00000000-0000-4000-8000-000000000001";
const TEAM_ID = "00000000-0000-4000-8000-000000000002";
const WORKSPACE_ID = "00000000-0000-4000-8000-000000000003";

function dbWithRows(rows: unknown[]) {
  return {
    query: vi.fn(async () => ({ rows, rowCount: rows.length })),
  } as unknown as Pool;
}

function dbRecording() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Pool;
  return { db, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("encryptCredential / decryptCredential round-trip", () => {
  it("decrypteert wat encrypt produceert", () => {
    const plaintext = "s3cr3t-p@ssw0rd!";
    const stored = encryptCredential(KEY, plaintext);
    expect(stored.startsWith("v1.")).toBe(true);
    expect(decryptCredential(KEY, stored)).toBe(plaintext);
  });
  it("produceert een unieke ciphertext per aanroep (willekeurige IV)", () => {
    const a = encryptCredential(KEY, "x");
    const b = encryptCredential(KEY, "x");
    expect(a).not.toBe(b);
    expect(decryptCredential(KEY, a)).toBe("x");
    expect(decryptCredential(KEY, b)).toBe("x");
  });
  it("werpt bij een onbekend formaat", () => {
    expect(() => decryptCredential(KEY, "garbage")).toThrow("onbekend credential-formaat");
    expect(() => decryptCredential(KEY, "v2.a.b.c")).toThrow("onbekend credential-formaat");
  });
  it("werpt bij een verkeerde key (auth-tag mismatch)", () => {
    const stored = encryptCredential(KEY, "secret");
    const wrongKey = Buffer.from("fedcba9876543210fedcba9876543210").toString("base64");
    expect(() => decryptCredential(wrongKey, stored)).toThrow();
  });
});

describe("saveAuthCredentials", () => {
  it("werpt CredentialsNotConfiguredError zonder key", async () => {
    const { db } = dbRecording();
    await expect(
      saveAuthCredentials(db, {
        siteId: SITE_ID,
        teamId: TEAM_ID,
        loginUrl: null,
        username: "u",
        password: "p",
        key: "",
      }),
    ).rejects.toBeInstanceOf(CredentialsNotConfiguredError);
  });
  it("upsert met encrypted password en tenant-scope", async () => {
    const { db, calls } = dbRecording();
    await saveAuthCredentials(db, {
      siteId: SITE_ID,
      teamId: TEAM_ID,
      workspaceId: WORKSPACE_ID,
      loginUrl: "https://example.com/login",
      username: "tester",
      password: "p@ss",
      key: KEY,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toContain("on conflict (site_id) do update");
    expect(calls[0]!.sql).toContain("team_id = $2");
    expect(calls[0]!.params[0]).toBe(SITE_ID);
    expect(calls[0]!.params[1]).toBe(TEAM_ID);
    expect(calls[0]!.params[2]).toBe(WORKSPACE_ID);
    expect(calls[0]!.params[3]).toBe("https://example.com/login");
    expect(calls[0]!.params[4]).toBe("tester");
    const encrypted = calls[0]!.params[5] as string;
    expect(encrypted.startsWith("v1.")).toBe(true);
    expect(encrypted).not.toContain("p@ss");
    expect(decryptCredential(KEY, encrypted)).toBe("p@ss");
  });
});

describe("loadAuthCredentials", () => {
  it("werpt CredentialsNotConfiguredError zonder key", async () => {
    const db = dbWithRows([]);
    await expect(
      loadAuthCredentials(db, { siteId: SITE_ID, key: "" }),
    ).rejects.toBeInstanceOf(CredentialsNotConfiguredError);
  });
  it("retourneert null wanneer er geen rij is", async () => {
    const db = dbWithRows([]);
    const result = await loadAuthCredentials(db, { siteId: SITE_ID, key: KEY });
    expect(result).toBeNull();
  });
  it("decrypt het password en scopet op team/workspace", async () => {
    const encrypted = encryptCredential(KEY, "secret123");
    const db = dbWithRows([
      { login_url: "https://example.com/login", username: "tester", password_encrypted: encrypted },
    ]);
    const result = await loadAuthCredentials(db, {
      siteId: SITE_ID,
      teamId: TEAM_ID,
      workspaceId: WORKSPACE_ID,
      key: KEY,
    });
    expect(result).toEqual({
      login_url: "https://example.com/login",
      username: "tester",
      password: "secret123",
    });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("team_id = $2"),
      [SITE_ID, TEAM_ID, WORKSPACE_ID],
    );
  });
});

describe("getAuthCredentialsMeta", () => {
  it("retourneert has_credentials=false zonder rij", async () => {
    const db = dbWithRows([]);
    const meta = await getAuthCredentialsMeta(db, { siteId: SITE_ID, teamId: TEAM_ID });
    expect(meta).toEqual({ has_credentials: false, username: null, login_url: null });
  });
  it("retourneert metadata zonder password", async () => {
    const db = dbWithRows([
      { login_url: "https://example.com/login", username: "tester" },
    ]);
    const meta = await getAuthCredentialsMeta(db, {
      siteId: SITE_ID,
      teamId: TEAM_ID,
      workspaceId: WORKSPACE_ID,
    });
    expect(meta).toEqual({
      has_credentials: true,
      username: "tester",
      login_url: "https://example.com/login",
    });
  });
});

describe("deleteAuthCredentials", () => {
  it("scopet de delete op team en workspace", async () => {
    const { db, calls } = dbRecording();
    await deleteAuthCredentials(db, {
      siteId: SITE_ID,
      teamId: TEAM_ID,
      workspaceId: WORKSPACE_ID,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toContain("delete from site_auth_credentials");
    expect(calls[0]!.sql).toContain("team_id = $2");
    expect(calls[0]!.params).toEqual([SITE_ID, TEAM_ID, WORKSPACE_ID]);
  });
});
