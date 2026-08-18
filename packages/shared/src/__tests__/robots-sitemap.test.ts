import { describe, it, expect } from "vitest";
import {
  evaluateRobotsSitemap,
  inspectRobotsTxt,
  inspectSitemap,
  robotsSitemapEvidence,
} from "../robots-sitemap";

const GOOD_ROBOTS = `User-agent: *
Disallow: /admin/
Allow: /admin/public/
Sitemap: https://example.com/sitemap.xml
`;

const GOOD_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc></url>
  <url><loc>https://example.com/about</loc></url>
</urlset>`;

describe("inspectRobotsTxt (feature 36)", () => {
  it("parst een geldig robots.txt met wildcard-agent, regels en sitemap", () => {
    const robots = inspectRobotsTxt(GOOD_ROBOTS, 200);
    expect(robots.present).toBe(true);
    expect(robots.status).toBe(200);
    expect(robots.sizeBytes).toBe(GOOD_ROBOTS.length);
    expect(robots.hasWildcardAgent).toBe(true);
    expect(robots.userAgents).toEqual(["*"]);
    expect(robots.disallowRules).toBe(1);
    expect(robots.allowRules).toBe(1);
    expect(robots.sitemapDirectives).toEqual(["https://example.com/sitemap.xml"]);
    expect(robots.parseErrors).toEqual([]);
  });

  it("telt meerdere user-agent-groepen en herkent specifieke agents", () => {
    const robots = inspectRobotsTxt(`User-agent: Googlebot
Disallow: /search
User-agent: *
Disallow: /private
`, 200);
    expect(robots.userAgents).toContain("Googlebot");
    expect(robots.userAgents).toContain("*");
    expect(robots.hasWildcardAgent).toBe(true);
    expect(robots.disallowRules).toBe(2);
  });

  it("meldt regels zonder ':'-scheiding als parse-fout", () => {
    const robots = inspectRobotsTxt(`User-agent: *
Disallow: /x
dit is een kapotte regel
Sitemap:
`, 200);
    expect(robots.parseErrors.length).toBe(2);
    expect(robots.parseErrors[0]).toContain("geen ':'-scheiding");
    expect(robots.parseErrors[1]).toContain("Sitemap:-regel zonder URL");
  });

  it("negeert commentaren, lege regels en onbekende (legale) velden", () => {
    const robots = inspectRobotsTxt(`# commentaar

User-agent: *
Crawl-delay: 10
Host: example.com
Disallow: /x
`, 200);
    expect(robots.parseErrors).toEqual([]);
    expect(robots.disallowRules).toBe(1);
    expect(robots.userAgents).toEqual(["*"]);
  });

  it("levert een lege inspectie voor null/lege input", () => {
    expect(inspectRobotsTxt(null, 404).present).toBe(false);
    expect(inspectRobotsTxt("   \n", 200).present).toBe(false);
    expect(inspectRobotsTxt(null, 404).status).toBe(404);
  });
});

describe("inspectSitemap (feature 36)", () => {
  it("parst een geldige urlset", () => {
    const sitemap = inspectSitemap(GOOD_SITEMAP, 200);
    expect(sitemap.present).toBe(true);
    expect(sitemap.isXml).toBe(true);
    expect(sitemap.urlCount).toBe(2);
    expect(sitemap.validUrls).toBe(2);
    expect(sitemap.invalidSamples).toEqual([]);
    expect(sitemap.error).toBeNull();
  });

  it("parst een sitemapindex", () => {
    const sitemap = inspectSitemap(`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/sitemap-1.xml</loc></sitemap>
  <sitemap><loc>https://example.com/sitemap-2.xml</loc></sitemap>
</sitemapindex>`, 200);
    expect(sitemap.isXml).toBe(true);
    expect(sitemap.urlCount).toBe(2);
    expect(sitemap.validUrls).toBe(2);
  });

  it("meldt een non-XML body als ongeldig", () => {
    const sitemap = inspectSitemap("<html><body>not a sitemap</body></html>", 200);
    expect(sitemap.present).toBe(true);
    expect(sitemap.isXml).toBe(false);
    expect(sitemap.error).toContain("geen <urlset>/<sitemapindex>-root");
  });

  it("meldt een urlset zonder <loc>-entries", () => {
    const sitemap = inspectSitemap(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`, 200);
    expect(sitemap.isXml).toBe(true);
    expect(sitemap.error).toBe("geen <loc>-entries gevonden");
  });

  it("meldt ongeldige URL-entries (max 5 samples)", () => {
    const urls = Array.from({ length: 8 }, (_, i) => `not-a-url-${i}`);
    const sitemap = inspectSitemap(
      `<urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`,
      200,
    );
    expect(sitemap.urlCount).toBe(8);
    expect(sitemap.validUrls).toBe(0);
    expect(sitemap.invalidSamples.length).toBe(5);
  });

  it("verwerpt lege input met error", () => {
    const sitemap = inspectSitemap(null, 404);
    expect(sitemap.present).toBe(false);
    expect(sitemap.error).toBe("leeg document");
  });

  it("onthoudt of de sitemap uit robots.txt kwam", () => {
    expect(inspectSitemap(GOOD_SITEMAP, 200, true).discoveredFromRobots).toBe(true);
  });
});

