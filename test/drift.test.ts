import { describe, expect, it } from "vitest";
import { driftMs, plid, stamp, timestamp } from "../src/index.js";
import { MS, fixed } from "./support.js";

describe("driftMs", () => {
  it("is zero for an honestly minted ID", () => {
    const clock = { ms: MS };
    const g = fixed(12, clock);
    for (let i = 0; i < 100; i++) {
      expect(driftMs(g.next(), clock.ms)).toBe(0);
      clock.ms += 1;
    }
    expect(driftMs(plid())).toBe(0);
    expect(driftMs(stamp(Date.now()))).toBe(0);
  });

  it("is zero for a burst that fits the entropy field", () => {
    const clock = { ms: MS };
    const g = fixed(12, clock); // seeded at 0, PLID-12 holds 2^24 IDs per millisecond
    for (let i = 0; i < 5_000; i++) expect(driftMs(g.next(), clock.ms)).toBe(0);
  });

  it("shows the milliseconds a borrow invented", () => {
    const clock = { ms: MS };
    const g = fixed(9, clock); // PLID-9 caps at 64 per millisecond
    const ids = Array.from({ length: 64 * 3 + 1 }, () => g.next());
    expect(driftMs(ids[63]!, clock.ms)).toBe(0); // last honest ID of the millisecond
    expect(driftMs(ids[64]!, clock.ms)).toBe(1); // the first borrow
    expect(driftMs(ids[128]!, clock.ms)).toBe(2);
    expect(driftMs(ids[192]!, clock.ms)).toBe(3);
    expect(timestamp(ids[192]!)).toBe(MS + 3);
  });

  it("shows a clock step-back the entropy field absorbed", () => {
    const clock = { ms: MS };
    const g = fixed(12, clock);
    g.next();
    clock.ms = MS - 5_000; // NTP step-back, VM migration, leap smear
    // The stamp is held rather than rewound (§ 4), so every ID minted during
    // the fault claims a time 5 seconds in the future.
    for (let i = 0; i < 25; i++) expect(driftMs(g.next(), clock.ms)).toBe(5_000);
  });

  it("decays to zero as real time catches up", () => {
    const clock = { ms: MS };
    const g = fixed(9, clock);
    for (let i = 0; i < 64 * 5 + 1; i++) g.next();
    const id = g.next();
    expect(driftMs(id, MS)).toBe(5);
    expect(driftMs(id, MS + 3)).toBe(2); // still ahead, but less so
    expect(driftMs(id, MS + 5)).toBe(0); // recovered
    expect(driftMs(id, MS + 60_000)).toBe(0); // and never goes negative
  });

  it("reads any ID, of any width, from anywhere", () => {
    // Not minted here — a row out of a table, or another service's ID.
    expect(driftMs("1d0LFaLM8fLm", MS)).toBe(0);
    expect(driftMs("1d0LFaLM8fLm", MS - 250)).toBe(250);
    expect(driftMs("1d0LFaLM", MS - 250)).toBe(250); // a bare PLID-8 stamp
    expect(driftMs("1d0LFaLM0000000000", MS - 250)).toBe(250); // any width
  });

  it("defaults to the current clock", () => {
    const ahead = driftMs(stamp(Date.now() + 5_000));
    expect(ahead).toBeGreaterThan(4_000);
    expect(ahead).toBeLessThanOrEqual(5_000);
  });

  it("rejects text that cannot carry a stamp", () => {
    expect(() => driftMs("1d0LFaL")).toThrow(SyntaxError); // too short
    expect(() => driftMs("1d0LFa-M8fLm")).toThrow(/invalid PLID character/);
    // Like timestamp() and offset(), it reads the stamp and nothing else, so
    // the entropy characters are not validated. Use isPlid for that.
    expect(driftMs("1d0LFaLM8f-m", MS)).toBe(0);
  });
});
