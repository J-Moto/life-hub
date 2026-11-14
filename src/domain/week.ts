import type { Habit, HabitCheckin } from "../sources/types";

export interface LocalDay {
  stamp: string; // YYYYMMDD
  isoDate: string; // YYYY-MM-DD
  weekdayIndex: number; // Monday = 0 … Sunday = 6
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The local calendar day for `now` in `timeZone`. */
export function localDay(now: Date, timeZone: string): LocalDay {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const isoDate = `${get("year")}-${get("month")}-${get("day")}`;
  const weekdayIndex = WEEKDAYS.indexOf(get("weekday"));
  if (weekdayIndex < 0) throw new Error("weekday_parse_failed");
  return { isoDate, stamp: isoDate.replace(/-/g, ""), weekdayIndex };
}

/** Adds whole days to a YYYY-MM-DD date (calendar math, no time zone involved). */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface HabitWeek {
  habitId: string;
  name: string;
  daysDone: number;
  daysSoFar: number;
  percent: number;
}

/**
 * Weekly % per habit, Monday–Sunday, counted against days so far this week
 * (so Tuesday isn't "28%"). Duplicate check-ins on the same day count once.
 */
export function weeklyPercents(today: LocalDay, habits: Habit[], checkins: HabitCheckin[]): HabitWeek[] {
  const monday = addDays(today.isoDate, -today.weekdayIndex).replace(/-/g, "");
  const daysSoFar = today.weekdayIndex + 1;
  return habits.map((h) => {
    const days = new Set(
      checkins.filter((c) => c.habitId === h.id && c.stamp >= monday && c.stamp <= today.stamp).map((c) => c.stamp),
    );
    const daysDone = Math.min(days.size, daysSoFar);
    return { habitId: h.id, name: h.name, daysDone, daysSoFar, percent: Math.round((daysDone / daysSoFar) * 100) };
  });
}

export function mondayStamp(today: LocalDay): string {
  return addDays(today.isoDate, -today.weekdayIndex).replace(/-/g, "");
}
