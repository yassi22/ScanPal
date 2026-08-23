import { describe, it, expect } from "vitest";
import {
  registrableDomain,
  toPunycode,
  parseRdap,
  parseWhoisExpiry,
  normalizeNs,
  diffDomainMeasurement,
  domainAlerts,
  parseSpf,
  parseDmarc,
  spfLookupCount,
  DOMAIN_EXPIRY_ALERT_DAYS,
  DOMAIN_TLS_ALERT_DAYS,
  matchVulnerableService,
  classifyTakeover,
  extractCtSubdomains,
  type DomainMeasurement,
  type TakeoverProbe,
} from "../domain";

const NOW = new Date("2026-08-17T00:00:00Z");
function inDays(d: number): string {
  return new Date(NOW.getTime() + d * 86_400_000).toISOString();
}

function measurement(over: Partial<DomainMeasurement> = {}): DomainMeasurement {
  return {
    domain_expiry: inDays(120),
    domain_registrar: "Example Registrar",
    dnssec_enabled: true,
    caa_present: false,
    tls_expiry: inDays(90),
    nameservers: ["ns1.example.com", "ns2.example.com"],
    caa_records: [],
    ...over,
  };
}

describe("registrableDomain — apex-resolutie", () => {
  it("geeft het apex terug voor een subdomein", () => {
    expect(registrableDomain("blog.example.com")).toBe("example.com");
    expect(registrableDomain("a.b.c.example.com")).toBe("example.com");
  });

  it("behoudt een apex met twee labels", () => {
    expect(registrableDomain("example.com")).toBe("example.com");
  });

  it("herkent tweede-niveau-TLD's (co.uk)", () => {
    expect(registrableDomain("blog.example.co.uk")).toBe("example.co.uk");
    expect(registrableDomain("example.co.uk")).toBe("example.co.uk");
  });

  it("geeft null voor IP's en ongeldig", () => {
    expect(registrableDomain("192.168.1.1")).toBeNull();
    expect(registrableDomain("localhost")).toBeNull();
  });
});

describe("toPunycode", () => {
  it("laat ASCII-hosts ongewijzigd (lowercase)", () => {
    expect(toPunycode("Example.COM")).toBe("example.com");
  });
  it("geeft niet-ASCII input lowercased terug (conversie gebeurt in netwerklaag)", () => {
    expect(toPunycode("München.de")).toBe("münchen.de");
  });
});

describe("parseRdap", () => {
  it("haalt expiry, registrar, nameservers en transfer-lock uit een RDAP-respons", () => {
    const parsed = parseRdap({
      events: [
        { eventAction: "registration", eventDate: "2020-01-01T00:00:00Z" },
        { eventAction: "expiration", eventDate: "2027-01-01T00:00:00Z" },
      ],
      entities: [
        {
          roles: ["registrar"],
          handle: "REG-1",
          vcardArray: ["vcard", [["fn", {}, "text", "Example Registrar"]]],
        },
      ],
      nameservers: [
        { ldhName: "NS1.EXAMPLE.COM." },
        { ldhName: "NS2.EXAMPLE.COM." },
      ],
      status: ["serverTransferProhibited", "clientUpdateProhibited"],
    });
    expect(parsed.domain_expiry).toBe("2027-01-01T00:00:00Z");
    expect(parsed.domain_registrar).toBe("Example Registrar");
    expect(parsed.nameservers).toEqual(["ns1.example.com", "ns2.example.com"]);
    expect(parsed.transfer_locked).toBe(true);
  });

  it("geeft null/leeg bij ontbrekende velden", () => {
    const parsed = parseRdap({});
    expect(parsed.domain_expiry).toBeNull();
    expect(parsed.domain_registrar).toBeNull();
    expect(parsed.nameservers).toEqual([]);
    expect(parsed.transfer_locked).toBeNull();
  });

  it("valt terug op entity.handle als vcard fn ontbreekt", () => {
    const parsed = parseRdap({
      entities: [{ roles: ["registrar"], handle: "REG-9" }],
    });
    expect(parsed.domain_registrar).toBe("REG-9");
  });
});

describe("parseWhoisExpiry — fallback", () => {
  it("herkent 'Registry Expiry Date'", () => {
    expect(parseWhoisExpiry("Registry Expiry Date: 2027-01-01T00:00:00Z")).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });
  it("herkent 'paid-till' (gebruikt door sommige registrars)", () => {
    expect(parseWhoisExpiry("paid-till: 2027-01-01")).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });
  it("geeft null bij geen herkenbaar patroon", () => {
    expect(parseWhoisExpiry("geen datum hier")).toBeNull();
  });
});

describe("normalizeNs", () => {
  it("lowercase, strip trailing dot, gesorteerd", () => {
    expect(normalizeNs(["NS2.example.COM.", "ns1.example.com"])).toEqual([
      "ns1.example.com",
      "ns2.example.com",
    ]);
  });
});

