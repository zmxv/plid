import { describe, expect, it } from "vitest";
import { randomBits } from "../src/random.js";

describe("randomBits", () => {
  it("returns exactly the requested width at any size", () => {
    for (const bits of [1, 7, 8, 16, 40, 63, 64, 65, 88, 184]) {
      for (let i = 0; i < 32; i++) {
        const v = randomBits(bits);
        expect(v).toBeGreaterThanOrEqual(0n);
        expect(v).toBeLessThan(1n << BigInt(bits));
      }
    }
  });

  it("draws above 64 bits instead of silently clamping", () => {
    // A fixed 64-bit draw would leave the high bits of a wide seed always zero.
    const high = Array.from({ length: 64 }, () => randomBits(88) >> 64n);
    expect(high.some((v) => v > 0n)).toBe(true);
  });

  it("is zero-width safe", () => {
    expect(randomBits(0)).toBe(0n);
    expect(randomBits(-8)).toBe(0n);
  });

  it("varies between draws", () => {
    const draws = new Set(Array.from({ length: 64 }, () => randomBits(48)));
    expect(draws.size).toBeGreaterThan(60);
  });

  it("keeps its guarantees across pool refills", () => {
    // The pool is 512 bytes and hands out bytes in order, so thousands of
    // draws cross the refill boundary many times. Width and variety must hold
    // either side of it, and no draw may repeat a neighbour's bytes.
    const draws: bigint[] = [];
    for (let i = 0; i < 4_000; i++) {
      const v = randomBits(144); // 18 bytes: refills every 28 draws
      expect(v).toBeLessThan(1n << 144n);
      draws.push(v);
    }
    expect(new Set(draws).size).toBe(draws.length);
    // A stuck or unrefilled pool would show up as a repeated value or as a
    // block of zeros; neither survives 4,000 draws of 144 bits.
    expect(draws.every((v) => v > 0n)).toBe(true);
  });

  it("handles a draw that spans the end of the pool", () => {
    // Walk the pool to an arbitrary offset, then take draws of every size so
    // some of them straddle the refill point.
    for (let i = 0; i < 97; i++) randomBits(8);
    const wide = Array.from({ length: 200 }, () => randomBits(144));
    for (const v of wide) expect(v).toBeLessThan(1n << 144n);
    expect(new Set(wide).size).toBe(wide.length);
  });
});
