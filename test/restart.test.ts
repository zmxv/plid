import { describe, expect, it } from "vitest";
import {
  createGenerator,
  decode,
  MAX_MS,
  offset,
  timestamp,
} from "../src/index.js";
import { MS } from "./support.js";

describe("since", () => {
  it("resumes above an ID the previous process emitted", () => {
    // A process mints, then dies; the clock steps back before it restarts.
    const before = { ms: MS };
    const dead = createGenerator({ length: 12, now: () => before.ms, offset: () => 2 });
    const emitted = Array.from({ length: 40 }, () => dead.next());
    const max = emitted[39]!;

    const after = { ms: MS - 5_000 }; // NTP step-back across the restart
    const naive = createGenerator({ length: 12, now: () => after.ms, offset: () => 2 });
    expect(naive.next() < max).toBe(true); // § 4's warning, reproduced

    const resumed = createGenerator({
      length: 12,
      now: () => after.ms,
      offset: () => 2,
      since: max,
    });
    const next = Array.from({ length: 40 }, () => resumed.next());
    expect(next.every((id) => id > max)).toBe(true);
    expect([...next].sort()).toEqual(next);
  });

  it("continues the counter when the width matches", () => {
    const clock = { ms: MS };
    const g = createGenerator({ length: 12, now: () => clock.ms, offset: () => 2 });
    const last = g.next();

    const resumed = createGenerator({
      length: 12,
      now: () => clock.ms,
      offset: () => 2,
      since: last,
      seed: () => {
        throw new Error("a same-width resume must not need a seed");
      },
    });
    // Its exact successor, not a random draw that might land on a used value.
    expect(decode(resumed.next()).entropy).toBe(decode(last).entropy + 1n);
  });

  it("takes the next millisecond when the width differs", () => {
    const clock = { ms: MS };
    const narrow = createGenerator({ length: 10, now: () => clock.ms, offset: () => 2 });
    const last = narrow.next();

    const wide = createGenerator({
      length: 16,
      now: () => clock.ms - 1_000, // clock behind, so `since` is what holds the floor
      offset: () => 2,
      since: last,
      seed: () => 7n,
    });
    const id = wide.next();
    // Holding `last`'s stamp would not do: entropy fields of different widths
    // are not comparable, and this seed would put the wide ID below `last`.
    expect(timestamp(id)).toBe(MS + 1);
    expect(decode(id).entropy).toBe(8n); // 7 seeded, +1 for the held stamp
    expect(offset(id)).toBe(0); // `last`'s offset bits, carried across
    expect(id > last).toBe(true);
  });

  it("stays above a predecessor whatever offset it carried", () => {
    // The hole a millisecond-only floor left: prior IDs with offset bits 1–3
    // sort above `ms << 2`, so a floor of "that millisecond" was not enough.
    for (const bits of [1, 2, 3] as const) {
      const prior = createGenerator({
        length: 12,
        now: () => MS,
        offset: () => bits,
      }).next();
      for (const length of [10, 12, 16]) {
        const resumed = createGenerator({
          length,
          now: () => MS - 5_000,
          offset: () => 2,
          since: prior,
        });
        const ids = Array.from({ length: 5 }, () => resumed.next());
        expect(ids.every((id) => id > prior)).toBe(true);
        expect([...ids].sort()).toEqual(ids);
      }
    }
  });

  it("keeps the offset when resuming from an ID that carried one", () => {
    const clock = { ms: MS };
    const first = createGenerator({ length: 12, now: () => clock.ms, offset: () => 3 }).next();
    const resumed = createGenerator({
      length: 12,
      now: () => MS - 1_000,
      offset: () => 3,
      since: first,
    });
    expect(offset(resumed.next())).toBe(1); // +1 day, as the dead process recorded
  });

  it("is inert once the clock passes it", () => {
    const old = createGenerator({ length: 12, now: () => MS - 10_000, offset: () => 2 }).next();
    const g = createGenerator({
      length: 12,
      now: () => MS,
      offset: () => 2,
      since: old,
    });
    expect(timestamp(g.next())).toBe(MS); // the real clock wins
  });

  it("rejects a malformed floor rather than lowering it silently", () => {
    expect(() => createGenerator({ since: "1d0LFaL" })).toThrow(SyntaxError);
    expect(() => createGenerator({ since: "1d0LFa-M8fLm" })).toThrow(/invalid PLID character/);
    expect(() => createGenerator({ since: "x".repeat(33) })).toThrow(SyntaxError);
    // A millisecond is no longer a floor: pass the ID, not the time it carries.
    expect(() => createGenerator({ since: MS as unknown as string })).toThrow(TypeError);
    expect(() => createGenerator({ since: null as unknown as string })).toThrow(TypeError);
  });

  it("refuses to resume past the end of the timestamp field", () => {
    const last = createGenerator({ length: 12, now: () => MAX_MS, offset: () => 3 }).next();
    expect(() => createGenerator({ length: 16, since: last })).toThrow(/exhausted/);
    // Same width needs no millisecond, so it still resumes.
    expect(createGenerator({ length: 12, now: () => MAX_MS, offset: () => 3, since: last }).next())
      .toHaveLength(12);
  });

  it("survives a round trip through the store's maximum key", () => {
    // The § 4 recipe end to end: read max(id), restart, keep sorting.
    const rows: string[] = [];
    let clock = MS;
    for (let restart = 0; restart < 5; restart++) {
      const max = rows.length ? rows.reduce((a, b) => (a > b ? a : b)) : undefined;
      const g = createGenerator({
        length: 12,
        now: () => clock,
        offset: () => 2,
        ...(max === undefined ? {} : { since: max }),
      });
      for (let i = 0; i < 20; i++) rows.push(g.next());
      clock -= 1_000; // every restart lands on a clock that has gone backwards
    }
    expect([...rows].sort()).toEqual(rows);
    expect(new Set(rows).size).toBe(rows.length);
  });
});
