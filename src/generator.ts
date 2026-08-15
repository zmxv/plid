import { encodeStamp, encodeTail } from "./alphabet.js";
import { decode } from "./decode.js";
import { assertLength } from "./format.js";
import { randomBits, type SeedSource } from "./random.js";
import {
  assertMs,
  assertOffsetBits,
  dateOffset,
  MAX_MS,
  type OffsetBits,
} from "./time.js";

export interface GeneratorOptions {
  /**
   * Total text length — the profile name, so 12 is a PLID-12 (default). The
   * spec's `K` is `length - 8`. `8` is legal and yields a stamp generator with
   * no entropy, which borrows a millisecond on every repeat within one.
   */
  length?: number;
  /** Clock, in Unix milliseconds. Defaults to `Date.now`. */
  now?: () => number;
  /** Date offset for a given millisecond. Defaults to the host zone (§ 2.3). */
  offset?: (ms: number) => OffsetBits;
  /** Entropy seed source. Defaults to the platform CSPRNG. */
  seed?: SeedSource;
  /**
   * § 4's restart remedy: the largest ID in the store, from one lookup of its
   * maximum key. Nothing this generator mints will sort at or below it.
   *
   * Without it `lastStamp` starts empty, and a process restarted after a clock
   * step-back emits stamps below IDs it emitted before the restart.
   *
   * At this generator's own width the counter carries over, so the next ID is
   * `since`'s exact successor. From another width the entropy fields are not
   * comparable — holding the stamp could mint below the floor — so the floor
   * advances a millisecond instead, keeping `since`'s offset bits.
   */
  since?: string;
}

export interface Generator {
  /** Total text length of the IDs this generator emits. */
  readonly length: number;
  /**
   * Mint the next ID. Pass `offset` to override the date-offset field for this
   * call — `0` when there is no local calendar to speak of (§ 2.3). Borrowing
   * (§ 4) can put the timestamp ahead of the clock; `driftMs(id)` says how far.
   */
  next(offset?: OffsetBits): string;
}

/** The largest stamp the 48 bits hold. Exact in a double: 2^48 < 2^53. */
const MAX_STAMP = MAX_MS * 4 + 3;

/**
 * A monotonic generator owning its `lastStamp` and counter. Both guarantees —
 * strictly ascending and collision-free — are per generator; across generators
 * only the seed separates them.
 */
export function createGenerator(options: GeneratorOptions = {}): Generator {
  const length = options.length ?? 12;
  assertLength(length);
  // The spec states every field width in K; the API states it in profile names.
  const K = length - 8;

  const now = options.now ?? Date.now;
  const offsetOf = options.offset ?? dateOffset;
  const seedSource = options.seed ?? randomBits;

  const max = 1n << BigInt(6 * K);

  // § 3: seed the whole field on a new stamp, then +1 per ID at that stamp.
  // What the seed leaves below the ceiling is the counter's room — half the
  // field on average, occasionally almost none, at which point § 4 borrows.
  const seedWidth = 6 * K;

  const reseed = (): bigint => {
    if (seedWidth === 0) return 0n; // PLID-8 has no field to seed
    const v = seedSource(seedWidth);
    if (v < 0n) throw new RangeError(`seed must be unsigned: ${v}`);
    return v & (max - 1n);
  };

  let lastStamp = -1;
  let ctr = 0n;

  if (options.since !== undefined) {
    const since = options.since;
    if (typeof since !== "string") {
      throw new TypeError(`since must be a PLID: ${JSON.stringify(since)}`);
    }
    // decode validates length and alphabet, so a malformed floor throws here
    // rather than silently lowering it.
    const d = decode(since);
    const stamp = d.ms * 4 + (d.offset === null ? 0 : d.offset + 2);

    if (d.K === K) {
      // Continue the counter: the next ID is `since`'s successor, never a
      // random draw that could land on a value already emitted.
      lastStamp = stamp;
      ctr = d.entropy;
    } else {
      // Holding this stamp would not clear `since` at another width, so take
      // the next millisecond. += 4 keeps the offset bits, as § 4's borrow does.
      if (stamp + 4 > MAX_STAMP) {
        throw new RangeError("timestamp field exhausted");
      }
      lastStamp = stamp + 4;
      ctr = reseed();
    }
  }

  return {
    length,

    next(offset?: OffsetBits): string {
      const ms = now();
      assertMs(ms);
      const off = offset ?? offsetOf(ms);
      assertOffsetBits(off);

      const stamp = ms * 4 + off;
      if (stamp > lastStamp) {
        lastStamp = stamp;
        ctr = reseed();
      } else {
        // Same stamp, or the clock (or the zone) went backwards: hold the stamp
        // and advance the entropy field instead (§ 4).
        ctr += 1n;
        if (ctr >= max) {
          // Borrow a millisecond. += 4 leaves the offset bits untouched, where
          // += 1 would corrupt them instead of advancing time. Checked before
          // the stamp moves, so a throw consumes nothing.
          if (lastStamp + 4 > MAX_STAMP) {
            throw new RangeError("timestamp field exhausted");
          }
          lastStamp += 4;
          ctr = reseed();
        }
      }

      return encodeStamp(lastStamp) + encodeTail(ctr, K);
    },
  };
}
