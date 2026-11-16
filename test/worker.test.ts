import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exports } from "cloudflare:workers";
import worker from "../src/index";
import { setDevFakes } from "../src/api";
import { FakeCalendarSource, FakeTaskSource } from "../src/sources/fakes";
import type { Env } from "../src/env";
import { readOnly } from "./helpers/sources";

// End-to-end through the Worker. No valid Access token exists in tests, so everything must be refused.
describe("Worker front door", () => {
  const SELF = (exports as any).default as Fetcher;

  it("refuses the page without Access", async () => {
    const res = await SELF.fetch("https://hub.example.com/");
    expect(res.status).toBe(401);
    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("refuses the API without Access", async () => {
    expect((await SELF.fetch("https://hub.example.com/api/tasks")).status).toBe(401);
  });

  it("refuses a spoofed localhost Host header", async () => {
    const res = await SELF.fetch("http://localhost:8787/api/tasks", { headers: { "CF-Connecting-IP": "192.168.1.50" } });
    expect(res.status).toBe(401);
  });

  it("refuses a forged token", async () => {
    const res = await SELF.fetch("https://hub.example.com/api/tasks", {
      headers: { "Cf-Access-Jwt-Assertion": "a.b.c" },
    });
    expect(res.status).toBe(401);
  });

  it("refuses a POST without Access before any other check", async () => {
    for (const path of ["/api/tasks/a/complete", "/api/next", "/api/restart"]) {
      // Wrong on every later check too (another origin, no JSON body): still 401, not 403 or 400.
      const sloppy = await SELF.fetch(`https://hub.example.com${path}`, {
        method: "POST",
        headers: { Origin: "https://evil.example" },
        body: "title=x",
      });
      expect(sloppy.status).toBe(401);

      // Right on every later check (same origin, JSON body): Access alone refuses it.
      const tidy = await SELF.fetch(`https://hub.example.com${path}`, {
        method: "POST",
        headers: { Origin: "https://hub.example.com", "Content-Type": "application/json" },
        body: JSON.stringify({ title: "x" }),
      });
      expect(tidy.status).toBe(401);
    }
  });

  it("answers 401 to everything when the Access settings are missing", async () => {
    // The first deploy can run before the Access settings are entered (docs/deploy-checklist.md, check 1).
    const noAccess = { TIME_ZONE: "America/Indiana/Indianapolis", USE_FAKES: "false" } as unknown as Env;
    const page = await worker.fetch(new Request("https://hub.example.com/"), noAccess);
    expect(page.status).toBe(401);
    expect(await page.text()).toBe("Unauthorized");

    const write = await worker.fetch(
      new Request("https://hub.example.com/api/restart", {
        method: "POST",
        headers: { Origin: "https://hub.example.com", "Content-Type": "application/json" },
        body: "{}",
      }),
      noAccess,
    );
    expect(write.status).toBe(401);
  });

  it("lets the page's own requests carry their Origin", async () => {
    // Under `no-referrer` a browser sends `Origin: null` on some same-site POSTs, which the
    // same-origin check would refuse. `same-origin` still sends nothing to other sites.
    const res = await SELF.fetch("https://hub.example.com/");
    expect(res.headers.get("Referrer-Policy")).toBe("same-origin");
  });

  it("has no scheduled handler", () => {
    // v1 has no cron (H2). A handler here would run with no Access check in front of it.
    expect((worker as ExportedHandler<Env>).scheduled).toBeUndefined();
  });
});

// The whole path: src/index.ts, a passed Access check, then the router. Tests have no valid
// Access token, so the check is passed the one other way there is: the local-development skip.
describe("Worker, past the Access check", () => {
  const LOCAL = "http://localhost:8787";
  const LOOPBACK = { "CF-Connecting-IP": "127.0.0.1" };
  const devEnv = {
    TIME_ZONE: "America/Indiana/Indianapolis",
    USE_FAKES: "true",
    DEV_SKIP_ACCESS: "true",
  } as unknown as Env;

  let tasks: FakeTaskSource;

  beforeEach(() => {
    tasks = new FakeTaskSource({
      tasks: [{ id: "a", projectId: "today", title: "Finish video", done: false, sortOrder: 0 }],
    });
    setDevFakes({ tasks: readOnly(tasks), calendar: new FakeCalendarSource([]) }, tasks);
  });

  afterEach(() => setDevFakes(null));

  it("serves a read route, with the security headers", async () => {
    const res = await worker.fetch(new Request(`${LOCAL}/api/tasks`, { headers: LOOPBACK }), devEnv);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ tasks: [{ id: "a", title: "Finish video", job: false }] });
    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("runs a write route, with the security headers", async () => {
    const res = await worker.fetch(
      new Request(`${LOCAL}/api/next`, {
        method: "POST",
        headers: { ...LOOPBACK, Origin: LOCAL, "Content-Type": "application/json" },
        body: '{"title":"New thing"}',
      }),
      devEnv,
    );
    expect(res.status).toBe(201);
    expect(tasks.tasks.at(-1)).toMatchObject({ projectId: "next", title: "New thing" });
    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("applies the router's POST checks", async () => {
    const res = await worker.fetch(
      new Request(`${LOCAL}/api/next`, {
        method: "POST",
        headers: { ...LOOPBACK, Origin: "https://evil.example", "Content-Type": "application/json" },
        body: '{"title":"New thing"}',
      }),
      devEnv,
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "cross_site" });
    expect(tasks.tasks).toHaveLength(1);
  });
});
