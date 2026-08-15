import { describe, expect, it } from "vitest";
import { createGenerator, decode, stamp, timestamp } from "../src/index.js";
import { MS } from "./support.js";

describe("lexicographic order", () => {
  it("matches creation order across mixed widths", () => {
    const clock = { ms: MS };
    const widths = [9, 10, 12, 14, 16].map((length) =>
      createGenerator({ length, now: () => clock.ms, offset: () => 2 }),
    );
    const emitted: Array<{ id: string; ms: number }> = [];
    for (let i = 0; i < 200; i++) {
      const g = widths[i % widths.length]!;
      emitted.push({ id: g.next(), ms: clock.ms });
      clock.ms += 1; // distinct milliseconds: § 5.3 only orders across those
    }
    const sorted = [...emitted].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    expect(sorted.map((e) => e.ms)).toEqual(emitted.map((e) => e.ms));
  });

  it("keeps a truncated ID's timestamp, offset and position", () => {
    const clock = { ms: MS };
    const g = createGenerator({ length: 16, now: () => clock.ms, offset: () => 3 });
    const wide = g.next();
    for (let K = 8; K >= 0; K--) {
      const truncated = wide.slice(0, 8 + K);
      expect(timestamp(truncated)).toBe(MS);
      expect(decode(truncated).offset).toBe(1);
      // A prefix sorts at or below the value it was taken from.
      expect(truncated <= wide).toBe(true);
    }
  });

  it("bounds a half-open time range regardless of offset", () => {
    const clock = { ms: MS };
    const generators = [1, 2, 3].map((off) =>
      createGenerator({
        length: 12,
        now: () => clock.ms,
        offset: () => off as 1 | 2 | 3,
      }),
    );
    const inside: string[] = [];
    const outside: string[] = [];
    for (const g of generators) {
      clock.ms = MS - 1;
      outside.push(g.next());
      clock.ms = MS;
      inside.push(g.next());
      clock.ms = MS + 1;
      inside.push(g.next());
      clock.ms = MS + 2;
      outside.push(g.next());
    }
    const lo = stamp(MS);
    const hi = stamp(MS + 2);
    for (const id of inside) expect(id >= lo && id < hi).toBe(true);
    for (const id of outside) expect(id >= lo && id < hi).toBe(false);
  });

  it("makes every prefix a contiguous time bucket", () => {
    // An n-character prefix spans 2^(46 − 6n) ms, through n = 7.
    for (let n = 1; n <= 7; n++) {
      const span = 2 ** (46 - 6 * n);
      const base = Math.floor(MS / span) * span;
      const prefix = stamp(base).slice(0, n);
      for (const ms of [base, base + 1, base + span - 1]) {
        expect(stamp(ms).slice(0, n)).toBe(prefix);
      }
      expect(stamp(base + span).slice(0, n)).not.toBe(prefix);
    }
  });

  it("puts the bare stamp below every longer ID minted at that millisecond", () => {
    const clock = { ms: MS };
    const g = createGenerator({ length: 12, now: () => clock.ms, offset: () => 1 });
    const bound = stamp(MS);
    for (let i = 0; i < 20; i++) expect(g.next() > bound).toBe(true);
  });
});
