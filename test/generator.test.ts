import { describe, expect, it } from "vitest";
import {
  createGenerator,
  decode,
  MAX_MS,
  offset,
  plid,
  stamp,
  timestamp,
} from "../src/index.js";
import { MS, fixed } from "./support.js";

describe("createGenerator", () => {
  it("emits IDs of exactly the requested length", () => {
    const clock = { ms: MS };
    for (const length of [8, 9, 10, 11, 12, 13, 14, 16, 20]) {
      const g = fixed(length, clock);
      expect(g.length).toBe(length);
      expect(g.next()).toHaveLength(length);
    }
  });

  it("defaults to PLID-12", () => {
    expect(createGenerator().length).toBe(12);
    expect(createGenerator({ now: () => MS, offset: () => 2 }).next()).toHaveLength(12);
  });

  it("puts the millisecond and offset in the first 8 characters", () => {
    const clock = { ms: MS };
    const id = fixed(14, clock).next();
    expect(id.slice(0, 8)).toBe("1d0LFaLM");
    expect(decode(id)).toMatchObject({ ms: MS, offset: 0, K: 6 });
  });

  it("is strictly ascending within one millisecond", () => {
    const clock = { ms: MS };
    const g = createGenerator({ length: 12, now: () => clock.ms, offset: () => 2 });
    const ids = Array.from({ length: 500 }, () => g.next());
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(timestamp(id)).toBe(MS);
  });

  it("is strictly ascending across advancing milliseconds", () => {
    const clock = { ms: MS };
    const g = createGenerator({ length: 12, now: () => clock.ms, offset: () => 2 });
    const ids: string[] = [];
    for (let i = 0; i < 300; i++) {
      ids.push(g.next());
      if (i % 3 === 0) clock.ms += 1;
    }
    expect([...ids].sort()).toEqual(ids);
  });

  it("draws no seed for PLID-8, which has no field", () => {
    const clock = { ms: MS };
    const g = createGenerator({
      length: 8,
      now: () => clock.ms,
      offset: () => 2,
      seed: () => {
        throw new Error("PLID-8 has no field to seed");
      },
    });
    expect(decode(g.next()).entropy).toBe(0n);
    clock.ms += 1;
    expect(decode(g.next()).entropy).toBe(0n);
  });

  it("seeds the whole 6K-bit field", () => {
    const clock = { ms: MS };
    // [total length, seed bits] — the entire entropy field, no reservation.
    const widths: Array<[number, number]> = [
      [9, 6],
      [10, 12],
      [11, 18],
      [12, 24],
      [16, 48],
      [20, 72],
      [32, 144], // the widest length allowed
    ];
    for (const [length, seedBits] of widths) {
      const g = createGenerator({
        length,
        now: () => clock.ms,
        offset: () => 2,
        seed: (bits) => {
          expect(bits).toBe(seedBits);
          return (1n << BigInt(bits)) - 1n; // an all-ones draw is a legal seed
        },
      });
      // The top of the field is reachable: nothing is held back from the seed.
      expect(decode(g.next()).entropy).toBe((1n << BigInt(seedBits)) - 1n);
      // …and a seed at the ceiling leaves no room, so the next ID borrows.
      expect(timestamp(g.next())).toBe(MS + 1);
    }
  });

  it("increments by exactly 1 within a millisecond, from wherever it seeded", () => {
    const clock = { ms: MS };
    for (const [length, seed] of [
      [12, 0n],
      [12, 65_535n], // a mid-field seed in PLID-12's 24-bit range
      [16, 1_234_567n],
      [9, 0n], // no seed bits at all
    ] as const) {
      const g = createGenerator({
        length,
        now: () => clock.ms,
        offset: () => 2,
        seed: () => seed,
      });
      for (let i = 0; i < 20; i++) {
        expect(decode(g.next()).entropy).toBe(seed + BigInt(i));
      }
      clock.ms += 1; // a new millisecond reseeds rather than continuing to count
      expect(decode(g.next()).entropy).toBe(seed);
    }
  });

  it("uses the whole field between the seed and the ceiling", () => {
    const clock = { ms: MS };
    // PLID-10 seeds 12 bits; from a seed of 0, all 4,096 values are available
    // before the counter overflows — the capacity a fixed +1 step preserves.
    const g = createGenerator({
      length: 10,
      now: () => clock.ms,
      offset: () => 2,
      seed: () => 0n,
    });
    const ids = Array.from({ length: 4_096 }, () => g.next());
    expect(ids.every((id) => timestamp(id) === MS)).toBe(true);
    expect(decode(ids[4_095]!).entropy).toBe(4_095n);
    expect(timestamp(g.next())).toBe(MS + 1); // 4,097th borrows
  });

  it("borrows a whole millisecond on entropy overflow, leaving the offset intact", () => {
    const clock = { ms: MS };
    const g = fixed(9, clock); // PLID-9: the counter caps at 64 per millisecond
    const ids = Array.from({ length: 65 }, () => g.next());
    expect(ids.slice(0, 64).every((id) => timestamp(id) === MS)).toBe(true);
    // The 65th overflows: += 4 on the stamp is +1 ms with the offset untouched.
    expect(timestamp(ids[64]!)).toBe(MS + 1);
    expect(decode(ids[64]!).offset).toBe(0);
    expect(decode(ids[64]!).entropy).toBe(0n);
    expect([...ids].sort()).toEqual(ids);
  });

  it("holds monotonicity when the clock steps backwards", () => {
    const clock = { ms: MS };
    const g = createGenerator({ length: 12, now: () => clock.ms, offset: () => 2 });
    const before = g.next();
    clock.ms -= 5_000; // NTP step-back, VM migration, leap smear
    const ids = Array.from({ length: 50 }, () => g.next());
    expect(ids.every((id) => id > before)).toBe(true);
    expect([...ids].sort()).toEqual(ids);
    // The stamp is held, not rewound.
    for (const id of ids) expect(timestamp(id)).toBe(MS);
  });

  it("holds monotonicity when only the offset falls", () => {
    const clock = { ms: MS };
    let off: 1 | 2 | 3 = 3;
    const g = createGenerator({ length: 12, now: () => clock.ms, offset: () => off });
    const before = g.next();
    off = 1; // the device's zone was reconfigured mid-millisecond
    const after = g.next();
    expect(after > before).toBe(true);
    expect(decode(after).offset).toBe(1);
  });

  it("accepts a per-call offset override, including 0 for 'not encoded'", () => {
    const clock = { ms: MS };
    const g = createGenerator({ length: 12, now: () => clock.ms, offset: () => 2 });
    // Ascending overrides within one millisecond: each raises the stamp.
    expect(decode(g.next(0)).offset).toBeNull();
    expect(decode(g.next(1)).offset).toBe(-1);
    expect(decode(g.next(2)).offset).toBe(0);
    expect(decode(g.next(3)).offset).toBe(1);
    // A lower override is a stamp regression: the held stamp wins (§ 4), so
    // the offset that comes back is the last one emitted, not the one asked for.
    expect(decode(g.next(0)).offset).toBe(1);
  });

  it("takes the default offset from the option when no override is passed", () => {
    const clock = { ms: MS };
    const g = createGenerator({ length: 12, now: () => clock.ms, offset: () => 0 });
    expect(decode(g.next()).offset).toBeNull();
  });

  it("keeps separate state per generator", () => {
    const clock = { ms: MS };
    const narrow = fixed(9, clock);
    const wide = fixed(14, clock);
    // 64 narrow IDs exhaust PLID-9; the wide generator's counter is untouched.
    for (let i = 0; i < 64; i++) narrow.next();
    expect(timestamp(wide.next())).toBe(MS);
    expect(timestamp(narrow.next())).toBe(MS + 1);
  });

  it("rejects a length shorter than the stamp, or a bad offset", () => {
    expect(() => createGenerator({ length: 7 })).toThrow(/length must be an integer/);
    expect(() => createGenerator({ length: -1 })).toThrow(RangeError);
    expect(() => createGenerator({ length: 0 })).toThrow(RangeError);
    expect(() => createGenerator({ length: 9.5 })).toThrow(RangeError);
    expect(() => createGenerator({ length: Number.NaN })).toThrow(RangeError);
    const g = createGenerator({ length: 12, now: () => MS, offset: () => 2 });
    expect(() => g.next(4 as unknown as 3)).toThrow(RangeError);
  });

  it("rejects a length past the widest sensible profile", () => {
    expect(createGenerator({ length: 32, now: () => MS, offset: () => 2 }).next())
      .toHaveLength(32);
    expect(() => createGenerator({ length: 33 })).toThrow(/\[8, 32\]/);
    // The mistake this really guards: a millisecond passed as a length.
    expect(() => plid(Date.now())).toThrow(RangeError);
  });

  it("rejects a clock outside the 46-bit field", () => {
    const g = createGenerator({ length: 12, now: () => 2 ** 46, offset: () => 2 });
    expect(() => g.next()).toThrow(RangeError);
  });

  it("throws rather than wrapping when borrowing runs past the field's end", () => {
    const g = createGenerator({
      length: 8,
      now: () => MAX_MS,
      offset: () => 3, // the very last stamp the field holds
    });
    expect(g.next()).toBe("~~~~~~~~");
    expect(() => g.next()).toThrow(/exhausted/);
  });
});

