import { beforeEach, describe, expect, it } from "vitest";
import { addToNext, completeTask, getToday, restart, setDevFakes, type Config, type Sources } from "../src/api";
import { FakeCalendarSource, FakeTaskSource } from "../src/sources/fakes";
import type { TaskReader } from "../src/sources/types";

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

/** The read part only. A handler that tries to write through it throws. */
const readOnly = (t: FakeTaskSource): TaskReader => ({
  listOpenTasks: (projectId) => t.listOpenTasks(projectId),
  listHabits: (habitIds) => t.listHabits(habitIds),
  listCheckins: (habitIds, from, to) => t.listCheckins(habitIds, from, to),
});

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
  sources = { tasks: reads, calendar: new FakeCalendarSource([]), taskWriter: tasks };
  setDevFakes(null);
});

describe("GET /api/today", () => {
  it("returns Today tasks with JOB flags and habit %", async () => {
    const res = await getToday(sources, cfg, new Date("2026-11-11T17:00:00Z"));
    const body = (await res.json()) as any;
    expect(body.today).toEqual([
      { id: "a", title: "JOB: apply to 1 role", job: true },
      { id: "b", title: "Finish video", job: false },
    ]);
    expect(body.habits[0]).toMatchObject({ percent: 33 });
    expect(body.problems).toEqual([]);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("still answers when one source fails", async () => {
    sources.calendar.listEvents = async () => {
      throw new Error("down");
    };
    const body = (await (await getToday(sources, cfg, new Date())).json()) as any;
    expect(body.calendar).toBeNull();
    expect(body.problems).toEqual(["calendar"]);
    expect(body.today).not.toBeNull();
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
