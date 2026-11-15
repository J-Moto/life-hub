import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { routeRequest } from "../src/router";
import { setDevFakes } from "../src/api";
import { FakeCalendarSource, FakeTaskSource } from "../src/sources/fakes";
import type { Task, TaskReader } from "../src/sources/types";
import type { Env } from "../src/env";

// The routing that runs after the Access check, called directly. The Access check itself
// is covered in access.test.ts and worker.test.ts.

const HUB = "https://hub.example.com";
const MINIMUM = "JOB: save 1 posting";

const fakesOn = {
  TIME_ZONE: "America/Indiana/Indianapolis",
  USE_FAKES: "true",
  MINIMUM_TASK_TEXT: MINIMUM,
} as unknown as Env;
const fakesOff = { ...fakesOn, USE_FAKES: "false" } as Env;

const START: Task[] = [
  { id: "a", projectId: "today", title: "JOB: apply to 1 role", done: false, sortOrder: 0 },
  { id: "b", projectId: "today", title: "Finish video", done: false, sortOrder: 1 },
  { id: "x", projectId: "next", title: "Later thing", done: false, sortOrder: 0 },
];

/** Each write route with a body it would accept. */
const WRITE_ROUTES = [
  { path: "/api/tasks/a/complete", body: "{}" },
  { path: "/api/next", body: '{"title":"New thing"}' },
  { path: "/api/restart", body: "{}" },
];

const JSON_FROM_HUB = { Origin: HUB, "Content-Type": "application/json" };

let tasks: FakeTaskSource;

/** The read part only. A handler that tries to write through it throws. */
const readOnly = (t: FakeTaskSource): TaskReader => ({
  listOpenTasks: (projectId) => t.listOpenTasks(projectId),
  listHabits: (habitIds) => t.listHabits(habitIds),
  listCheckins: (habitIds, from, to) => t.listCheckins(habitIds, from, to),
});

beforeEach(() => {
  tasks = new FakeTaskSource({ tasks: structuredClone(START) });
  setDevFakes({ tasks: readOnly(tasks), calendar: new FakeCalendarSource([]), taskWriter: tasks });
});

afterEach(() => setDevFakes(null));

function post(env: Env, path: string, headers: Record<string, string>, body?: string): Promise<Response> {
  return routeRequest(new Request(`${HUB}${path}`, { method: "POST", headers, body }), env);
}

/** No task was completed, added or moved. */
function expectNothingWritten(): void {
  expect(tasks.tasks).toEqual(START);
}

describe("POST checks", () => {
  it("refuses a POST from another origin", async () => {
    for (const { path, body } of WRITE_ROUTES) {
      const res = await post(fakesOn, path, { Origin: "https://evil.example", "Content-Type": "application/json" }, body);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: "cross_site" });
    }
    expectNothingWritten();
  });

  it("refuses a POST with no Origin", async () => {
    for (const { path, body } of WRITE_ROUTES) {
      const bare = await post(fakesOn, path, { "Content-Type": "application/json" }, body);
      expect(bare.status).toBe(403);
      expect(await bare.json()).toMatchObject({ error: "cross_site" });

      // Sec-Fetch-Site is not accepted in place of Origin.
      const hinted = await post(fakesOn, path, { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" }, body);
      expect(hinted.status).toBe(403);
    }
    expectNothingWritten();
  });

  it("refuses a POST without a JSON body", async () => {
    const notJson: { headers: Record<string, string>; body?: string }[] = [
      { headers: { Origin: HUB } }, // no body at all
      { headers: JSON_FROM_HUB, body: "" }, // says JSON, sends nothing
      { headers: { Origin: HUB, "Content-Type": "application/x-www-form-urlencoded" }, body: "title=x" },
      // JSON text under a type a cross-site form could send without a preflight.
      { headers: { Origin: HUB, "Content-Type": "text/plain" }, body: '{"title":"x"}' },
    ];
    for (const { path } of WRITE_ROUTES) {
      for (const { headers, body } of notJson) {
        const res = await post(fakesOn, path, headers, body);
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: "bad_body" });
      }
    }
    expectNothingWritten();
  });

  it("refuses a POST whose body is not a JSON object", async () => {
    const notObjects = ['["x"]', '"x"', "42", "null", '{"title":'];
    for (const { path } of WRITE_ROUTES) {
      for (const body of notObjects) {
        const res = await post(fakesOn, path, JSON_FROM_HUB, body);
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: "bad_body" });
      }
    }
    expectNothingWritten();
  });
});

describe("write gate", () => {
  it("answers not_enabled for each write route when fake data is off", async () => {
    for (const { path, body } of WRITE_ROUTES) {
      const res = await post(fakesOff, path, JSON_FROM_HUB, body);
      // Not 401 or 403 (the page reads those as "sign in again"), and not not_connected.
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "not_enabled" });
    }
    expectNothingWritten();
  });

  it("runs each write route when fake data is on", async () => {
    const completed = await post(fakesOn, "/api/tasks/a/complete", JSON_FROM_HUB, "{}");
    expect(completed.status).toBe(200);
    expect(tasks.tasks.find((t) => t.id === "a")!.done).toBe(true);

    const added = await post(fakesOn, "/api/next", JSON_FROM_HUB, '{"title":"  open resume  doc ","job":true}');
    expect(added.status).toBe(201);
    expect(tasks.tasks.at(-1)).toMatchObject({ projectId: "next", title: "JOB: open resume doc" });

    const restarted = await post(fakesOn, "/api/restart", JSON_FROM_HUB, "{}");
    expect(restarted.status).toBe(200);
    expect(await restarted.json()).toMatchObject({ ok: true, moved: 1 });
    expect((await tasks.listOpenTasks("today")).map((t) => t.title)).toEqual([MINIMUM]);
  });

  it("answers not_connected for a read route when fake data is off", async () => {
    const res = await routeRequest(new Request(`${HUB}/api/today`), fakesOff);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "not_connected", provider: "ticktick" });
  });
});