describe("diffDomainMeasurement", () => {
  it("geeft geen diffs bij identieke metingen", () => {
    const m = measurement();
    expect(diffDomainMeasurement(m, m)).toEqual([]);
  });

  it("detecteert een nameserver-wijziging (set-vergelijking, volgorde-onafhankelijk)", () => {
    const prev = measurement();
    const next = measurement({
      nameservers: ["ns2.example.com", "ns1.example.com", "ns3.example.com"],
    });
    const diffs = diffDomainMeasurement(prev, next);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].field).toBe("nameservers");
  });

  it("detecteert dnssec false→true", () => {
    const diffs = diffDomainMeasurement(
      measurement({ dnssec_enabled: false }),
      measurement({ dnssec_enabled: true }),
    );
    expect(diffs.find((d) => d.field === "dnssec_enabled")).toBeDefined();
  });

  it("geeft geen diff voor nameservers bij gelijke set in andere volgorde", () => {
    const prev = measurement({ nameservers: ["ns2.example.com", "ns1.example.com"] });
    const next = measurement({ nameservers: ["ns1.example.com", "ns2.example.com"] });
    expect(diffDomainMeasurement(prev, next)).toEqual([]);
  });
});

describe("domainAlerts — drempels", () => {
  it("alert bij expiry < drempel en alleen bij verandering", () => {
    const diffs = [{ field: "domain_expiry" as const, old_value: inDays(120), new_value: inDays(10) }];
    const alerts = domainAlerts(diffs, measurement({ domain_expiry: inDays(10) }), NOW);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].field).toBe("domain_expiry");
    expect(alerts[0].summary).toContain(`${DOMAIN_EXPIRY_ALERT_DAYS} d`);
  });

  it("alert bij verlopen domein (negatief)", () => {
    const diffs = [{ field: "domain_expiry" as const, old_value: inDays(120), new_value: inDays(-5) }];
    const alerts = domainAlerts(diffs, measurement({ domain_expiry: inDays(-5) }), NOW);
    expect(alerts[0].summary).toContain("verlopen");
  });

  it("alert bij tls_expiry < 14 d", () => {
    const diffs = [{ field: "tls_expiry" as const, old_value: inDays(90), new_value: inDays(5) }];
    const alerts = domainAlerts(diffs, measurement({ tls_expiry: inDays(5) }), NOW);
    expect(alerts[0].field).toBe("tls_expiry");
    expect(alerts[0].summary).toContain(`${DOMAIN_TLS_ALERT_DAYS} d`);
  });

  it("alert bij DNSSEC uitgeschakeld", () => {
    const diffs = [{ field: "dnssec_enabled" as const, old_value: "true", new_value: "false" }];
    const alerts = domainAlerts(diffs, measurement({ dnssec_enabled: false }), NOW);
    expect(alerts[0].field).toBe("dnssec_enabled");
  });

  it("alert bij nameserver-drift", () => {
    const diffs = [{ field: "nameservers" as const, old_value: "ns1,ns2", new_value: "ns1,ns3" }];
    const alerts = domainAlerts(diffs, measurement({ nameservers: ["ns1", "ns3"] }), NOW);
    expect(alerts[0].field).toBe("nameservers");
  });

  it("geen alert als het veld niet veranderd is (herhalingsonderdrukking)", () => {
    // expiry < 30 d maar géén diff → geen alert (geen spam bij ongewijzigde status)
    const alerts = domainAlerts([], measurement({ domain_expiry: inDays(10) }), NOW);
    expect(alerts).toEqual([]);
  });

  it("alert bij nieuwe CAA-record (caa_present false→true)", () => {
    const diffs = [{ field: "caa_present" as const, old_value: "false", new_value: "true" }];
    const alerts = domainAlerts(diffs, measurement({ caa_present: true }), NOW);
    expect(alerts[0].field).toBe("caa_present");
  });
});

describe("parseSpf", () => {
  it("herkent een geldig SPF-record met -all", () => {
    const r = parseSpf("v=spf1 ip4:1.2.3.4 -all");
    expect(r).not.toBeNull();
    expect(r!.all_qualifier).toBe("-all");
  });

  it("herkent +all en ?all als permissief", () => {
    expect(parseSpf("v=spf1 +all")!.all_qualifier).toBe("+all");
    expect(parseSpf("v=spf1 ?all")!.all_qualifier).toBe("?all");
  });

  it("lege qualifier → 'all'", () => {
    expect(parseSpf("v=spf1 all")!.all_qualifier).toBe("all");
  });

  it("~all is softfail", () => {
    expect(parseSpf("v=spf1 a ~all")!.all_qualifier).toBe("~all");
  });

  it("geen all-mechanisme → null qualifier", () => {
    expect(parseSpf("v=spf1 ip4:1.2.3.4")!.all_qualifier).toBeNull();
  });

  it("niet-SPF-record → null", () => {
    expect(parseSpf("v=DMARC1; p=none")).toBeNull();
    expect(parseSpf("some text")).toBeNull();
  });

  it("matcht 'all' niet in een include-domeinnaam (B1-regressie)", () => {
    expect(parseSpf("v=spf1 include:_spf.all.example.com -all")!.all_qualifier).toBe("-all");
    expect(parseSpf("v=spf1 include:spf.all.example.com ~all")!.all_qualifier).toBe("~all");
  });
});

