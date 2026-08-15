import {
  encodeStamp,
  isAlphabet,
  parseStamp,
  parseTail,
} from "./alphabet.js";
import { MAX_LENGTH, MIN_LENGTH } from "./format.js";
import {
  assertMs,
  DAY_MS,
  toDateOffset,
  type DateOffset,
  type OffsetBits,
} from "./time.js";

export interface Decoded {
  /** Unix milliseconds from the 46-bit timestamp field. */
  ms: number;
  /** Local calendar date relative to the UTC date, or `null` when not encoded. */
  offset: DateOffset;
  /** The `6K` low bits — the entropy field, per § 3. */
  entropy: bigint;
  /** Entropy characters, i.e. `id.length - 8`. */
  K: number;
}

function assertId(id: string): void {
  if (id.length < MIN_LENGTH || id.length > MAX_LENGTH) {
    throw new SyntaxError(
      `a PLID is ${MIN_LENGTH} to ${MAX_LENGTH} characters (§ 2), got ` +
        `${id.length}: ${JSON.stringify(id)}`,
    );
  }
}

/** The 48-bit stamp — the first 8 characters — as an integer. */
function stampOf(id: string): number {
  assertId(id);
  return parseStamp(id);
}

/** 8 to 32 characters, all of them in the alphabet. The only whole-string check. */
export function isPlid(id: string): boolean {
  return id.length >= MIN_LENGTH && id.length <= MAX_LENGTH && isAlphabet(id);
}

/** Unix milliseconds the ID was minted at. */
export function timestamp(id: string): number {
  return Math.floor(stampOf(id) / 4);
}

/**
 * Milliseconds this ID's timestamp is ahead of the clock; `0` when truthful.
 *
 * § 4 keeps IDs monotonic by letting the stamp run ahead of real time, and an
 * ID that did so is indistinguishable from an honest one. The clock is read at
 * call time, so drift decays to `0` as real time catches up. Works on any ID,
 * including one read back from storage.
 */
export function driftMs(id: string, now = Date.now()): number {
  return Math.max(0, timestamp(id) - now);
}

/** `-1`, `0` or `+1` days from the UTC date; `null` when the minter encoded none. */
export function offset(id: string): DateOffset {
  return toDateOffset((stampOf(id) % 4) as OffsetBits);
}

/** § 2.3's `utcDate(ms) + (bits − 2)`, from one parse of the stamp. */
function localDay(id: string): number | null {
  const stampValue = stampOf(id);
  const bits = stampValue % 4;
  if (bits === 0) return null;
  return Math.floor(stampValue / 4 / DAY_MS) + (bits - 2);
}

/**
 * The calendar date the *generator* was on, as `"YYYY-MM-DD"`, or `null` when
 * it encoded none (§ 2.3). Not recoverable any other way: applying your own
 * timezone to the timestamp gives the wrong day for another zone.
 *
 * A string, not a `Date`: a `Date` is an instant, so `new Date("2026-08-15")`
 * prints Aug 14 west of Greenwich — the retroactive-timezone error this field
 * exists to prevent. A string is inert, sorts, and binds to SQL `DATE`.
 */
export function localDate(id: string): string | null {
  const day = localDay(id);
  if (day === null) return null;
  const d = new Date(day * DAY_MS);
  return (
    `${String(d.getUTCFullYear()).padStart(4, "0")}-` +
    `${String(d.getUTCMonth() + 1).padStart(2, "0")}-` +
    `${String(d.getUTCDate()).padStart(2, "0")}`
  );
}

/**
 * The same date as `YYYYMMDD` for grouping and `dt=` partition keys: sorts in
 * date order, allocates nothing. A bucket key, not a number to compute with —
 * `20260831 + 1` is not a date.
 */
export function localDateKey(id: string): number | null {
  const day = localDay(id);
  if (day === null) return null;
  const d = new Date(day * DAY_MS);
  return (
    d.getUTCFullYear() * 10_000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate()
  );
}

/** Split an ID of any width into its three fields. */
export function decode(id: string): Decoded {
  const stampValue = stampOf(id);
  return {
    ms: Math.floor(stampValue / 4),
    offset: toDateOffset((stampValue % 4) as OffsetBits),
    entropy: parseTail(id),
    K: id.length - 8,
  };
}

/**
 * The bare 8-character stamp for `ms`, offset bits `0` — the minimum of the
 * four, so it sorts below every ID minted at that millisecond whatever its
 * offset, which is what makes it an exact range bound (§ 5). Not an identifier:
 * no entropy, so it collides for every ID minted in the same millisecond.
 */
export function stamp(ms: number): string {
  assertMs(ms);
  return encodeStamp(ms * 4);
}