describe("evaluateRobotsSitemap (feature 36)", () => {
  it("pass: robots.txt + sitemap beide geldig", () => {
    const verdict = evaluateRobotsSitemap(
      inspectRobotsTxt(GOOD_ROBOTS, 200),
      inspectSitemap(GOOD_SITEMAP, 200, true),
    );
    expect(verdict.status).toBe("pass");
    expect(verdict.issues).toEqual([]);
  });

  it("fail: robots.txt ontbreekt", () => {
    const verdict = evaluateRobotsSitemap(
      inspectRobotsTxt(null, 404),
      inspectSitemap(GOOD_SITEMAP, 200),
    );
    expect(verdict.status).toBe("fail");
    expect(verdict.issues).toContain("robots.txt ontbreekt of is leeg");
  });

  it("warn: geen `User-agent: *`-groep", () => {
    const verdict = evaluateRobotsSitemap(
      inspectRobotsTxt("User-agent: Googlebot\nDisallow: /x\n", 200),
      inspectSitemap(GOOD_SITEMAP, 200, true),
    );
    expect(verdict.status).toBe("warn");
    expect(verdict.issues[0]).toContain("geen `User-agent: *`-groep");
  });

  it("warn: parse-fouten in robots.txt", () => {
    const robots = inspectRobotsTxt("User-agent: *\nkapotte regel\n", 200);
    expect(robots.parseErrors.length).toBeGreaterThan(0);
    const verdict = evaluateRobotsSitemap(robots, inspectSitemap(GOOD_SITEMAP, 200, true));
    expect(verdict.status).toBe("warn");
  });

  it("fail: sitemap gedeclareerd in robots.txt maar onbereikbaar", () => {
    const verdict = evaluateRobotsSitemap(
      inspectRobotsTxt("User-agent: *\nSitemap: https://example.com/sitemap.xml\n", 200),
      inspectSitemap(null, 0, true),
    );
    expect(verdict.status).toBe("fail");
    expect(verdict.issues).toContain("sitemap gedeclareerd in robots.txt maar onbereikbaar");
  });

  it("fail: sitemap is geen geldig XML-document", () => {
    const verdict = evaluateRobotsSitemap(
      inspectRobotsTxt(GOOD_ROBOTS, 200),
      inspectSitemap("<html>nope</html>", 200, true),
    );
    expect(verdict.status).toBe("fail");
    expect(verdict.issues).toContain("sitemap is geen geldig XML-document");
  });

  it("fail: sitemap-root zonder <loc>-entries", () => {
    const verdict = evaluateRobotsSitemap(
      inspectRobotsTxt(GOOD_ROBOTS, 200),
      inspectSitemap(`<urlset></urlset>`, 200, true),
    );
    expect(verdict.status).toBe("fail");
    expect(verdict.issues[0]).toContain("sitemap ongeldig");
  });

  it("warn: geen sitemap en geen Sitemap:-directive", () => {
    const verdict = evaluateRobotsSitemap(
      inspectRobotsTxt("User-agent: *\nDisallow:\n", 200),
      inspectSitemap(null, 404),
    );
    expect(verdict.status).toBe("warn");
    expect(verdict.issues).toContain("geen sitemap.xml gevonden en geen Sitemap:-directive in robots.txt");
  });

  it("warn: sitemap met ongeldige URL-entries", () => {
    const verdict = evaluateRobotsSitemap(
      inspectRobotsTxt(GOOD_ROBOTS, 200),
      inspectSitemap(`<urlset><url><loc>geen-url</loc></url></urlset>`, 200, true),
    );
    expect(verdict.status).toBe("warn");
    expect(verdict.issues[0]).toContain("ongeldige URL(s)");
  });

  it("bouwt de evidence in het v1-formaat", () => {
    const robots = inspectRobotsTxt(GOOD_ROBOTS, 200);
    const sitemap = inspectSitemap(GOOD_SITEMAP, 200, true);
    const evidence = robotsSitemapEvidence(robots, sitemap);
    expect(evidence.kind).toBe("robots-sitemap");
    expect(evidence.robots_txt).toMatchObject({
      present: true,
      has_wildcard_agent: true,
      sitemap_directives: ["https://example.com/sitemap.xml"],
    });
    expect(evidence.sitemap).toMatchObject({
      present: true,
      is_xml: true,
      url_count: 2,
      discovered_from_robots: true,
    });
  });
});
