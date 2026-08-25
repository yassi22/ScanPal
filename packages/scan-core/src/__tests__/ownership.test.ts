import { describe, expect, it, vi } from "vitest";
import {
  checkOwnershipLive,
  ensureOwnershipToken,
  generateOwnershipToken,
  ownershipRecordNameForSiteUrl,
  recordOwnershipCheck,
  rotateOwnershipToken,
  verifyOwnershipLive,
} from "../ownership";

function dbWithRows(rows: unknown[]) {
  return { query: vi.fn(async () => ({ rows, rowCount: rows.length })) };
}

function resolver(overrides: Record<string, unknown>) {
  return overrides as unknown as typeof import("node:dns/promises");
}

const SITE_ID = "00000000-0000-4000-8000-000000000001";
const TEAM_ID = "00000000-0000-4000-8000-000000000002";
const TOKEN = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRST";

describe("ownership DNS target", () => {
  it("gebruikt de apex voor een subdomein en zet IDN om naar punycode", () => {
    expect(ownershipRecordNameForSiteUrl("https://shop.example.co.uk/path")).toBe(
      "example.co.uk",
    );
    expect(ownershipRecordNameForSiteUrl("https://shop.münchen.de/login")).toBe(
      "xn--mnchen-3ya.de",
    );
  });

  it("genereert 32 bytes als base32 zonder padding", () => {
    expect(generateOwnershipToken()).toMatch(/^[A-Z2-7]{52}$/);
  });
});

describe("ownership token state", () => {
  it("maakt een ontbrekend token lazy aan", async () => {
    const db = dbWithRows([
      {
        id: SITE_ID,
        url: "example.com",
        ownership_token: TOKEN,
        ownership_verified_at: null,
        ownership_method: null,
      },
    ]);
    const ownership = await ensureOwnershipToken(
      db as never,
      { siteId: SITE_ID, teamId: TEAM_ID },
      () => TOKEN,
    );
    expect(ownership).toEqual({
      token: TOKEN,
      record_name: "example.com",
      record_value: `scanpal-verify=${TOKEN}`,
      verified_at: null,
    });
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("coalesce"), [
      SITE_ID,
      TEAM_ID,
      TOKEN,
    ]);
  });

  it("rotatie vervangt het token en wist de verificatie", async () => {
    const newToken = `N${TOKEN.slice(1)}`;
    const db = dbWithRows([
      {
        id: SITE_ID,
        url: "example.com",
        ownership_token: newToken,
        ownership_verified_at: null,
        ownership_method: null,
      },
    ]);
    const ownership = await rotateOwnershipToken(
      db as never,
      { siteId: SITE_ID, teamId: TEAM_ID },
      () => newToken,
    );
    expect(ownership?.token).toBe(newToken);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("ownership_verified_at = null"),
      [SITE_ID, TEAM_ID, newToken],
    );
  });

  it("scope-t tokenupdates op de workspace van een member", async () => {
    const db = dbWithRows([]);
    await ensureOwnershipToken(
      db as never,
      { siteId: SITE_ID, teamId: TEAM_ID, workspaceId: "workspace-1" },
      () => TOKEN,
    );
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("workspace_id = $4"),
      [SITE_ID, TEAM_ID, TOKEN, "workspace-1"],
    );
  });
});

describe("live ownership check", () => {
  it("matcht live TXT op de apex", async () => {
    const db = dbWithRows([{ url: "app.example.com", ownership_token: TOKEN }]);
    const resolveTxt = vi.fn(async () => [["scanpal-verify=", TOKEN]]);
    const result = await checkOwnershipLive(SITE_ID, {
      db: db as never,
      dnsResolver: resolver({ resolveTxt }),
    });
    expect(result).toEqual({ verified: true, token: TOKEN });
    expect(resolveTxt).toHaveBeenCalledWith("example.com");
    expect(
      await verifyOwnershipLive(SITE_ID, {
        db: db as never,
        dnsResolver: resolver({ resolveTxt }),
      }),
    ).toBe(true);
  });

  it("scopet de site-lookup op team en workspace als die zijn meegegeven", async () => {
    const db = dbWithRows([{ url: "example.com", ownership_token: TOKEN }]);
    const resolveTxt = vi.fn(async () => [["scanpal-verify=", TOKEN]]);
    await checkOwnershipLive(SITE_ID, {
      db: db as never,
      dnsResolver: resolver({ resolveTxt }),
      teamId: TEAM_ID,
      workspaceId: "workspace-1",
    });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("team_id = $2 and workspace_id = $3"),
      [SITE_ID, TEAM_ID, "workspace-1"],
    );
  });

  it("geeft record-not-found voor NXDOMAIN en een verkeerde token", async () => {
    const db = dbWithRows([{ url: "example.com", ownership_token: TOKEN }]);
    const missing = resolver({
      resolveTxt: vi.fn(async () => {
        throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
      }),
    });
    expect(await checkOwnershipLive(SITE_ID, { db: db as never, dnsResolver: missing }))
      .toMatchObject({ verified: false, reason: "record-not-found" });

    const oldToken = resolver({
      resolveTxt: vi.fn(async () => [["scanpal-verify=OLD-TOKEN"]]),
    });
    expect(await checkOwnershipLive(SITE_ID, { db: db as never, dnsResolver: oldToken }))
      .toMatchObject({ verified: false, reason: "record-not-found" });
  });

  it("onderscheidt een resolverfout van een ontbrekend record", async () => {
    const db = dbWithRows([{ url: "example.com", ownership_token: TOKEN }]);
    const dnsResolver = resolver({
      resolveTxt: vi.fn(async () => {
        throw Object.assign(new Error("servfail"), { code: "SERVFAIL" });
      }),
    });
    expect(await checkOwnershipLive(SITE_ID, { db: db as never, dnsResolver }))
      .toMatchObject({ verified: false, reason: "dns-lookup-failed" });
  });

  it("schrijft alleen als het gecontroleerde token nog actueel is", async () => {
    const verifiedAt = new Date("2026-08-25T12:00:00.000Z");
    const db = dbWithRows([{ ownership_verified_at: verifiedAt }]);
    expect(
      await recordOwnershipCheck(db as never, {
        siteId: SITE_ID,
        teamId: TEAM_ID,
        token: TOKEN,
        verified: true,
      }),
    ).toEqual(verifiedAt);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("ownership_token = $3"),
      [SITE_ID, TEAM_ID, TOKEN, true, "dns-txt"],
    );
  });
});