describe("plid", () => {
  it("defaults to PLID-12 and reflects the real clock", () => {
    const before = Date.now();
    const id = plid();
    const after = Date.now();
    expect(id).toHaveLength(12);
    expect(timestamp(id)).toBeGreaterThanOrEqual(before);
    expect(timestamp(id)).toBeLessThanOrEqual(after + 1);
  });

  it("takes the profile name, so plid(12) is a PLID-12", () => {
    for (const length of [9, 10, 11, 12, 13, 14, 16]) {
      expect(plid(length)).toHaveLength(length);
    }
  });

  it("emits unique, ascending IDs at every profile", () => {
    for (const length of [9, 10, 11, 12, 13, 14, 16]) {
      const ids = Array.from({ length: 200 }, () => plid(length));
      expect(ids.every((id) => id.length === length)).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
      expect([...ids].sort()).toEqual(ids);
    }
  });

  it("mints a bare PLID-8 stamp, which stamp(ms) is not", () => {
    const ids = Array.from({ length: 5 }, () => plid(8));
    expect(ids.every((id) => id.length === 8)).toBe(true);
    expect(new Set(ids).size).toBe(5);
    expect([...ids].sort()).toEqual(ids); // monotonic, by borrowing milliseconds

    // The difference from stamp: a minted ID records the generator's date
    // offset, while a range bound writes bits 0 so it sorts below all four.
    expect(offset(ids[0]!)).not.toBeNull();
    expect(offset(stamp(Date.now()))).toBeNull();
  });

  it("rejects a length that cannot hold a stamp", () => {
    expect(() => plid(7)).toThrow(RangeError);
    expect(() => plid(0)).toThrow(RangeError);
  });

  it("encodes a real date offset by default and none when asked", () => {
    expect([-1, 0, 1]).toContain(decode(plid()).offset);
    // PLID-15 is used nowhere else in this suite, so this is the first call to
    // its generator — no held stamp can outrank the 0 override (§ 4).
    expect(decode(plid(15, 0)).offset).toBeNull();
  });
});
