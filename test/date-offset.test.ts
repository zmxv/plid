import { describe, expect, it } from "vitest";
import { dateOffset, DAY_MS } from "../src/index.js";
import { MS } from "./support.js";

describe("dateOffset", () => {
  it("reads the host zone when no zone is given", () => {
    expect([1, 2, 3]).toContain(dateOffset(MS));
  });

  it("agrees with the host zone's own calendar date", () => {
    const utcDay = Math.floor(MS / DAY_MS);
    const local = new Date(MS - new Date(MS).getTimezoneOffset() * 60_000);
    const localDay = Math.floor(local.getTime() / DAY_MS);
    expect(dateOffset(MS)).toBe(localDay - utcDay + 2);
  });

  it("resolves the three-way window from 10:00 to 12:00 UTC", () => {
    // At 10:00 UTC all three outcomes are live simultaneously — which is why
    // the field is 2 bits rather than 1.
    const t = Date.parse("2026-08-15T10:00:00Z");
    expect(dateOffset(t, "Pacific/Kiritimati")).toBe(3); // UTC+14, already tomorrow
    expect(dateOffset(t, "UTC")).toBe(2);
    expect(dateOffset(t, "Etc/GMT+12")).toBe(1); // UTC−12, still yesterday
  });

  it("tracks the date turning over in a single zone", () => {
    const zone = "Asia/Tokyo"; // UTC+9
    expect(dateOffset(Date.parse("2026-08-15T14:59:59Z"), zone)).toBe(2);
    expect(dateOffset(Date.parse("2026-08-15T15:00:00Z"), zone)).toBe(3);
  });

  it("handles half-hour and 45-minute zones", () => {
    const zone = "Asia/Kathmandu"; // UTC+5:45
    expect(dateOffset(Date.parse("2026-08-15T18:14:59Z"), zone)).toBe(2);
    expect(dateOffset(Date.parse("2026-08-15T18:15:00Z"), zone)).toBe(3);
    const india = "Asia/Kolkata"; // UTC+5:30
    expect(dateOffset(Date.parse("2026-08-15T18:29:59Z"), india)).toBe(2);
    expect(dateOffset(Date.parse("2026-08-15T18:30:00Z"), india)).toBe(3);
  });

  it("stays within ±1 day across a full day of instants in every extreme zone", () => {
    const zones = [
      "Pacific/Kiritimati",
      "Pacific/Chatham",
      "Asia/Tokyo",
      "Asia/Kathmandu",
      "Europe/Berlin",
      "UTC",
      "America/New_York",
      "America/Anchorage",
      "Pacific/Honolulu",
      "Etc/GMT+12",
    ];
    const start = Date.parse("2026-03-08T00:00:00Z"); // a US DST transition day
    for (const zone of zones) {
      for (let ms = start; ms < start + DAY_MS; ms += 7 * 60_000) {
        expect([1, 2, 3]).toContain(dateOffset(ms, zone));
      }
    }
  });

  it("survives a DST transition", () => {
    // 2026-03-08 02:00 local is skipped in America/New_York; the date relation
    // is unaffected either side of it.
    const zone = "America/New_York";
    expect(dateOffset(Date.parse("2026-03-08T02:00:00Z"), zone)).toBe(1); // 21:00 EST, 03-07
    expect(dateOffset(Date.parse("2026-03-08T06:00:00Z"), zone)).toBe(2); // 01:00 EST, 03-08
    expect(dateOffset(Date.parse("2026-03-08T08:00:00Z"), zone)).toBe(2); // 04:00 EDT, 03-08
  });

  it("rejects a millisecond the format cannot hold", () => {
    expect(() => dateOffset(-1)).toThrow(RangeError);
    expect(() => dateOffset(2 ** 46)).toThrow(RangeError);
    expect(() => dateOffset(Number.NaN, "UTC")).toThrow(RangeError);
  });

  it("caches formatters without confusing zones", () => {
    // Repeated calls must not leak one zone's formatter into another's answer.
    const t = Date.parse("2026-08-15T10:00:00Z");
    for (let i = 0; i < 100; i++) {
      expect(dateOffset(t, "Pacific/Kiritimati")).toBe(3);
      expect(dateOffset(t, "UTC")).toBe(2);
      expect(dateOffset(t, "Etc/GMT+12")).toBe(1);
    }
    expect(() => dateOffset(t, "Not/AZone")).toThrow(RangeError);
  });

  it("works at the epoch and far into the future", () => {
    expect(dateOffset(0, "UTC")).toBe(2);
    expect(dateOffset(0, "Pacific/Kiritimati")).toBe(1); // LMT−10:29 in 1970
    expect(dateOffset(Date.parse("2200-01-01T00:00:00Z"), "Asia/Tokyo")).toBe(2);
    expect(dateOffset(Date.parse("2200-01-01T20:00:00Z"), "Asia/Tokyo")).toBe(3);
  });
});
