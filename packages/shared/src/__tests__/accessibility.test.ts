import { describe, it, expect } from "vitest";
import {
  parseAxeViolations,
  axeEvidence,
  axeOverallStatus,
  axeEvidenceSchema,
} from "../accessibility";
import { checkCatalog } from "../check-catalog";

describe("accessibility (feature 42)", () => {
  it("heeft de catalog-entry accessibility (categorie aeo, passief)", () => {
    const entry = checkCatalog.find((c) => c.id === "accessibility");
    expect(entry).toBeDefined();
    expect(entry?.category).toBe("aeo");
    expect(entry?.active).toBe(false);
  });

  const violations = [
    {
      id: "color-contrast",
      impact: "critical",
      help: "Elements must have sufficient color contrast",
      tags: ["cat.color", "wcag2aa"],
      nodes: [
        { target: ["button.primary"], html: "<button>click</button>" },
        { target: ["a.link"], html: "<a>link</a>" },
      ],
    },
    {
      id: "image-alt",
      impact: "serious",
      help: "Images must have alternate text",
      tags: ["cat.text-alternatives", "wcag2a"],
      nodes: [{ target: ["img.hero"], html: "<img>" }],
    },
    {
      id: "heading-order",
      impact: "moderate",
      help: "Heading levels should only increase by one",
      tags: ["cat.structure"],
      nodes: [{ target: ["h3.skip"], html: "<h3>skip</h3>" }],
    },
    {
      id: "region",
      impact: "minor",
      help: "All page content should be contained by landmarks",
      tags: ["cat.keyboard"],
      nodes: [{ target: ["div.extra"], html: "<div>extra</div>" }],
    },
  ];

  describe("parseAxeViolations", () => {
    it("parseert violations met impact, help, tags, node_count + selectors", () => {
      const parsed = parseAxeViolations(violations);
      expect(parsed).toHaveLength(4);
      expect(parsed[0]).toEqual({
        id: "color-contrast",
        impact: "critical",
        help: "Elements must have sufficient color contrast",
        tags: ["cat.color", "wcag2aa"],
        node_count: 2,
        selectors: ["button.primary", "a.link"],
      });
    });

    it("negeert ongeldige input", () => {
      expect(parseAxeViolations(null)).toEqual([]);
      expect(parseAxeViolations("geen-array")).toEqual([]);
      expect(parseAxeViolations([{ foo: "bar" }])).toEqual([]); // geen id
    });

    it("selectors worden gecapteerd op 10", () => {
      const many = {
        id: "x",
        impact: "moderate",
        help: "h",
        tags: [],
        nodes: Array.from({ length: 15 }, (_, i) => ({ target: [`sel${i}`] })),
      };
      const parsed = parseAxeViolations([many]);
      expect(parsed[0].selectors).toHaveLength(10);
      expect(parsed[0].node_count).toBe(15);
    });

    it("impact fallback = minor bij ontbrekende impact", () => {
      const parsed = parseAxeViolations([{ id: "x", help: "h", nodes: [] }]);
      expect(parsed[0].impact).toBe("minor");
    });
  });

  describe("axeOverallStatus", () => {
    it("fail bij critical of serious", () => {
      expect(axeOverallStatus(parseAxeViolations(violations))).toBe("fail");
    });

    it("warn bij alleen moderate/minor", () => {
      expect(
        axeOverallStatus(parseAxeViolations([violations[2], violations[3]])),
      ).toBe("warn");
    });

    it("pass bij geen violations", () => {
      expect(axeOverallStatus([])).toBe("pass");
    });
  });

  describe("axeEvidence", () => {
    it("telt per impact + valideert", () => {
      const ev = axeEvidence(parseAxeViolations(violations));
      expect(ev.kind).toBe("accessibility");
      expect(ev.total).toBe(4);
      expect(ev.by_impact).toEqual({ critical: 1, serious: 1, moderate: 1, minor: 1 });
      expect(ev.samples).toHaveLength(4);
      expect(axeEvidenceSchema.safeParse(ev).success).toBe(true);
    });

    it("capteert samples op 10", () => {
      const many = Array.from({ length: 15 }, (_, i) => ({
        id: `v${i}`,
        impact: "moderate" as const,
        help: "h",
        tags: [],
        node_count: 1,
        selectors: [`s${i}`],
      }));
      expect(axeEvidence(many).samples).toHaveLength(10);
    });
  });
});
