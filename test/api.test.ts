import { beforeEach, describe, expect, it } from "vitest";
import {
  addToNext,
  completeTask,
  getCalendar,
  getHabits,
  getTasks,
  readCalendarConfig,
  readHabitsConfig,
  readTasksConfig,
  restart,
  setDevFakes,
  type Config,
  type Sources,
} from "../src/api";
import type { Env } from "../src/env";
import { FakeCalendarSource, FakeTaskSource } from "../src/sources/fakes";
import type { TaskReader } from "../src/sources/types";
import { readOnly } from "./helpers/sources";

const cfg: Config = {
  todayProjectId: "today",
  nextProjectId: "next",
  habitIds: ["h1"],
  minimumTask: "JOB: save 1 posting",
  timeZone: "America/Indiana/Indianapolis",
};

let tasks: FakeTaskSource;
let reads: TaskReader;
let sources: Sources;

beforeEach(() => {
  tasks = new FakeTaskSource({
    tasks: [
      { id: "a", projectId: "today", title: "JOB: apply to 1 role", done: false, sortOrder: 0 },
      { id: "b", projectId: "today", title: "Finish video", done: false, sortOrder: 1 },
      { id: "x", projectId: "next", title: "Later thing", done: false, sortOrder: 0 },
    ],
    habits: [{ id: "h1", name: "Job action" }],
    checkins: [{ habitId: "h1", stamp: "20261109" }],
  });
  reads = readOnly(tasks);
  sources = { tasks: reads, calendar: new FakeCalendarSource([]) };
  setDevFakes(null);
});

const NOON = new Date("2026-11-11T17:00:00Z"); // 12:00 in Indianapolis
const allWrites = { completeTask: async () => {}, createTask: async () => ({}) as any, moveTask: async () => {} };

