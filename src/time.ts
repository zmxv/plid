/** Raw value of the 2-bit date-offset field (§ 2.3). `0` means "not encoded". */
export type OffsetBits = 0 | 1 | 2 | 3;

/**
 * The generator's local calendar date relative to the UTC date of the same
 * instant: `-1`, `0` or `+1` days, or `null` when no offset was encoded.
 */
export type DateOffset = -1 | 0 | 1 | null;

export const DAY_MS = 86_400_000;

/** Largest millisecond the 46-bit timestamp field holds: 4199-11-24T01:22:57.663Z. */
export const MAX_MS = 2 ** 46 - 1;

export function assertMs(ms: number): void {
  if (!Number.isInteger(ms) || ms < 0 || ms > MAX_MS) {
    throw new RangeError(
      `timestamp must be an integer millisecond in [0, ${MAX_MS}]: ${ms}`,
    );
  }
}

export function assertOffsetBits(bits: number): asserts bits is OffsetBits {
  if (bits !== 0 && bits !== 1 && bits !== 2 && bits !== 3) {
    throw new RangeError(`date offset must be 0, 1, 2 or 3: ${bits}`);
  }
}

/** `0` is "not encoded"; otherwise days from the UTC date (§ 2.3). */
export function toDateOffset(bits: OffsetBits): DateOffset {
  return bits === 0 ? null : ((bits - 2) as -1 | 0 | 1);
}

/**
 * Offset bits 1, 2 or 3 for `ms` — never `0`, which only a generator with no
 * local calendar writes (§ 2.3).
 *
 * Defaults to the host zone. `getTimezoneOffset` is (UTC − local) in minutes,
 * so subtracting it puts the epoch axis on local wall-clock time before
 * flooring to a day.
 */
export function dateOffset(ms: number, timeZone?: string): 1 | 2 | 3 {
  assertMs(ms);
  const localDay =
    timeZone === undefined
      ? Math.floor((ms - new Date(ms).getTimezoneOffset() * 60_000) / DAY_MS)
      : zoneDay(ms, timeZone);
  const delta = localDay - Math.floor(ms / DAY_MS);
  // § 2.3 proves |delta| ≤ 1 for any zone; checked anyway so a broken zone
  // source cannot corrupt the timestamp's low bits.
  if (delta < -1 || delta > 1) {
    throw new RangeError(`local date is ${delta} days from the UTC date`);
  }
  return (delta + 2) as 1 | 2 | 3;
}

/**
 * Cached per zone: building a formatter costs ~32 µs against ~1.7 µs to use
 * one. `Intl` rejects unknown zones, so the cache cannot grow past the real
 * ones.
 */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = FORMATTERS.get(timeZone);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    FORMATTERS.set(timeZone, f);
  }
  return f;
}

/**
 * Days since the epoch of `ms`'s calendar date in `timeZone`. `ms` is
 * non-negative, so the year is ≥ 1969 and no era handling is needed.
 */
function zoneDay(ms: number, timeZone: string): number {
  const parts = formatterFor(timeZone).formatToParts(new Date(ms));

  let year = 0;
  let month = 1;
  let day = 1;
  for (const p of parts) {
    if (p.type === "year") year = Number(p.value);
    else if (p.type === "month") month = Number(p.value);
    else if (p.type === "day") day = Number(p.value);
  }

  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}
