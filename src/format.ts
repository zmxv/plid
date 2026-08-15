/**
 * A PLID is 8 to 32 characters: the stamp plus `0 ≤ K ≤ 24` entropy characters
 * (§ 2). The ceiling is past PLID-16, the widest profile listed, and past
 * UUIDv4's 122 random bits, which PLID-32 clears with 144 — beyond it a width
 * is a mistake, most often a millisecond passed where a length belongs.
 */
export const MIN_LENGTH = 8;
export const MAX_LENGTH = 32;

/** The widest entropy field the format allows, in characters. */
export const MAX_K = MAX_LENGTH - MIN_LENGTH;

export function assertLength(length: number): void {
  if (!Number.isInteger(length) || length < MIN_LENGTH || length > MAX_LENGTH) {
    throw new RangeError(
      `PLID length must be an integer in [${MIN_LENGTH}, ${MAX_LENGTH}]: ${length}`,
    );
  }
}
