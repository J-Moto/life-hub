import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { routeRequest } from "../src/router";
import type { VerifiedAccess } from "../src/auth/access";
import { setDevFakes, type Sources } from "../src/api";
import { FakeCalendarSource, FakeTaskSource } from "../src/sources/fakes";
import type { Task } from "../src/sources/types";
import type { Env } from "../src/env";
import { ownerAccess } from "./helpers/access";
import { readOnly } from "./helpers/sources";

// The routing that runs after the Access check, called directly. The Access check itself
// is covered in access.test.ts and worker.test.ts.

const HUB = "https://hub.example.com";
const MINIMUM = "JOB: save 1 posting";

/** What src/index.ts hands over once the Access token has been verified. Made by `verifyAccess`. */
let OWNER: VerifiedAccess;

beforeAll(async () => {
  OWNER = await ownerAccess();
});

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

const READ_ROUTES = ["/api/tasks", "/api/calendar", "/api/habits"];

let tasks: FakeTaskSource;

/** The read side of the fake data. The write side is handed to setDevFakes separately. */
const reads = (): Sources => ({ tasks: readOnly(tasks), calendar: new FakeCalendarSource([]) });

beforeEach(() => {
  tasks = new FakeTaskSource({ tasks: structuredClone(START) });
  // Every write method exists, unless a test says otherwise.
  setDevFakes(reads(), tasks);
});

afterEach(() => setDevFakes(null));

function post(env: Env, path: string, headers: Record<string, string>, body?: BodyInit): Promise<Response> {
  return routeRequest(new Request(`${HUB}${path}`, { method: "POST", headers, body }), env, OWNER);
}

/** No task was completed, added or moved. */
function expectNothingWritten(): void {
  expect(tasks.tasks).toEqual(START);
}

describe("Access", () => {
  /** Every write route and a read route answer 401 to this caller. */
  async function expectRefused(access: unknown): Promise<void> {
    const forged = access as VerifiedAccess;
    for (const { path, body } of WRITE_ROUTES) {
      const request = new Request(`${HUB}${path}`, { method: "POST", headers: JSON_FROM_HUB, body });
      expect((await routeRequest(request, fakesOn, forged)).status).toBe(401);
    }
    for (const path of READ_ROUTES) {
      expect((await routeRequest(new Request(`${HUB}${path}`), fakesOn, forged)).status).toBe(401);
    }
  }

  it("refuses a caller that has no verified Access result", async () => {
    const notVerified = [undefined, null, { ok: false, status: 401, reason: "missing_token" }, { email: "me@example.com" }];
    for (const access of notVerified) await expectRefused(access);
    expectNothingWritten();
  });

  it("refuses an Access result that verifyAccess did not produce", async () => {
    // The type refuses a hand-built result: only src/auth/access.ts can make a VerifiedAccess.
    // @ts-expect-error a plain object of the right shape is not a VerifiedAccess
    const handBuilt: VerifiedAccess = { ok: true, email: "me@example.com", devBypass: false };
    // At run time too: the right shape is not enough, and neither is a copy of a real one.
    await expectRefused(handBuilt);
    await expectRefused({ ...OWNER });
    expectNothingWritten();
  });

  it("serves the caller whose Access result verifyAccess produced", async () => {
    for (const path of READ_ROUTES) {
      const res = await routeRequest(new Request(`${HUB}${path}`), fakesOn, OWNER);
      expect(res.status).toBe(200);
    }
  });
});

