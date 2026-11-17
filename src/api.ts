import type { Env } from "./env";
import { addDays, localDay, mondayStamp, weeklyPercents } from "./domain/week";
import { cleanTitle, validTaskId, withJobPrefix } from "./domain/input";
import {
  NotConnectedError,
  type CalendarSource,
  type TaskReader,
  type TaskWriter,
  type TaskWrites,
} from "./sources/types";
import { sampleFakes } from "./sources/fakes";

/**
 * What the read routes use, one part per section. A part is null when that provider is not
 * connected; the other sections still answer. The write part is separate: see `resolveTaskWrites`.
 */
export interface Sources {
  tasks: TaskReader | null;
  calendar: CalendarSource | null;
}

export interface Config {
  todayProjectId: string;
  nextProjectId: string;
  habitIds: string[];
  minimumTask: string;
  timeZone: string;
}

const DEFAULT_MINIMUM = "JOB: Open a job board, save 1 posting (done = 1 saved)";
const DEFAULT_TIME_ZONE = "America/Indiana/Indianapolis";

/** What each read route needs, and nothing more: each section has its own settings. */
export interface TasksConfig {
  todayProjectId: string;
  timeZone: string;
}
export interface HabitsConfig {
  habitIds: string[];
  timeZone: string;
}
export interface CalendarConfig {
  timeZone: string;
}

/** Fake data fills in what a setting would, so every section shows data in local dev. */
export function readTasksConfig(env: Env, usingFakes: boolean): TasksConfig | null {
  const today = env.TICKTICK_TODAY_PROJECT_ID ?? (usingFakes ? "today" : undefined);
  if (!today) return null;
  return { todayProjectId: today, timeZone: env.TIME_ZONE || DEFAULT_TIME_ZONE };
}

export function readHabitsConfig(env: Env, usingFakes: boolean): HabitsConfig | null {
  const habitIds = (env.TICKTICK_HABIT_IDS ?? (usingFakes ? "h-job,h-phone,h-home" : ""))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (habitIds.length === 0) return null;
  return { habitIds, timeZone: env.TIME_ZONE || DEFAULT_TIME_ZONE };
}

/** `CALENDAR_IDS` is read here from step 3b on; until then the calendar needs only the time zone. */
export function readCalendarConfig(env: Env, _usingFakes: boolean): CalendarConfig | null {
  return { timeZone: env.TIME_ZONE || DEFAULT_TIME_ZONE };
}

/** For the write routes, which need both project IDs. */
export function readConfig(env: Env, usingFakes: boolean): Config | null {
  const today = env.TICKTICK_TODAY_PROJECT_ID ?? (usingFakes ? "today" : undefined);
  const next = env.TICKTICK_NEXT_PROJECT_ID ?? (usingFakes ? "next" : undefined);
  const habits = (env.TICKTICK_HABIT_IDS ?? (usingFakes ? "h-job,h-phone,h-home" : ""))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!today || !next) return null;
  return {
    todayProjectId: today,
    nextProjectId: next,
    habitIds: habits,
    minimumTask: env.MINIMUM_TASK_TEXT?.trim() || DEFAULT_MINIMUM,
    timeZone: env.TIME_ZONE || DEFAULT_TIME_ZONE,
  };
}

let devFakes: { sources: Sources; writes: TaskWrites } | null = null;

function fakes(): { sources: Sources; writes: TaskWrites } {
  if (!devFakes) {
    const { tasks, calendar } = sampleFakes();
    devFakes = { sources: { tasks, calendar }, writes: tasks };
  }
  return devFakes;
}

/** Real clients arrive with the OAuth features; until then only fakes exist. */
export function resolveTasks(env: Env): TaskReader {
  const tasks = env.USE_FAKES === "true" ? fakes().sources.tasks : null;
  if (!tasks) throw new NotConnectedError("ticktick");
  return tasks;
}

export function resolveCalendar(env: Env): CalendarSource {
  const calendar = env.USE_FAKES === "true" ? fakes().sources.calendar : null;
  if (!calendar) throw new NotConnectedError("google");
  return calendar;
}

/**
 * The write methods that are switched on. This is the only place that decides it.
 * Fake data has all of them. The real TickTick client has none: steps 5, 6 and 8 add
 * one each, after that route's own security review.
 * Never throws, so the write gate can be checked before any provider is looked at.
 */
export function resolveTaskWrites(env: Env): TaskWrites {
  if (env.USE_FAKES === "true") return fakes().writes;
  return {};
}