describe("GET /api/tasks", () => {
  it("returns Today's tasks with JOB flags", async () => {
    const res = await getTasks(reads, cfg, NOON, allWrites);
    const body = (await res.json()) as any;
    expect(body.date).toBe("2026-11-11");
    expect(body.tasks).toEqual([
      { id: "a", title: "JOB: apply to 1 role", job: true },
      { id: "b", title: "Finish video", job: false },
    ]);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("carries no habit or calendar data", async () => {
    const body = (await (await getTasks(reads, cfg, NOON, allWrites)).json()) as any;
    expect(body).not.toHaveProperty("habits");
    expect(body).not.toHaveProperty("calendar");
    expect(body).not.toHaveProperty("problems");
  });

  it("reports which write routes are switched on", async () => {
    const on = (await (await getTasks(reads, cfg, NOON, allWrites)).json()) as any;
    expect(on.writes).toEqual({ complete: true, next: true, restart: true });

    const none = (await (await getTasks(reads, cfg, NOON, {})).json()) as any;
    expect(none.writes).toEqual({ complete: false, next: false, restart: false });

    // Each route needs only its own methods; Restart needs both move and create.
    const onlyComplete = (await (await getTasks(reads, cfg, NOON, { completeTask: allWrites.completeTask })).json()) as any;
    expect(onlyComplete.writes).toEqual({ complete: true, next: false, restart: false });
    const onlyCreate = (await (await getTasks(reads, cfg, NOON, { createTask: allWrites.createTask })).json()) as any;
    expect(onlyCreate.writes).toEqual({ complete: false, next: true, restart: false });
    const onlyMove = (await (await getTasks(reads, cfg, NOON, { moveTask: allWrites.moveTask })).json()) as any;
    expect(onlyMove.writes).toEqual({ complete: false, next: false, restart: false });
  });
});

describe("GET /api/calendar", () => {
  const at = (h: number) => `2026-11-11T${String(h).padStart(2, "0")}:00:00-05:00`;

  it("returns the current day's events in time order", async () => {
    const calendar = new FakeCalendarSource([
      { id: "e2", title: "Later", start: at(15), end: at(16), allDay: false },
      { id: "e1", title: "Work Block", start: at(10), end: at(12), allDay: false },
      { id: "far", title: "Tomorrow", start: "2026-11-12T10:00:00-05:00", end: "2026-11-12T11:00:00-05:00", allDay: false },
    ]);
    const res = await getCalendar(calendar, cfg, NOON);
    const body = (await res.json()) as any;
    expect(body.date).toBe("2026-11-11");
    expect(body.events.map((e: any) => e.id)).toEqual(["e1", "e2"]);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("answers an empty list for an empty day", async () => {
    const body = (await (await getCalendar(new FakeCalendarSource([]), cfg, NOON)).json()) as any;
    expect(body.events).toEqual([]);
  });

  it("carries no task or habit data", async () => {
    const body = (await (await getCalendar(new FakeCalendarSource([]), cfg, NOON)).json()) as any;
    expect(body).not.toHaveProperty("tasks");
    expect(body).not.toHaveProperty("habits");
  });
});

describe("GET /api/habits", () => {
  it("returns the weekly percentages", async () => {
    const res = await getHabits(reads, cfg, NOON);
    const body = (await res.json()) as any;
    expect(body.date).toBe("2026-11-11");
    expect(body.habits[0]).toMatchObject({ percent: 33 });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("carries no task or calendar data", async () => {
    const body = (await (await getHabits(reads, cfg, NOON)).json()) as any;
    expect(body).not.toHaveProperty("tasks");
    expect(body).not.toHaveProperty("events");
  });
});

describe("settings per section", () => {
  const env = (vars: Record<string, string>) => ({ TIME_ZONE: "America/Indiana/Indianapolis", ...vars }) as unknown as Env;

  it("tasks need only the Today project ID", () => {
    expect(readTasksConfig(env({}), false)).toBeNull();
    expect(readTasksConfig(env({ TICKTICK_NEXT_PROJECT_ID: "n" }), false)).toBeNull();
    expect(readTasksConfig(env({ TICKTICK_TODAY_PROJECT_ID: "t" }), false)).toMatchObject({ todayProjectId: "t" });
  });

  it("an empty Today project ID is not configured, with or without fake data", () => {
    expect(readTasksConfig(env({ TICKTICK_TODAY_PROJECT_ID: "" }), false)).toBeNull();
    expect(readTasksConfig(env({ TICKTICK_TODAY_PROJECT_ID: "" }), true)).toBeNull();
  });

  it("habits need habit IDs and nothing about projects", () => {
    expect(readHabitsConfig(env({}), false)).toBeNull();
    expect(readHabitsConfig(env({ TICKTICK_HABIT_IDS: " , " }), false)).toBeNull();
    expect(readHabitsConfig(env({ TICKTICK_HABIT_IDS: "h1, h2" }), false)).toMatchObject({ habitIds: ["h1", "h2"] });
  });

  it("the calendar needs no TickTick setting", () => {
    expect(readCalendarConfig(env({}), false)).toMatchObject({ timeZone: "America/Indiana/Indianapolis" });
  });

  it("with fake data on, every section has what it needs without any setting", () => {
    expect(readTasksConfig(env({}), true)).toMatchObject({ todayProjectId: "today" });
    expect(readHabitsConfig(env({}), true)).toMatchObject({ habitIds: ["h-job", "h-phone", "h-home"] });
    expect(readCalendarConfig(env({}), true)).not.toBeNull();
  });
});

describe("complete", () => {
  it("completes a Today task", async () => {
    expect((await completeTask(reads, tasks, cfg, "a")).status).toBe(200);
    expect(tasks.tasks.find((t) => t.id === "a")!.done).toBe(true);
  });
  it("refuses tasks that aren't in Today", async () => {
    expect((await completeTask(reads, tasks, cfg, "x")).status).toBe(404);
    expect(tasks.tasks.find((t) => t.id === "x")!.done).toBe(false);
  });
  it("refuses odd ids", async () => {
    expect((await completeTask(reads, tasks, cfg, "../a")).status).toBe(400);
  });
});

describe("add to Next", () => {
  it("adds a cleaned task with JOB prefix", async () => {
    const res = await addToNext(tasks, cfg, { title: "  open resume  doc ", job: true });
    expect(res.status).toBe(201);
    expect(tasks.tasks.at(-1)).toMatchObject({ projectId: "next", title: "JOB: open resume doc" });
  });
  it("rejects bad bodies", async () => {
    // The body arrives already parsed; "not JSON" and "not an object" are the router's job.
    expect((await addToNext(tasks, cfg, { title: "" })).status).toBe(400);
    expect((await addToNext(tasks, cfg, {})).status).toBe(400);
    expect((await addToNext(tasks, cfg, { title: 42 })).status).toBe(400);
    expect(tasks.tasks.length).toBe(3);
  });
});

describe("restart", () => {
  it("moves Today's leftovers to Next and adds one Minimum task, deleting nothing", async () => {
    const before = tasks.tasks.length;
    const body = (await (await restart(reads, tasks, cfg)).json()) as any;
    expect(body).toMatchObject({ ok: true, moved: 2 });
    const today = await tasks.listOpenTasks("today");
    expect(today.map((t) => t.title)).toEqual(["JOB: save 1 posting"]);
    expect((await tasks.listOpenTasks("next")).length).toBe(3);
    expect(tasks.tasks.length).toBe(before + 1);
  });

  it("is safe to tap twice", async () => {
    await restart(reads, tasks, cfg);
    const body = (await (await restart(reads, tasks, cfg)).json()) as any;
    expect(body).toMatchObject({ ok: true, moved: 0 });
    expect((await tasks.listOpenTasks("today")).map((t) => t.title)).toEqual(["JOB: save 1 posting"]);
  });

  it("reports partial failure instead of pretending it worked", async () => {
    const realMove = tasks.moveTask.bind(tasks);
    tasks.moveTask = async (id, from, to) => {
      if (id === "b") throw new Error("down");
      return realMove(id, from, to);
    };
    const res = await restart(reads, tasks, cfg);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ ok: false, moved: 1, failed: 1 });
  });
});

describe("day window", () => {
  it("uses the right offset at midnight on DST change days", async () => {
    const { localMidnight } = await import("../src/api");
    // Nov 1 2026: clocks fall back at 2am, so midnight was still EDT (-04:00).
    expect(localMidnight("2026-11-01", "America/Indiana/Indianapolis")).toBe("2026-11-01T00:00:00-04:00");
    expect(localMidnight("2026-11-02", "America/Indiana/Indianapolis")).toBe("2026-11-02T00:00:00-05:00");
    // Mar 8 2026: spring forward at 2am, midnight still EST (-05:00).
    expect(localMidnight("2026-03-08", "America/Indiana/Indianapolis")).toBe("2026-03-08T00:00:00-05:00");
    expect(localMidnight("2026-03-09", "America/Indiana/Indianapolis")).toBe("2026-03-09T00:00:00-04:00");
  });
});