describe("read routes", () => {
  const get = (path: string, env: Env = fakesOn) => routeRequest(new Request(`${HUB}${path}`), env, OWNER);

  it("serves fake data in all three sections, with no setting but USE_FAKES", async () => {
    setDevFakes(null); // the built-in sample data, as `npm run dev` uses it
    const tasks = (await (await get("/api/tasks")).json()) as any;
    expect(tasks.tasks.length).toBeGreaterThan(0);
    expect(tasks.writes).toEqual({ complete: true, next: true, restart: true });
    const calendar = (await (await get("/api/calendar")).json()) as any;
    expect(Array.isArray(calendar.events)).toBe(true);
    const habits = (await (await get("/api/habits")).json()) as any;
    expect(habits.habits.length).toBeGreaterThan(0);
  });

  it("/api/tasks reports the write routes that are switched on", async () => {
    setDevFakes(reads(), { completeTask: (p, t) => tasks.completeTask(p, t) });
    const body = (await (await get("/api/tasks")).json()) as any;
    expect(body.writes).toEqual({ complete: true, next: false, restart: false });
    setDevFakes(reads());
    const none = (await (await get("/api/tasks")).json()) as any;
    expect(none.writes).toEqual({ complete: false, next: false, restart: false });
  });

  it("the old /api/today is gone", async () => {
    const res = await get("/api/today");
    expect(res.status).toBe(404);
  });

  it("the calendar answers when TickTick is not connected", async () => {
    setDevFakes({ tasks: null, calendar: new FakeCalendarSource([]) });
    const calendar = await get("/api/calendar");
    expect(calendar.status).toBe(200);
    for (const path of ["/api/tasks", "/api/habits"]) {
      const res = await get(path);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "not_connected", provider: "ticktick" });
    }
  });

  it("tasks answer when Google is not connected", async () => {
    setDevFakes({ tasks: readOnly(tasks), calendar: null }, tasks);
    expect((await get("/api/tasks")).status).toBe(200);
    expect((await get("/api/habits")).status).toBe(200);
    const res = await get("/api/calendar");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "not_connected", provider: "google" });
  });

  it("are GET only: a POST to a read path is not found and writes nothing", async () => {
    for (const path of READ_ROUTES) {
      const res = await post(fakesOn, path, JSON_FROM_HUB, "{}");
      expect(res.status).toBe(404);
    }
    expectNothingWritten();
  });
});

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

  it("refuses a POST body over 4096 bytes", async () => {
    // A JSON object every route would otherwise accept, padded to one byte over the limit.
    const head = '{"title":"New thing","pad":"';
    const tail = '"}';
    const tooBig = head + "x".repeat(4097 - head.length - tail.length) + tail;
    expect(new TextEncoder().encode(tooBig).length).toBe(4097);

    for (const { path } of WRITE_ROUTES) {
      const res = await post(fakesOn, path, JSON_FROM_HUB, tooBig);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "bad_body" });
    }
    expectNothingWritten();
  });

  it("refuses a POST body under 4096 characters but over 4096 bytes", async () => {
    // "é" is one character and two bytes in UTF-8.
    const tooBig = `{"title":"New thing","pad":"${"é".repeat(2500)}"}`;
    expect(tooBig.length).toBe(2530);
    expect(new TextEncoder().encode(tooBig).length).toBe(5030);

    for (const { path } of WRITE_ROUTES) {
      const request = new Request(`${HUB}${path}`, { method: "POST", headers: JSON_FROM_HUB, body: tooBig });
      // No declared length to go by: the body itself has to be measured.
      expect(request.headers.get("Content-Length")).toBeNull();
      const res = await routeRequest(request, fakesOn, OWNER);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "bad_body" });
    }
    expectNothingWritten();
  });

  it("stops reading a body once it is over 4096 bytes", async () => {
    // 1000 chunks of 1024 bytes are on offer, with no Content-Length. Only the first few may be taken.
    let pulled = 0;
    const huge = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        if (pulled > 1000) controller.close();
        else controller.enqueue(new Uint8Array(1024).fill(0x20));
      },
    });
    const res = await post(fakesOn, "/api/restart", JSON_FROM_HUB, huge);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "bad_body" });
    expect(pulled).toBeLessThan(20);
    expectNothingWritten();
  });

  it("refuses a body that is not valid UTF-8", async () => {
    // {"title":"abc<0xFF><0xFE>"}: JSON apart from two bytes that are not UTF-8.
    const text = new TextEncoder();
    const notUtf8 = new Uint8Array([...text.encode('{"title":"abc'), 0xff, 0xfe, ...text.encode('"}')]);
    for (const { path } of WRITE_ROUTES) {
      const res = await post(fakesOn, path, JSON_FROM_HUB, notUtf8);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "bad_body" });
    }
    expectNothingWritten();
  });

  it("refuses a body that starts with a byte order mark", async () => {
    // <0xEF><0xBB><0xBF>{"title":"New thing"}: JSON every route would accept, behind a UTF-8 BOM.
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"title":"New thing"}')]);
    for (const { path } of WRITE_ROUTES) {
      const res = await post(fakesOn, path, JSON_FROM_HUB, withBom);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "bad_body" });
    }
    expectNothingWritten();
  });

  it("refuses a body that breaks off while it is being read", async () => {
    for (const { path } of WRITE_ROUTES) {
      // The first chunk arrives, then the connection drops.
      let sent = false;
      const dropped = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent) controller.error(new Error("connection lost"));
          else controller.enqueue(new TextEncoder().encode('{"title":'));
          sent = true;
        },
      });
      const res = await post(fakesOn, path, JSON_FROM_HUB, dropped);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "bad_body" });
    }
    expectNothingWritten();
  });

  it("refuses a content type that only starts with application/json", async () => {
    const lookalikes = ["application/jsonx", "application/json5", "application/json-patch+json"];
    for (const { path, body } of WRITE_ROUTES) {
      for (const type of lookalikes) {
        const res = await post(fakesOn, path, { Origin: HUB, "Content-Type": type }, body);
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: "bad_body" });
      }
    }
    expectNothingWritten();
  });

  it("accepts application/json with a charset, in any letter case", async () => {
    const plain = await post(fakesOn, "/api/next", { Origin: HUB, "Content-Type": "application/json; charset=utf-8" }, '{"title":"One"}');
    expect(plain.status).toBe(201);
    const shouted = await post(fakesOn, "/api/next", { Origin: HUB, "Content-Type": "Application/JSON;charset=UTF-8" }, '{"title":"Two"}');
    expect(shouted.status).toBe(201);
    expect(tasks.tasks.slice(-2).map((t) => t.title)).toEqual(["One", "Two"]);
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

  it("answers not_enabled for every write route when the source has no write methods", async () => {
    setDevFakes(reads());
    for (const { path, body } of WRITE_ROUTES) {
      const res = await post(fakesOn, path, JSON_FROM_HUB, body);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "not_enabled" });
    }
    expectNothingWritten();
  });

  it("switches on only the route whose write method exists", async () => {
    // What step 5 will look like: complete is real, add and Restart are not yet.
    setDevFakes(reads(), { completeTask: (projectId, taskId) => tasks.completeTask(projectId, taskId) });

    const added = await post(fakesOn, "/api/next", JSON_FROM_HUB, '{"title":"New thing"}');
    expect(added.status).toBe(503);
    expect(await added.json()).toEqual({ error: "not_enabled" });
    const restarted = await post(fakesOn, "/api/restart", JSON_FROM_HUB, "{}");
    expect(restarted.status).toBe(503);
    expect(await restarted.json()).toEqual({ error: "not_enabled" });
    expectNothingWritten();

    const completed = await post(fakesOn, "/api/tasks/a/complete", JSON_FROM_HUB, "{}");
    expect(completed.status).toBe(200);
    expect(tasks.tasks.find((t) => t.id === "a")!.done).toBe(true);
  });

  it("keeps Restart off until both move and create exist", async () => {
    setDevFakes(reads(), { createTask: (projectId, title) => tasks.createTask(projectId, title) });
    const createOnly = await post(fakesOn, "/api/restart", JSON_FROM_HUB, "{}");
    expect(createOnly.status).toBe(503);
    expect(await createOnly.json()).toEqual({ error: "not_enabled" });

    setDevFakes(reads(), { moveTask: (taskId, from, to) => tasks.moveTask(taskId, from, to) });
    const moveOnly = await post(fakesOn, "/api/restart", JSON_FROM_HUB, "{}");
    expect(moveOnly.status).toBe(503);
    expect(await moveOnly.json()).toEqual({ error: "not_enabled" });
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

  it("answers not_connected for each read route when fake data is off", async () => {
    // Providers are resolved before settings are read, so not_connected comes first.
    const providerFor: Record<string, string> = {
      "/api/tasks": "ticktick",
      "/api/habits": "ticktick",
      "/api/calendar": "google",
    };
    for (const path of READ_ROUTES) {
      const res = await routeRequest(new Request(`${HUB}${path}`), fakesOff, OWNER);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "not_connected", provider: providerFor[path] });
    }
  });
});
