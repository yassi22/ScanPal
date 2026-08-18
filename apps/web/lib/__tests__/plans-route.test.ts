import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/plans/route";

describe("GET /api/plans", () => {
  it("returns all 3 plans including max with seats/white_label features", async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.plans).toHaveLength(3);

    const ids = body.plans.map((p: { id: string }) => p.id);
    expect(ids).toEqual(["free", "pro", "max"]);

    const max = body.plans.find((p: { id: string }) => p.id === "max");
    expect(max).toBeDefined();
    expect(max.name).toBe("Max");
    expect(max.features.seats).toBe(3);
    expect(max.features.white_label).toBe(true);

    const free = body.plans.find((p: { id: string }) => p.id === "free");
    expect(free.features.seats).toBeNull();
    expect(free.features.white_label).toBe(false);

    const pro = body.plans.find((p: { id: string }) => p.id === "pro");
    expect(pro.features.seats).toBeNull();
    expect(pro.features.white_label).toBe(false);
  });
});
