import { createGenerator } from "../src/index.js";

/**
 * The spec's worked example: 2026-08-15T12:04:56.789Z, whose stamp at offset
 * bits 2 is `1d0LFaLM`. Every vector in the suite hangs off this instant, so it
 * lives in one place.
 */
export const MS = Date.parse("2026-08-15T12:04:56.789Z");

/** The four stamps of that millisecond, offset bits 0 to 3 (§ 5). */
export const STAMPS = ["1d0LFaLK", "1d0LFaLL", "1d0LFaLM", "1d0LFaLN"] as const;

/** A generator with its clock, offset and seed under the test's control. */
export function fixed(length: number, clock: { ms: number }, seed = 0n) {
  return createGenerator({
    length,
    now: () => clock.ms,
    offset: () => 2,
    seed: () => seed,
  });
}
