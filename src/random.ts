/** Source of the entropy seed. Must return `bits` bits of unsigned randomness. */
export type SeedSource = (bits: number) => bigint;

/**
 * Pool of CSPRNG bytes, refilled in one call. A generator reseeds on every new
 * stamp, and a `getRandomValues` call per seed costs ~1 µs against ~30 ns for
 * the rest of an ID. Bytes are handed out in order and never reused: only the
 * call is amortised, not the entropy.
 */
const POOL = new Uint8Array(512);
let pos = POOL.length; // empty: the first draw fills it

function refill(): void {
  const webcrypto = globalThis.crypto;
  if (typeof webcrypto?.getRandomValues !== "function") {
    throw new Error(
      "no CSPRNG: globalThis.crypto.getRandomValues is unavailable " +
        "(Node 18+ or a browser is required)",
    );
  }
  webcrypto.getRandomValues(POOL);
  pos = 0;
}

/** Exact at any width, so wide profiles — where `6K` passes 64 — seed correctly. */
export const randomBits: SeedSource = (bits) => {
  if (bits <= 0) return 0n;
  const bytes = Math.ceil(bits / 8);
  if (pos + bytes > POOL.length) refill();
  let v = 0n;
  for (let i = 0; i < bytes; i++) v = (v << 8n) | BigInt(POOL[pos + i]);
  pos += bytes;
  return v & ((1n << BigInt(bits)) - 1n);
};