describe("parseDmarc", () => {
  it("herkent p=reject met rua", () => {
    const r = parseDmarc("v=DMARC1; p=reject; rua=mailto:dmarc@example.com");
    expect(r).not.toBeNull();
    expect(r!.policy).toBe("reject");
    expect(r!.rua_present).toBe(true);
  });

  it("herkent p=none (monitor-only)", () => {
    expect(parseDmarc("v=DMARC1; p=none")!.policy).toBe("none");
  });

  it("herkent p=quarantine zonder rua", () => {
    const r = parseDmarc("v=DMARC1; p=quarantine");
    expect(r!.policy).toBe("quarantine");
    expect(r!.rua_present).toBe(false);
  });

  it("geen p= → policy missing", () => {
    expect(parseDmarc("v=DMARC1; rua=mailto:x@example.com")!.policy).toBe("missing");
  });

  it("niet-DMARC-record → null", () => {
    expect(parseDmarc("v=spf1 -all")).toBeNull();
  });
});

describe("spfLookupCount", () => {
  it("telt include, a, mx, exists, redirect", () => {
    const record = "v=spf1 include:_spf.google.com a mx exists:%{i}.spf.example.com redirect=_spf2.example.com -all";
    expect(spfLookupCount(record)).toBe(5);
  });

  it("enkelvoudig record zonder lookups → 0", () => {
    expect(spfLookupCount("v=spf1 ip4:1.2.3.4 -all")).toBe(0);
  });
});

describe("matchVulnerableService", () => {
  it("matcht een exacte suffix (github.io)", () => {
    expect(matchVulnerableService("example.github.io")).toBe("github.io");
  });

  it("matcht de service-root zelf (herokuapp.com)", () => {
    expect(matchVulnerableService("herokuapp.com")).toBe("herokuapp.com");
  });

  it("geeft null voor een onbekend target", () => {
    expect(matchVulnerableService("internal.corp.example.com")).toBeNull();
  });

  it("is hoofdletterongevoelig en stript trailing dots", () => {
    expect(matchVulnerableService("App.AzureWebsites.NET.")).toBe("azurewebsites.net");
  });
});

describe("classifyTakeover", () => {
  function probe(over: Partial<TakeoverProbe> = {}): TakeoverProbe {
    return {
      subdomain: "staging.example.com",
      cname_target: "example.herokuapp.com",
      resolves: false,
      target_resolves: false,
      ...over,
    };
  }

  it("high bij dangling CNAME naar bekende service", () => {
    const r = classifyTakeover(probe());
    expect(r.severity).toBe("high");
    expect(r.service).toBe("herokuapp.com");
    expect(r.reason).toContain("dangling");
  });

  it("medium bij dangling CNAME naar onbekend target", () => {
    const r = classifyTakeover(
      probe({ cname_target: "ghost.someinternal.corp" }),
    );
    expect(r.severity).toBe("medium");
    expect(r.service).toBeNull();
  });

  it("info bij resolvend target (niet dangling)", () => {
    const r = classifyTakeover(probe({ target_resolves: true }));
    expect(r.severity).toBe("info");
  });

  it("info bij geen CNAME", () => {
    const r = classifyTakeover(
      probe({ cname_target: null, resolves: true }),
    );
    expect(r.severity).toBe("info");
    expect(r.reason).toContain("geen CNAME");
  });
});

describe("extractCtSubdomains", () => {
  it("haalt unieke subdomeinen van de apex uit name_value", () => {
    const json = [
      { name_value: "staging.example.com\nwww.example.com" },
      { name_value: "staging.example.com" },
      { common_name: "api.example.com" },
    ];
    expect(extractCtSubdomains(json, "example.com")).toEqual([
      "api.example.com",
      "staging.example.com",
      "www.example.com",
    ]);
  });

  it("filtert wildcards en de apex zelf eruit", () => {
    const json = [{ name_value: "*.example.com\nexample.com\nblog.example.com" }];
    expect(extractCtSubdomains(json, "example.com")).toEqual(["blog.example.com"]);
  });

  it("negeert hostnames van andere apexen", () => {
    const json = [{ name_value: "blog.other.com\nstaging.example.com" }];
    expect(extractCtSubdomains(json, "example.com")).toEqual(["staging.example.com"]);
  });

  it("leeg bij geen matches", () => {
    expect(extractCtSubdomains([], "example.com")).toEqual([]);
  });
});
