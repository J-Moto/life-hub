import type { Env } from "./env";
import { addDays, localDay, mondayStamp, weeklyPercents } from "./domain/week";
import { cleanTitle, readJson, validTaskId, withJobPrefix } from "./domain/input";
import { NotConnectedError, type CalendarSource, type TaskSource } from "./sources/types";
import { sampleFakes } from "./sources/fakes";

export interface Sources {
  tasks: TaskSource;
  calendar: CalendarSource;
}

export interface Config {
  todayProjectId: string;
  nextProjectId: string;
  habitIds: string[];
  minimumTask: string;
  timeZone: string;
}

const DEFAULT_MINIMUM = "JOB: Open a job board, save 1 posting (done = 1 saved)";

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
    timeZone: env.TIME_ZONE || "America/Indiana/Indianapolis",
  };
}

let devFakes: Sources | null = null;

/** Real clients arrive with the OAuth features; until then only fakes exist. */
export function resolveSources(env: Env): Sources {
  if (env.USE_FAKES === "true") {
    devFakes ??= sampleFakes();
    return devFakes;
  }
  throw new NotConnectedError("ticktick");
}

/** For tests: replace the dev fakes. */
export function setDevFakes(s: Sources | null): void {
  devFakes = s;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

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

export async function getToday(sources: Sources, cfg: Config, now: Date): Promise<Response> {
  const day = localDay(now, cfg.timeZone);
  const start = localMidnight(day.isoDate, cfg.timeZone);
  const end = localMidnight(addDays(day.isoDate, 1), cfg.timeZone);

  const [tasks, events, habits, checkins] = await Promise.allSettled([
    sources.tasks.listOpenTasks(cfg.todayProjectId),
    sources.calendar.listEvents(start, end),
    sources.tasks.listHabits(cfg.habitIds),
    sources.tasks.listCheckins(cfg.habitIds, mondayStamp(day), day.stamp),
  ]);

  const problems: string[] = [];
  if (tasks.status === "rejected") problems.push("tasks");
  if (events.status === "rejected") problems.push("calendar");
  if (habits.status === "rejected" || checkins.status === "rejected") problems.push("habits");

  return json({
    date: day.isoDate,
    today:
      tasks.status === "fulfilled"
        ? tasks.value.map((t) => ({ id: t.id, title: t.title, job: /^JOB:/i.test(t.title) }))
        : null,
    calendar: events.status === "fulfilled" ? events.value : null,
    habits:
      habits.status === "fulfilled" && checkins.status === "fulfilled"
        ? weeklyPercents(day, habits.value, checkins.value)
        : null,
    problems,
  });
}

export async function completeTask(sources: Sources, cfg: Config, taskId: string): Promise<Response> {
  if (!validTaskId(taskId)) return json({ error: "bad_task_id" }, 400);
  // Only tasks currently in Today can be completed from the dashboard.
  const open = await sources.tasks.listOpenTasks(cfg.todayProjectId);
  if (!open.some((t) => t.id === taskId)) return json({ error: "not_in_today" }, 404);
  await sources.tasks.completeTask(cfg.todayProjectId, taskId);
  return json({ ok: true });
}

export async function addToNext(sources: Sources, cfg: Config, request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!body) return json({ error: "bad_body" }, 400);
  const title = cleanTitle(body.title);
  if (!title) return json({ error: "bad_title" }, 400);
  const task = await sources.tasks.createTask(cfg.nextProjectId, withJobPrefix(title, body.job));
  return json({ ok: true, id: task.id }, 201);
}

/**
 * Moves Today's leftovers to Next and adds one Minimum task. Safe to repeat: a second
 * tap (or a retry) leaves an already-fresh Today alone. Never deletes anything.
 */
export async function restart(sources: Sources, cfg: Config): Promise<Response> {
  const open = await sources.tasks.listOpenTasks(cfg.todayProjectId);
  const leftovers = open.filter((t) => t.title !== cfg.minimumTask);
  const hasMinimum = open.some((t) => t.title === cfg.minimumTask);

  let moved = 0;
  let failed = 0;
  for (const t of leftovers) {
    try {
      await sources.tasks.moveTask(t.id, cfg.todayProjectId, cfg.nextProjectId);
      moved++;
    } catch {
      failed++;
    }
  }
  if (!hasMinimum) await sources.tasks.createTask(cfg.todayProjectId, cfg.minimumTask);

  if (failed > 0) {
    return json({ ok: false, moved, failed, message: `Moved ${moved}, ${failed} didn't move. Try again.` }, 502);
  }
  return json({ ok: true, moved, failed: 0, message: "The system is back on." });
}
