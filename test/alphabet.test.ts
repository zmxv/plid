import { describe, expect, it } from "vitest";
import {
  ALPHABET,
  encodeStamp,
  encodeTail,
  isAlphabet,
  parseStamp,
  parseTail,
} from "../src/alphabet.js";

describe("alphabet", () => {
  it("has 64 distinct characters", () => {
    expect(ALPHABET).toHaveLength(64);
    expect(new Set(ALPHABET).size).toBe(64);
  });

  it("is strictly ascending by code point", () => {
    for (let i = 1; i < ALPHABET.length; i++) {
      expect(ALPHABET.charCodeAt(i)).toBeGreaterThan(ALPHABET.charCodeAt(i - 1));
    }
  });

  it("matches the documented ranges", () => {
    expect(ALPHABET.slice(0, 10)).toBe("0123456789");
    expect(ALPHABET.slice(10, 36)).toBe("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    expect(ALPHABET[36]).toBe("_");
    expect(ALPHABET.slice(37, 63)).toBe("abcdefghijklmnopqrstuvwxyz");
    expect(ALPHABET[63]).toBe("~");
  });

  it("uses only RFC 3986 unreserved characters", () => {
    expect(ALPHABET).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });
});

describe("encodeStamp / parseStamp", () => {
  it("round-trips every stamp the 48 bits hold", () => {
    const cases = [0, 1, 63, 64, 4095, 2 ** 24 - 1, 2 ** 24, 2 ** 32 + 12345, 2 ** 48 - 1];
    for (const v of cases) {
      expect(encodeStamp(v)).toHaveLength(8);
      expect(parseStamp(encodeStamp(v))).toBe(v);
    }
  });

  it("zero-pads on the left and reaches both ends of the range", () => {
    expect(encodeStamp(0)).toBe("00000000");
    expect(encodeStamp(1)).toBe("00000001");
    expect(encodeStamp(63)).toBe("0000000~");
    expect(encodeStamp(64)).toBe("00000010");
    expect(encodeStamp(2 ** 48 - 1)).toBe("~~~~~~~~");
  });

  it("orders encodings the way it orders values", () => {
    let prev = encodeStamp(0);
    for (let v = 1; v < 100_000; v += 137) {
      const s = encodeStamp(v);
      expect(s > prev).toBe(true);
      prev = s;
    }
  });

  it("reads only the first 8 characters", () => {
    expect(parseStamp("1d0LFaLM")).toBe(parseStamp("1d0LFaLM8fLm"));
  });

  it("rejects characters outside the alphabet", () => {
    expect(() => parseStamp("1d0LFaL-")).toThrow(SyntaxError);
    expect(() => parseStamp("1d0LFa+M")).toThrow(/invalid PLID character/);
    expect(() => parseStamp("1d0LFa/M")).toThrow(/invalid PLID character/);
    expect(() => parseStamp("1d0LFaÉM")).toThrow(/invalid PLID character/); // non-ASCII
    expect(() => parseStamp("1d0LFaL")).toThrow(/invalid PLID character/); // runs off the end
  });
});

describe("stamp coding against a BigInt reference", () => {
  // The 48-bit stamp is encoded with double arithmetic because 2^48 < 2^53.
  // This is the obvious place for that shortcut to be wrong, so check it
  // against the straightforward BigInt implementation across the range.
  const referenceEncode = (value: bigint): string => {
    let v = value;
    let s = "";
    for (let i = 0; i < 8; i++) {
      s = ALPHABET[Number(v & 63n)] + s;
      v >>= 6n;
    }
    return s;
  };

  it("agrees at every bit position", () => {
    for (let bit = 0; bit < 48; bit++) {
      const v = 2 ** bit;
      expect(encodeStamp(v)).toBe(referenceEncode(BigInt(v)));
      expect(parseStamp(encodeStamp(v))).toBe(v);
    }
  });

  it("agrees on 20,000 values spread across the range", () => {
    for (let i = 0; i < 20_000; i++) {
      // Deterministic spread, no Math.random: a large odd stride mod 2^48.
      const v = (i * 6_364_136_223_846_793) % 2 ** 48;
      expect(encodeStamp(v)).toBe(referenceEncode(BigInt(v)));
      expect(parseStamp(encodeStamp(v))).toBe(v);
    }
  });

  it("agrees at the boundaries of both 24-bit halves", () => {
    for (const v of [
      0,
      2 ** 24 - 1,
      2 ** 24,
      2 ** 24 + 1,
      2 ** 47,
      2 ** 48 - 2,
      2 ** 48 - 1,
    ]) {
      expect(encodeStamp(v)).toBe(referenceEncode(BigInt(v)));
      expect(parseStamp(encodeStamp(v))).toBe(v);
    }
  });
});

describe("encodeTail / parseTail", () => {
  it("round-trips entropy fields of every width", () => {
    for (const [chars, entropy] of [
      [0, 0n],
      [1, 63n],
      [4, 16_777_215n],
      [8, (1n << 48n) - 1n],
      [24, (1n << 144n) - 1n], // the widest field the format allows
    ] as const) {
      const text = encodeTail(entropy, chars);
      expect(text).toHaveLength(chars);
      expect(parseTail("1d0LFaLM" + text)).toBe(entropy);
    }
  });

  it("is empty at K=0 and zero-pads on the left", () => {
    expect(encodeTail(0n, 0)).toBe("");
    expect(encodeTail(0n, 4)).toBe("0000");
    expect(encodeTail(1n, 4)).toBe("0001");
    expect(encodeTail(63n, 4)).toBe("000~");
  });

  it("reads nothing from a bare stamp", () => {
    expect(parseTail("1d0LFaLM")).toBe(0n);
  });

  it("rejects characters outside the alphabet", () => {
    expect(() => parseTail("1d0LFaLM8f-m")).toThrow(/invalid PLID character/);
  });
});

describe("isAlphabet", () => {
  it("checks every character", () => {
    expect(isAlphabet("1d0LFaLM8fLm")).toBe(true);
    expect(isAlphabet("")).toBe(true);
    expect(isAlphabet("1d0LFaL-")).toBe(false);
    expect(isAlphabet("1d0LFaL É")).toBe(false);
    expect(isAlphabet("1d0LFaLM😀")).toBe(false);
  });
});
