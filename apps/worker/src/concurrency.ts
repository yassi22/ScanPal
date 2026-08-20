/**
 * Verwerkt `items` met hoogstens `concurrency` gelijktijdige `fn`-aanroepen en
 * geeft de resultaten terug in de invoervolgorde. Gebruikt door de scan-worker
 * om routes binnen één scan parallel (maar begrensd) af te handelen zonder de
 * doel-site te overbelasten. `concurrency <= 0` wordt als serieel (1) behandeld.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.floor(concurrency) || 1);
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}
