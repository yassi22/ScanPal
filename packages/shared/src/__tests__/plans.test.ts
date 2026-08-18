import { describe, it, expect } from "vitest";
import { planIdSchema, plans, planList, publicPlanSchema, isPaidPlan } from "../plans";

describe("planIdSchema (plan 64)", () => {
  it("accepteert free, pro en max", () => {
    expect(planIdSchema.safeParse("free").success).toBe(true);
    expect(planIdSchema.safeParse("pro").success).toBe(true);
    expect(planIdSchema.safeParse("max").success).toBe(true);
  });

  it("verwerpt onbekende plan-ids", () => {
    expect(planIdSchema.safeParse("enterprise").success).toBe(false);
  });
});

describe("plans.max (plan 64)", () => {
  it("heeft seats 3 en white_label true", () => {
    expect(plans.max.id).toBe("max");
    expect(plans.max.features.seats).toBe(3);
    expect(plans.max.features.white_label).toBe(true);
  });

  it("heeft de besloot limieten (credits 2000, members 3, api 240, webhooks 3)", () => {
    expect(plans.max.creditsPerPeriod).toBe(2000);
    expect(plans.max.maxMembers).toBe(3);
    expect(plans.max.apiRatePerMinute).toBe(240);
    expect(plans.max.maxWebhooks).toBe(3);
  });

  it("heeft 4x de pro-prijs (maand 11600, jaar 116000)", () => {
    expect(plans.max.priceCents).toBe(plans.pro.priceCents * 4);
    expect(plans.max.annualPriceCents).toBe(plans.pro.annualPriceCents! * 4);
  });

  it("heeft alle feature-vlaggen aan", () => {
    expect(plans.max.features.uptime).toBe(true);
    expect(plans.max.features.github).toBe(true);
    expect(plans.max.features.activeTests).toBe(true);
    expect(plans.max.features.onDeploy).toBe(true);
  });
});

describe("free/pro (plan 64)", () => {
  it("hebben seats null en white_label false", () => {
    expect(plans.free.features.seats).toBeNull();
    expect(plans.free.features.white_label).toBe(false);
    expect(plans.pro.features.seats).toBeNull();
    expect(plans.pro.features.white_label).toBe(false);
  });

  it("zijn onveranderd op alle bestaande velden", () => {
    expect(plans.free).toMatchObject({
      id: "free",
      name: "Free",
      priceCents: 0,
      creditsPerPeriod: 5,
      maxMembers: 3,
      apiRatePerMinute: 60,
      maxWebhooks: 1,
      features: { uptime: false, github: false, activeTests: false, onDeploy: false },
    });
    expect(plans.free).not.toHaveProperty("annualPriceCents");
    expect(plans.pro).toMatchObject({
      id: "pro",
      name: "Pro",
      priceCents: 2900,
      annualPriceCents: 29000,
      creditsPerPeriod: 500,
      maxMembers: 10,
      apiRatePerMinute: 120,
      maxWebhooks: 3,
      features: { uptime: true, github: true, activeTests: true, onDeploy: true },
    });
  });
});

describe("isPaidPlan (plan 64 stap 2, MFL-20260818-008)", () => {
  it("is false voor free", () => {
    expect(isPaidPlan("free")).toBe(false);
  });

  it("is true voor pro", () => {
    expect(isPaidPlan("pro")).toBe(true);
  });

  it("is true voor max", () => {
    expect(isPaidPlan("max")).toBe(true);
  });
});

describe("planList (plan 64)", () => {
  it("bevat free, pro en max in volgorde", () => {
    expect(planList.length).toBe(3);
    expect(planList.map((p) => p.id)).toEqual(["free", "pro", "max"]);
  });
});

describe("publicPlanSchema (plan 64)", () => {
  it("parset de max-plan-vorm (features incl. seats + white_label)", () => {
    const parsed = publicPlanSchema.safeParse(plans.max);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.features.seats).toBe(3);
      expect(parsed.data.features.white_label).toBe(true);
    }
  });

  it("parset free en pro met seats null en white_label false", () => {
    expect(publicPlanSchema.safeParse(plans.free).success).toBe(true);
    expect(publicPlanSchema.safeParse(plans.pro).success).toBe(true);
  });
});
