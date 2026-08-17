import { describe, it, expect } from "vitest";
import {
  checkCatalog,
  checksForQueue,
  queueCategories,
  scanCategories,
} from "../check-catalog";

describe("checkCatalog", () => {
  it("heeft unieke check-ids", () => {
    const ids = checkCatalog.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("heeft alleen geldige categorieën", () => {
    for (const entry of checkCatalog) {
      expect(scanCategories).toContain(entry.category);
    }
  });

  it("bevat de inline-run checks uit plan 06", () => {
    const inlineIds = ["reachability", "https", "security-header-csp", "meta-tags"];
    for (const id of inlineIds) {
      expect(checkCatalog.find((entry) => entry.id === id)).toBeDefined();
    }
  });

  it("bevat per security header een eigen check (plan 28)", () => {
    const headerIds = [
      "security-header-csp",
      "security-header-hsts",
      "security-header-xcto",
      "security-header-xfo",
      "security-header-referrer-policy",
      "security-header-permissions-policy",
      "security-header-coop",
      "security-header-coep",
    ];
    for (const id of headerIds) {
      expect(checkCatalog.find((entry) => entry.id === id)).toBeDefined();
    }
    expect(checkCatalog.find((entry) => entry.id === "security-headers")).toBeUndefined();
  });

  it("bevat per cookie-attribuut een eigen check (plan 65) en geen samenvattende `cookies`-entry", () => {
    const cookieIds = [
      "cookie-httponly",
      "cookie-secure",
      "cookie-samesite",
      "cookie-prefixes",
      "cookie-expiry",
    ];
    for (const id of cookieIds) {
      expect(checkCatalog.find((entry) => entry.id === id)).toBeDefined();
    }
    expect(checkCatalog.find((entry) => entry.id === "cookies")).toBeUndefined();
  });

  it("heeft een naam per entry", () => {
    for (const entry of checkCatalog) {
      expect(entry.name.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("checksForQueue (plan 27)", () => {
  it("mapped elke categorie naar precies één queue", () => {
    const seen = new Map<string, string>();
    for (const queue of Object.keys(queueCategories) as (keyof typeof queueCategories)[]) {
      for (const category of queueCategories[queue]) {
        expect(seen.has(category)).toBe(false);
        seen.set(category, queue);
      }
    }
    expect(seen.size).toBe(scanCategories.length);
  });

  it("kent de http+seo-categorie aan de http-queue toe", () => {
    const ids = checksForQueue("http").map((e) => e.id);
    expect(ids).toContain("reachability");
    expect(ids).toContain("meta-tags");
    expect(ids).not.toContain("core-web-vitals");
    expect(ids).not.toContain("semgrep");
  });

  it("kent aeo aan browser en github aan github toe", () => {
    expect(checksForQueue("browser").map((e) => e.id)).toContain("core-web-vitals");
    expect(checksForQueue("github").map((e) => e.id)).toContain("semgrep");
  });

  it("dekt de hele catalog (elke check hoort bij een queue)", () => {
    const inQueues = new Set([
      ...checksForQueue("http").map((e) => e.id),
      ...checksForQueue("browser").map((e) => e.id),
      ...checksForQueue("github").map((e) => e.id),
    ]);
    for (const entry of checkCatalog) {
      expect(inQueues.has(entry.id)).toBe(true);
    }
  });
});
