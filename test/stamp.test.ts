import { describe, expect, it } from "vitest";
import {
  createGenerator,
  decode,
  driftMs,
  isPlid,
  localDate,
  localDateKey,
  MAX_LENGTH,
  MAX_MS,
  offset,
  stamp,
  timestamp,
  toDateOffset,
} from "../src/index.js";
import { MS, STAMPS } from "./support.js";

// The worked example from the spec: 2026-08-15T12:04:56.789Z, offset bits 2.
const STAMP = "1d0LFaLM";

describe("stamp", () => {
  it("encodes the spec's example millisecond", () => {
    expect(MS).toBe(1_786_795_496_789);
    // stamp writes offset bits 0, the minimum of the four adjacent stamps.
    expect(stamp(MS)).toBe("1d0LFaLK");
    expect(timestamp(stamp(MS))).toBe(MS);
  });

  it("is exactly 8 characters and the epoch is all zeros", () => {
    expect(stamp(0)).toBe("00000000");
    expect(stamp(MAX_MS)).toHaveLength(8);
    for (const ms of [1, 1_000, MS, MAX_MS]) expect(stamp(ms)).toHaveLength(8);
  });

  it("encodes no offset", () => {
    expect(offset(stamp(MS))).toBeNull();
    expect(decode(stamp(MS))).toEqual({ ms: MS, offset: null, entropy: 0n, K: 0 });
  });

  it("round-trips arbitrary milliseconds", () => {
    for (let ms = 0; ms < 4_000_000_000_000; ms += 7_919_191_919) {
      expect(timestamp(stamp(ms))).toBe(ms);
    }
    expect(timestamp(stamp(MAX_MS))).toBe(MAX_MS);
  });

  it("sorts in millisecond order", () => {
    const stamps = [0, 1, 999, MS, MS + 1, 4e12, MAX_MS].map(stamp);
    expect([...stamps].sort()).toEqual(stamps);
  });

  it("matches § 2.1's leading-character rollovers", () => {
    // The leading character advances every 2^40 ms — about 34.8 years.
    expect(stamp(2 ** 40 - 1)[0]).toBe("0");
    expect(stamp(2 ** 40)[0]).toBe("1"); // 2004-11-03T19:53:47.776Z
    expect(new Date(2 ** 40).toISOString()).toBe("2004-11-03T19:53:47.776Z");
    expect(stamp(2 * 2 ** 40)[0]).toBe("2"); // 2039-09-07
    expect(new Date(2 * 2 ** 40).toISOString()).toBe("2039-09-07T15:47:35.552Z");
    // Indices 0–9 are digits, so a PLID leads with a digit until index 10.
    expect(stamp(10 * 2 ** 40 - 1)[0]).toBe("9");
    expect(stamp(10 * 2 ** 40)[0]).toBe("A"); // 2318-06-04
    expect(new Date(10 * 2 ** 40).toISOString()).toBe("2318-06-04T06:57:57.760Z");
    expect(stamp(MAX_MS)).toBe("~~~~~~~x");
    expect(new Date(MAX_MS).toISOString()).toBe("4199-11-24T01:22:57.663Z");
  });

  it("rejects milliseconds outside the 46-bit field", () => {
    expect(() => stamp(-1)).toThrow(RangeError);
    expect(() => stamp(MAX_MS + 1)).toThrow(RangeError);
    expect(() => stamp(1.5)).toThrow(RangeError);
    expect(() => stamp(Number.NaN)).toThrow(RangeError);
  });
});

describe("decode", () => {
  it("reads the three fields of a full-width ID", () => {
    const id = `${STAMP}8fLm`;
    expect(decode(id)).toEqual({
      ms: MS,
      offset: 0,
      entropy: parseEntropy("8fLm"),
      K: 4,
    });
    expect(timestamp(id)).toBe(MS);
    expect(offset(id)).toBe(0);
  });

  it("reads each of the four offset states", () => {
    expect(offset("1d0LFaLK")).toBeNull();
    expect(offset("1d0LFaLL")).toBe(-1);
    expect(offset("1d0LFaLM")).toBe(0);
    expect(offset("1d0LFaLN")).toBe(1);
    // All four are the same millisecond — the offset lives in the low bits.
    for (const s of STAMPS) expect(timestamp(s)).toBe(MS);
  });

  it("maps offset bits to days", () => {
    expect(toDateOffset(0)).toBeNull();
    expect(toDateOffset(1)).toBe(-1);
    expect(toDateOffset(2)).toBe(0);
    expect(toDateOffset(3)).toBe(1);
  });

  it("rejects short or invalid text", () => {
    expect(() => decode("1d0LFaL")).toThrow(SyntaxError);
    expect(() => timestamp("")).toThrow(SyntaxError);
    expect(() => decode("1d0LFaLM8f-m")).toThrow(/invalid PLID character/);
    expect(isPlid("1d0LFaL")).toBe(false);
    expect(isPlid("1d0LFaLM")).toBe(true);
    expect(isPlid("1d0LFaLM8fLm")).toBe(true);
    expect(isPlid("1d0LFaLM8f-m")).toBe(false);
  });

  it("holds every reader to § 2's 8–32 character bound", () => {
    const widest = "1d0LFaLM" + "0".repeat(MAX_LENGTH - 8);
    const tooWide = widest + "0";
    expect(MAX_LENGTH).toBe(32);
    expect(isPlid(widest)).toBe(true);
    expect(isPlid(tooWide)).toBe(false);
    expect(decode(widest).K).toBe(24);
    for (const read of [decode, timestamp, offset, localDate, localDateKey, driftMs]) {
      expect(() => read(tooWide)).toThrow(/8 to 32 characters/);
    }
    // Writers agree with readers on the same bound.
    expect(() => createGenerator({ length: MAX_LENGTH + 1 })).toThrow(/\[8, 32\]/);
    expect(createGenerator({ length: MAX_LENGTH, now: () => MS }).next()).toHaveLength(32);
  });
});

function parseEntropy(text: string): bigint {
  const A = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~";
  let v = 0n;
  for (const c of text) v = (v << 6n) | BigInt(A.indexOf(c));
  return v;
}
