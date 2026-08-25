import { describe, expect, it } from "vitest";
import {
  matchesOwnershipTxt,
  ownershipRecordValue,
  ownershipVerificationStatus,
} from "../ownership";

const TOKEN = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRST";

describe("matchesOwnershipTxt", () => {
  it("matcht exacte records met quotes en whitespace", () => {
    expect(matchesOwnershipTxt([[ownershipRecordValue(TOKEN)]], TOKEN)).toBe(true);
    expect(matchesOwnershipTxt([[`\"scanpal-verify = ${TOKEN}\"`]], TOKEN)).toBe(true);
    expect(matchesOwnershipTxt([`  'scanpal-verify=${TOKEN}'  `], TOKEN)).toBe(true);
  });

  it("voegt TXT-chunks samen en doorzoekt meerdere records", () => {
    expect(
      matchesOwnershipTxt(
        [
          ["v=spf1 include:_spf.example.com ~all"],
          ["scanpal-verify=", TOKEN],
          ["google-site-verification=ander-token"],
        ],
        TOKEN,
      ),
    ).toBe(true);
  });

  it("weigert een oud, gedeeltelijk of ingebed token", () => {
    expect(matchesOwnershipTxt([[`scanpal-verify=OLD${TOKEN}`]], TOKEN)).toBe(false);
    expect(matchesOwnershipTxt([[`prefix scanpal-verify=${TOKEN}`]], TOKEN)).toBe(false);
    expect(matchesOwnershipTxt([[`scanpal-verify=${TOKEN} suffix`]], TOKEN)).toBe(false);
  });
});

describe("ownershipVerificationStatus", () => {
  const now = new Date("2026-08-25T12:00:00.000Z");

  it("onderscheidt geverifieerd, verlopen en niet geverifieerd", () => {
    expect(ownershipVerificationStatus(null, now)).toBe("unverified");
    expect(
      ownershipVerificationStatus("2026-08-01T12:00:00.000Z", now),
    ).toBe("verified");
    expect(
      ownershipVerificationStatus("2026-07-01T12:00:00.000Z", now),
    ).toBe("expired");
  });
});