/** For tests: replace the dev fakes. With no `writes`, no write method is switched on. */
export function setDevFakes(sources: Sources | null, writes: TaskWrites = {}): void {
  devFakes = sources ? { sources, writes } : null;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// Two of the answers the page knows by name (docs/design/v1.md, section 3). One place makes
// each, so `/api` and `/setup` can't come to answer differently.

/** A setting this route needs is missing or bad. */
export const notConfigured = (): Response => json({ error: "not_configured" }, 503);

/** This route is not switched on, or connections are not made here (G7). */
export const notEnabled = (): Response => json({ error: "not_enabled" }, 503);

/** The UTC offset of `timeZone` at `when`, as "+HH:MM" / "-HH:MM". */
export function offsetFor(when: Date, timeZone: string): string {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(when)
    .find((p) => p.type === "timeZoneName")?.value;
  const m = name?.match(/GMT([+-]\d{2}):?(\d{2})?/);
  if (!m) return "+00:00";
  return `${m[1]}:${m[2] ?? "00"}`;
}

/**
 * Local midnight of `isoDate` in `timeZone` as an ISO string with the offset that applies
 * AT that midnight (correct on daylight-saving change days).
 */
export function localMidnight(isoDate: string, timeZone: string): string {
  const guess = offsetFor(new Date(`${isoDate}T00:00:00Z`), timeZone);
  const instant = new Date(`${isoDate}T00:00:00${guess}`);
  return `${isoDate}T00:00:00${offsetFor(instant, timeZone)}`;
}

// The three read handlers. Each answers for one section; a provider failure is thrown, and
// the router turns it into the right answer (`not_connected`, or a 500 the page shows as a failure).

/** Today's unfinished tasks, and which write routes are switched on. */
export async function getTasks(
  tasks: TaskReader,
  cfg: Pick<TasksConfig, "todayProjectId" | "timeZone">,
  now: Date,
  writes: TaskWrites,
): Promise<Response> {
  const day = localDay(now, cfg.timeZone);
  const open = await tasks.listOpenTasks(cfg.todayProjectId);
  return json({
    date: day.isoDate,
    tasks: open.map((t) => ({ id: t.id, title: t.title, job: /^JOB:/i.test(t.title) })),
    // The same rule as the write gate in the router: a route is on when its methods exist.
    writes: {
      complete: typeof writes.completeTask === "function",
      next: typeof writes.createTask === "function",
      restart: typeof writes.moveTask === "function" && typeof writes.createTask === "function",
    },
  });
}

/** The current day's calendar events. */
export async function getCalendar(calendar: CalendarSource, cfg: CalendarConfig, now: Date): Promise<Response> {
  const day = localDay(now, cfg.timeZone);
  const start = localMidnight(day.isoDate, cfg.timeZone);
  const end = localMidnight(addDays(day.isoDate, 1), cfg.timeZone);
  return json({ date: day.isoDate, events: await calendar.listEvents(start, end) });
}

/** Weekly habit percentages. */
export async function getHabits(tasks: TaskReader, cfg: HabitsConfig, now: Date): Promise<Response> {
  const day = localDay(now, cfg.timeZone);
  const [habits, checkins] = await Promise.all([
    tasks.listHabits(cfg.habitIds),
    tasks.listCheckins(cfg.habitIds, mondayStamp(day), day.stamp),
  ]);
  return json({ date: day.isoDate, habits: weeklyPercents(day, habits, checkins) });
}

export async function completeTask(
  tasks: TaskReader,
  writer: Pick<TaskWriter, "completeTask">,
  cfg: Config,
  taskId: string,
): Promise<Response> {
  if (!validTaskId(taskId)) return json({ error: "bad_task_id" }, 400);
  // Only tasks currently in Today can be completed from the dashboard.
  const open = await tasks.listOpenTasks(cfg.todayProjectId);
  if (!open.some((t) => t.id === taskId)) return json({ error: "not_in_today" }, 404);
  await writer.completeTask(cfg.todayProjectId, taskId);
  return json({ ok: true });
}

/** `body` is the request's JSON object, already read and checked by the router. */
export async function addToNext(
  writer: Pick<TaskWriter, "createTask">,
  cfg: Config,
  body: Record<string, unknown>,
): Promise<Response> {
  const title = cleanTitle(body.title);
  if (!title) return json({ error: "bad_title" }, 400);
  const task = await writer.createTask(cfg.nextProjectId, withJobPrefix(title, body.job));
  return json({ ok: true, id: task.id }, 201);
}

/**
 * Moves Today's leftovers to Next and adds one Minimum task. Safe to repeat: a second
 * tap (or a retry) leaves an already-fresh Today alone. Never deletes anything.
 */
export async function restart(
  tasks: TaskReader,
  writer: Pick<TaskWriter, "moveTask" | "createTask">,
  cfg: Config,
): Promise<Response> {
  const open = await tasks.listOpenTasks(cfg.todayProjectId);
  const leftovers = open.filter((t) => t.title !== cfg.minimumTask);
  const hasMinimum = open.some((t) => t.title === cfg.minimumTask);

  let moved = 0;
  let failed = 0;
  for (const t of leftovers) {
    try {
      await writer.moveTask(t.id, cfg.todayProjectId, cfg.nextProjectId);
      moved++;
    } catch {
      failed++;
    }
  }
  if (!hasMinimum) await writer.createTask(cfg.todayProjectId, cfg.minimumTask);

  if (failed > 0) {
    return json({ ok: false, moved, failed, message: `Moved ${moved}, ${failed} didn't move. Try again.` }, 502);
  }
  return json({ ok: true, moved, failed: 0, message: "The system is back on." });
}
