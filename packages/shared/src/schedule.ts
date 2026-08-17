export const SCHEDULED_HOUR_UTC = 9;

export function next09Utc(from: Date): Date {
  const next = new Date(
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate(),
      SCHEDULED_HOUR_UTC,
      0,
      0,
      0,
    ),
  );
  if (next.getTime() <= from.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

/**
 * Berekent de volgende geplande run op 09:00 UTC.
 * - daily: +1 dag vanaf de vorige geplande tijd, weekly: +7 dagen (geen drift)
 * - Staat de verschoven tijd in het verleden (scheduler was beneden of liep
 *   ver achter), dan opnieuw plannen vanaf de eerstvolgende 09:00 UTC.
 * - Zonder huidige planning: eerstvolgende 09:00 UTC.
 */
export function computeNextScanAt(
  frequency: "daily" | "weekly",
  current: Date | null,
  now: Date = new Date(),
): Date {
  if (!current) return next09Utc(now);

  const deltaMs =
    frequency === "daily" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  const shifted = new Date(current.getTime() + deltaMs);

  if (shifted.getTime() <= now.getTime()) return next09Utc(now);
  return shifted;
}
