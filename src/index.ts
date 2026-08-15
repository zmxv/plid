import { createGenerator, type Generator } from "./generator.js";
import type { OffsetBits } from "./time.js";

// Minting
export { createGenerator };
export type { Generator, GeneratorOptions } from "./generator.js";
export { stamp } from "./decode.js";

// Reading
export {
  decode,
  driftMs,
  isPlid,
  localDate,
  localDateKey,
  offset,
  timestamp,
} from "./decode.js";
export type { Decoded } from "./decode.js";

// Fields, bounds and helpers
export { ALPHABET } from "./alphabet.js";
export { MAX_K, MAX_LENGTH, MIN_LENGTH } from "./format.js";
export { dateOffset, DAY_MS, MAX_MS, toDateOffset } from "./time.js";
export type { DateOffset, OffsetBits } from "./time.js";
export type { SeedSource } from "./random.js";

/** One generator per width — never one counter shared across widths (§ 7). */
const defaults = new Map<number, Generator>();

function generatorFor(length: number): Generator {
  let g = defaults.get(length);
  if (g === undefined) {
    g = createGenerator({ length });
    defaults.set(length, g);
  }
  return g;
}

/**
 * Mint a PLID from the process-wide generator for a profile.
 *
 * @param length Total text length, i.e. the profile name: `plid(12)` is a
 *   PLID-12. Defaults to 12 (§ 2.2).
 * @param offset Date-offset override for this call. A server minting for
 *   clients in unknown zones MUST pass `0` rather than let the host zone stand
 *   in for theirs (§ 2.3).
 *
 * `plid(8)` mints a bare stamp for *now*, borrowing a millisecond on every
 * repeat within one. That is not `stamp(ms)`, which encodes a millisecond you
 * supply with offset bits `0`, for range bounds (§ 5).
 */
export function plid(length = 12, offset?: OffsetBits): string {
  return generatorFor(length).next(offset);
}
