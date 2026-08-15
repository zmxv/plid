import { describe, expect, it } from "vitest";
import {
  createGenerator,
  dateOffset,
  localDate,
  localDateKey,
  MAX_MS,
  stamp,
  type OffsetBits,
} from "../src/index.js";
import { MS } from "./support.js";

/** An ID minted at `ms` with a chosen date offset, at any width. */
function mint(ms: number, bits: OffsetBits, length = 12): string {
  return createGenerator({ length, now: () => ms, offset: () => bits }).next();
}

/** The calendar date of `ms` in `zone`, straight from Intl — the oracle. */
function zoneDate(ms: number, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

describe("localDate", () => {
  it("reads each of the three encoded offsets", () => {
    expect(localDate("1d0LFaLL")).toBe("2026-08-14"); // bits 1: the day before
    expect(localDate("1d0LFaLM")).toBe("2026-08-15"); // bits 2: the UTC date
    expect(localDate("1d0LFaLN")).toBe("2026-08-16"); // bits 3: the day after
  });

  it("returns null when the minter encoded no local calendar", () => {
    expect(localDate("1d0LFaLK")).toBeNull(); // bits 0
    expect(localDate(stamp(MS))).toBeNull(); // a range bound has no minter
    expect(localDate(mint(MS, 0))).toBeNull();
  });

  it("works at any width, and on a bare stamp", () => {
    for (const length of [8, 9, 12, 16, 32]) {
      expect(localDate(mint(MS, 3, length))).toBe("2026-08-16");
    }
    expect(localDate("1d0LFaLN8fLm")).toBe("2026-08-16");
  });

  it("rolls over months and years in both directions", () => {
    const nye = Date.parse("2026-12-31T23:30:00Z");
    expect(localDate(mint(nye, 3))).toBe("2027-01-01");
    expect(localDate(mint(nye, 2))).toBe("2026-12-31");

    const nyd = Date.parse("2026-01-01T00:30:00Z");
    expect(localDate(mint(nyd, 1))).toBe("2025-12-31");
  });

  it("handles a leap day from either side", () => {
    expect(localDate(mint(Date.parse("2028-02-28T23:00:00Z"), 3))).toBe("2028-02-29");
    expect(localDate(mint(Date.parse("2028-03-01T01:00:00Z"), 1))).toBe("2028-02-29");
    // 2027 is not a leap year: the day after the 28th is March.
    expect(localDate(mint(Date.parse("2027-02-28T23:00:00Z"), 3))).toBe("2027-03-01");
  });

  it("holds at both ends of the timestamp field", () => {
    expect(localDate(mint(0, 2))).toBe("1970-01-01");
    expect(localDate(mint(0, 1))).toBe("1969-12-31"); // before the epoch
    expect(localDate(mint(MAX_MS, 2))).toBe("4199-11-24");
    expect(localDate(mint(MAX_MS, 3))).toBe("4199-11-25");
  });

  it("agrees with Intl for real zones across a whole day", () => {
    const zones = [
      "Pacific/Kiritimati",
      "Asia/Kathmandu",
      "Asia/Tokyo",
      "Europe/Berlin",
      "UTC",
      "America/New_York",
      "Etc/GMT+12",
    ];
    const start = Date.parse("2026-08-15T00:00:00Z");
    for (const zone of zones) {
      for (let ms = start; ms < start + 86_400_000; ms += 37 * 60_000) {
        // Mint the way a generator in that zone would, then read it back.
        const id = mint(ms, dateOffset(ms, zone));
        expect(localDate(id)).toBe(zoneDate(ms, zone));
      }
    }
  });

  it("rejects text that cannot carry a stamp", () => {
    expect(() => localDate("1d0LFaL")).toThrow(SyntaxError);
    expect(() => localDate("1d0LFa-M")).toThrow(/invalid PLID character/);
  });
});

describe("localDateKey", () => {
  it("packs the same date as YYYYMMDD", () => {
    expect(localDateKey("1d0LFaLL")).toBe(20_260_814);
    expect(localDateKey("1d0LFaLM")).toBe(20_260_815);
    expect(localDateKey("1d0LFaLN")).toBe(20_260_816);
    expect(localDateKey("1d0LFaLK")).toBeNull();
  });

  it("stays in step with localDate everywhere", () => {
    const cases = [0, 1, MS, Date.parse("2028-02-29T12:00:00Z"), MAX_MS];
    for (const ms of cases) {
      for (const bits of [1, 2, 3] as const) {
        const id = mint(ms, bits);
        expect(localDateKey(id)).toBe(Number(localDate(id)!.replaceAll("-", "")));
      }
    }
  });

  it("sorts in date order and stays a safe integer", () => {
    const days = [
      mint(0, 1),
      mint(0, 2),
      mint(MS, 2),
      mint(Date.parse("2027-01-01T00:00:00Z"), 2),
      mint(MAX_MS, 3),
    ].map((id) => localDateKey(id)!);
    expect([...days].sort((a, b) => a - b)).toEqual(days);
    expect(days[0]).toBe(19_691_231);
    expect(days.at(-1)).toBe(41_991_125);
    for (const d of days) expect(Number.isSafeInteger(d)).toBe(true);
  });

  it("groups without allocating, which is its whole reason to exist", () => {
    const counts = new Map<number, number>();
    for (let i = 0; i < 50; i++) {
      const id = mint(MS + i * 3_600_000, 2); // ~2 days of hourly IDs
      const key = localDateKey(id)!;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect([...counts.keys()].sort((a, b) => a - b)).toEqual([
      20_260_815, 20_260_816, 20_260_817,
    ]);
  });
});
