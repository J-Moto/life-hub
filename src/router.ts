import type { Env } from "./env";
import type { AccessResult } from "./auth/access";
import { isSameOrigin } from "./auth/origin";
import {
  addToNext,
  completeTask,
  getToday,
  json,
  readConfig,
  resolveSources,
  resolveTaskWrites,
  restart,
  type Config,
  type Sources,
} from "./api";
import { readJson } from "./domain/input";
import { NotConnectedError, type TaskWriter, type TaskWrites } from "./sources/types";

/** Proof that the Access check passed. Only `verifyAccess` produces one. */
export type VerifiedAccess = Extract<AccessResult, { ok: true }>;

type WriteRoute = { kind: "complete"; taskId: string } | { kind: "next" } | { kind: "restart" };

function matchWriteRoute(pathname: string): WriteRoute | null {
  if (pathname === "/api/next") return { kind: "next" };
  if (pathname === "/api/restart") return { kind: "restart" };
  // No decoding: valid ids are plain [A-Za-z0-9_-], so anything encoded is rejected as 400.
  const m = pathname.match(/^\/api\/tasks\/([^/]+)\/complete$/);
  return m ? { kind: "complete", taskId: m[1]! } : null;
}

/** The sources and settings a route needs, or the answer that says what is missing. */
function sourcesAndConfig(env: Env): { sources: Sources; cfg: Config } | Response {
  let sources: Sources;
  try {
    sources = resolveSources(env);
  } catch (e) {
    if (e instanceof NotConnectedError) return json({ error: "not_connected", provider: e.provider }, 503);
    throw e;
  }
  const cfg = readConfig(env, env.USE_FAKES === "true");
  if (!cfg) return json({ error: "not_configured" }, 503);
  return { sources, cfg };
}

/** True when every named write method is switched on. */
function has<K extends keyof TaskWriter>(
  writes: TaskWrites,
  ...methods: K[]
): writes is TaskWrites & Pick<TaskWriter, K> {
  return methods.every((m) => typeof writes[m] === "function");
}

const notEnabled = (): Response => json({ error: "not_enabled" }, 503);

/**
 * A write route. The write gate comes first, per route: a route whose own write methods
 * aren't switched on answers `not_enabled`, whatever else is connected or configured.
 * Each handler's parameter type names the methods it uses, so a gate that checks the
 * wrong ones doesn't compile.
 */
async function runWrite(write: WriteRoute, body: Record<string, unknown>, env: Env): Promise<Response> {
  const writes = resolveTaskWrites(env);
  switch (write.kind) {
    case "complete": {
      if (!has(writes, "completeTask")) return notEnabled();
      const ready = sourcesAndConfig(env);
      if (ready instanceof Response) return ready;
      return completeTask(ready.sources.tasks, writes, ready.cfg, write.taskId);
    }
    case "next": {
      if (!has(writes, "createTask")) return notEnabled();
      const ready = sourcesAndConfig(env);
      if (ready instanceof Response) return ready;
      return addToNext(writes, ready.cfg, body);
    }
    case "restart": {
      if (!has(writes, "moveTask", "createTask")) return notEnabled();
      const ready = sourcesAndConfig(env);
      if (ready instanceof Response) return ready;
      return restart(ready.sources.tasks, writes, ready.cfg);
    }
    default:
      // A write route with no case above is a compile error, not a 404.
      return write satisfies never;
  }
}

async function routeApi(
  method: string,
  pathname: string,
  body: Record<string, unknown> | null,
  env: Env,
): Promise<Response> {
  const write = method === "POST" ? matchWriteRoute(pathname) : null;
  if (write && body) return runWrite(write, body, env);

  if (method === "GET" && pathname === "/api/today") {
    const ready = sourcesAndConfig(env);
    if (ready instanceof Response) return ready;
    return getToday(ready.sources, ready.cfg, new Date());
  }

  return json({ error: "not_found" }, 404);
}

/**
 * Everything that happens after the Access check. It does not verify the Access token
 * itself, so it can't be called without the result of a check that passed: `access` is
 * what `verifyAccess` returned.
 */
export async function routeRequest(request: Request, env: Env, access: VerifiedAccess): Promise<Response> {
  // The type already demands a passed check. This repeats it at run time, so a caller
  // that gets here some other way is refused, not served.
  if (access?.ok !== true) return new Response("Unauthorized", { status: 401 });

  const url = new URL(request.url);
  const method = request.method;
  const readOnly = method === "GET" || method === "HEAD";

  if (!readOnly && !isSameOrigin(request)) return json({ error: "cross_site" }, 403);

  // Every POST carries a JSON object (an empty one when there is nothing to send). The body
  // is read here, once. A cross-site form can't send `application/json` without a preflight.
  let body: Record<string, unknown> | null = null;
  if (method === "POST") {
    body = await readJson(request);
    if (!body) return json({ error: "bad_body" }, 400);
  }

  if (url.pathname.startsWith("/api/")) return routeApi(method, url.pathname, body, env);

  if (!readOnly) return new Response("Method not allowed", { status: 405 });
  return env.ASSETS.fetch(request);
}
