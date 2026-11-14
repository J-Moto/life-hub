import { describe, expect, it } from "vitest";
import { addDays, localDay, weeklyPercents } from "../src/domain/week";
import { cleanTitle, validTaskId, withJobPrefix } from "../src/domain/input";
import { isSameOrigin } from "../src/auth/origin";
import { offsetFor } from "../src/api";

const TZ = "America/Indiana/Indianapolis";

describe("localDay", () => {
  it("uses the local date, not UTC", () => {
    // 2026-11-15 03:00 UTC is still Saturday Nov 14 in Indianapolis (UTC-5).
    const d = localDay(new Date("2026-11-15T03:00:00Z"), TZ);
    expect(d.isoDate).toBe("2026-11-14");
    expect(d.weekdayIndex).toBe(5); // Saturday
  });

  it("adds days across month ends", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("knows the offset across daylight saving", () => {
    expect(offsetFor(new Date("2026-11-14T12:00:00Z"), TZ)).toBe("-05:00");
    expect(offsetFor(new Date("2026-07-01T12:00:00Z"), TZ)).toBe("-04:00");
  });
});

describe("weeklyPercents", () => {
  const habits = [{ id: "h1", name: "Job action" }];

  it("counts against days so far, Monday to today", () => {
    const wed = localDay(new Date("2026-11-11T17:00:00Z"), TZ); // Wed Nov 11
    const r = weeklyPercents(wed, habits, [
      { habitId: "h1", stamp: "20261109" },
      { habitId: "h1", stamp: "20261111" },
      { habitId: "h1", stamp: "20261108" }, // previous Sunday: ignored
    ]);
    expect(r[0]).toMatchObject({ daysDone: 2, daysSoFar: 3, percent: 67 });
  });

  it("counts duplicate check-ins on one day once", () => {
    const mon = localDay(new Date("2026-11-09T17:00:00Z"), TZ);
    const r = weeklyPercents(mon, habits, [
      { habitId: "h1", stamp: "20261109" },
      { habitId: "h1", stamp: "20261109" },
    ]);
    expect(r[0]).toMatchObject({ daysDone: 1, daysSoFar: 1, percent: 100 });
  });
});

describe("input checks", () => {
  it("cleans titles", () => {
    expect(cleanTitle("  open   resume\ndoc ")).toBe("open resume doc");
    expect(cleanTitle("")).toBeNull();
    expect(cleanTitle("x".repeat(301))).toBeNull();
    expect(cleanTitle(42)).toBeNull();
  });

  it("adds the JOB prefix once", () => {
    expect(withJobPrefix("apply", true)).toBe("JOB: apply");
    expect(withJobPrefix("JOB: apply", true)).toBe("JOB: apply");
    expect(withJobPrefix("apply", "true")).toBe("apply");
  });

  it("validates task ids", () => {
    expect(validTaskId("6ac829f58fe81123b0630cba")).toBe(true);
    expect(validTaskId("../etc")).toBe(false);
    expect(validTaskId("")).toBe(false);
  });
});

describe("isSameOrigin", () => {
  const url = "https://hub.example.com/api/next";
  it("accepts a same-origin Origin header", () => {
    expect(isSameOrigin(new Request(url, { method: "POST", headers: { Origin: "https://hub.example.com" } }))).toBe(true);
  });
  it("rejects a cross-site Origin", () => {
    expect(isSameOrigin(new Request(url, { method: "POST", headers: { Origin: "https://evil.com" } }))).toBe(false);
  });
  it("falls back to Sec-Fetch-Site", () => {
    expect(isSameOrigin(new Request(url, { method: "POST", headers: { "Sec-Fetch-Site": "same-origin" } }))).toBe(true);
    expect(isSameOrigin(new Request(url, { method: "POST", headers: { "Sec-Fetch-Site": "cross-site" } }))).toBe(false);
  });
  it("rejects when neither header is present", () => {
    expect(isSameOrigin(new Request(url, { method: "POST" }))).toBe(false);
  });
});
