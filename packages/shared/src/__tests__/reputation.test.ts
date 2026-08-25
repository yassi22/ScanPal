import { describe, expect, it } from "vitest";
import { classifyReputation, reputationSchema, type ReputationSource } from "../reputation";

function source(
  name: ReputationSource["source"],
  listed: boolean,
  categories: string[] = [],
): ReputationSource {
  return { source: name, queried: true, listed, categories };
}

describe("classifyReputation", () => {
  it("classificeert volledig schoon als info", () => {
    expect(classifyReputation([source("spamhaus", false), source("urlhaus", false)])).toBe("info");
  });

  it("classificeert Spamhaus ZEN als medium en DBL als high", () => {
    expect(classifyReputation([source("spamhaus", true, ["ZEN:SBL"])] )).toBe("medium");
    expect(classifyReputation([source("spamhaus", true, ["DBL:malware"])] )).toBe("high");
  });

  it("classificeert Safe Browsing- en VirusTotal-malware als high", () => {
    expect(classifyReputation([source("safe-browsing", true, ["SOCIAL_ENGINEERING"])] )).toBe("high");
    expect(classifyReputation([source("virustotal", true, ["malicious:2"])] )).toBe("high");
  });

  it("houdt een enkel zwak signaal low maar corroboratie high", () => {
    expect(classifyReputation([source("virustotal", true, ["suspicious:1"])] )).toBe("low");
    expect(
      classifyReputation([
        source("virustotal", true, ["suspicious:1"]),
        source("abuseipdb", true, ["confidence:30"]),
      ]),
    ).toBe("high");
  });

  it("classificeert AbuseIPDB >=75 als medium", () => {
    expect(classifyReputation([source("abuseipdb", true, ["confidence:80"])] )).toBe("medium");
  });

  it("dempt IP-gebaseerde listings achter een edge/CDN", () => {
    const abuse = source("abuseipdb", true, ["confidence:80"]);
    const urlhausHistorical = source("urlhaus", true, ["historical"]);
    // Zonder edge: IP-listing + domein-listing corroboreren tot high.
    expect(classifyReputation([abuse, urlhausHistorical])).toBe("high");
    // Met edge: de AbuseIPDB-IP-listing valt buiten corroboratie; alleen het
    // urlhaus-domeinsignaal blijft over → dat blijft high (origin-oordeel).
    expect(classifyReputation([abuse, urlhausHistorical], true)).toBe("high");
    // Met edge en uitsluitend een IP-listing: edge-only → hoogstens low (geen fail).
    expect(classifyReputation([abuse], true)).toBe("low");
    // Spamhaus ZEN (IP-zone) achter edge dempt eveneens; DBL (domein) niet.
    expect(classifyReputation([source("spamhaus", true, ["ZEN:SBL"])], true)).toBe("low");
    expect(classifyReputation([source("spamhaus", true, ["DBL:malware"])], true)).toBe("high");
  });

  it("valideert het volledige reputatiecontract", () => {
    expect(
      reputationSchema.safeParse({
        host: "example.com",
        ips: ["203.0.113.10"],
        edge_detected: false,
        sources: [source("spamhaus", false)],
        worst_severity: "info",
        measured_at: "2026-08-25T10:00:00.000Z",
      }).success,
    ).toBe(true);
  });
});
