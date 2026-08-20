import { describe, it, expect } from "vitest";
import { mapWithConcurrency } from "../concurrency";

describe("mapWithConcurrency", () => {
  it("behoudt de invoervolgorde in het resultaat", async () => {
    const result = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => n * 10);
    expect(result).toEqual([10, 20, 30, 40]);
  });

  it("draait nooit meer dan `concurrency` taken tegelijk", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const release: Array<() => void> = [];

    const fn = async (): Promise<number> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => release.push(resolve));
      inFlight -= 1;
      return 0;
    };

    const items = [0, 1, 2, 3, 4, 5];
    const promise = mapWithConcurrency(items, 2, fn);

    // Laat de taken in golven vrij; op elk moment mogen er hoogstens 2 lopen.
    while (release.length > 0 || inFlight > 0) {
      const next = release.shift();
      if (next) next();
      await Promise.resolve();
    }
    await promise;

    expect(maxInFlight).toBe(2);
  });

  it("behandelt concurrency <= 0 als serieel (1)", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fn = async (n: number): Promise<number> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return n;
    };
    await mapWithConcurrency([1, 2, 3], 0, fn);
    expect(maxInFlight).toBe(1);
  });
});
