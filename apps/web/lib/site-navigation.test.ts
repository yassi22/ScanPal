import { describe, expect, it } from "vitest";
import { isSiteId, toAbsoluteSiteUrl } from "./site-navigation";

describe("site navigation", () => {
  it("maakt een canonieke site-URL absoluut", () => {
    expect(toAbsoluteSiteUrl("sleutelstad.nl")).toBe("https://sleutelstad.nl");
    expect(toAbsoluteSiteUrl("sleutelstad.nl/nieuws?regio=leiden")).toBe(
      "https://sleutelstad.nl/nieuws?regio=leiden",
    );
  });

  it("behoudt een bestaand http(s)-protocol", () => {
    expect(toAbsoluteSiteUrl("http://localhost.example.com:8080/status")).toBe(
      "http://localhost.example.com:8080/status",
    );
    expect(toAbsoluteSiteUrl("HTTPS://sleutelstad.nl")).toBe(
      "HTTPS://sleutelstad.nl",
    );
  });

  it("onderscheidt site-UUIDs van domeinnamen", () => {
    expect(isSiteId("a8ddeaff-8615-497f-b924-131666320939")).toBe(true);
    expect(isSiteId("sleutelstad.nl")).toBe(false);
  });
});
