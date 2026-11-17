import type { Env } from "./env";
import { isVerifiedAccess, type VerifiedAccess } from "./auth/access";
import { isSameOrigin } from "./auth/origin";
import {
  addToNext,
  completeTask,
  getCalendar,
  getHabits,
  getTasks,
  json,
  readCalendarConfig,
  readConfig,
  readHabitsConfig,
  readTasksConfig,
  resolveCalendar,
  resolveTasks,
  resolveTaskWrites,
  restart,
  type Config,
} from "./api";
import type { Provider } from "./crypto/tokens";
import { readJson } from "./domain/input";
import { connect, disconnect, oauthCallback } from "./setup";
import { NotConnectedError, type TaskReader, type TaskWriter, type TaskWrites } from "./sources/types";

type WriteRoute = { kind: "complete"; taskId: string } | { kind: "next" } | { kind: "restart" };

function matchWriteRoute(pathname: string): WriteRoute | null {
  if (pathname === "/api/next") return { kind: "next" };
  if (pathname === "/api/restart") return { kind: "restart" };
  // No decoding: valid ids are plain [A-Za-z0-9_-], so anything encoded is rejected as 400.
  const m = pathname.match(/^\/api\/tasks\/([^/]+)\/complete$/);
  return m ? { kind: "complete", taskId: m[1]! } : null;
}

const notConnected = (e: NotConnectedError): Response => json({ error: "not_connected", provider: e.provider }, 503);
const notConfigured = (): Response => json({ error: "not_configured" }, 503);

/**
 * One section's way in: the provider first (`not_connected`), then that section's own
 * settings (`not_configured`), then the handler. A section never asks about another's.
 */
async function section<S, C>(
  resolve: () => S,
  readCfg: () => C | null,
  run: (source: S, cfg: C) => Promise<Response>,
): Promise<Response> {
  let source: S;
  try {
    source = resolve();
  } catch (e) {
    if (e instanceof NotConnectedError) return notConnected(e);
    throw e;
  }
  const cfg = readCfg();
  if (!cfg) return notConfigured();
  return run(source, cfg);
}

/** The Today reader and both project IDs, for the write routes. */
function tasksAndConfig(env: Env): { tasks: TaskReader; cfg: Config } | Response {
  let tasks: TaskReader;
  try {
    tasks = resolveTasks(env);
  } catch (e) {
    if (e instanceof NotConnectedError) return notConnected(e);
    throw e;
  }
  const cfg = readConfig(env, env.USE_FAKES === "true");
  if (!cfg) return notConfigured();
  return { tasks, cfg };
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
      const ready = tasksAndConfig(env);
      if (ready instanceof Response) return ready;
      return completeTask(ready.tasks, writes, ready.cfg, write.taskId);
    }
    case "next": {
      if (!has(writes, "createTask")) return notEnabled();
      const ready = tasksAndConfig(env);
      if (ready instanceof Response) return ready;
      return addToNext(writes, ready.cfg, body);
    }
    case "restart": {
      if (!has(writes, "moveTask", "createTask")) return notEnabled();
      const ready = tasksAndConfig(env);
      if (ready instanceof Response) return ready;
      return restart(ready.tasks, writes, ready.cfg);
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

  if (method === "GET") {
    const fakes = env.USE_FAKES === "true";
    const now = new Date();
    switch (pathname) {
      case "/api/tasks":
        return section(
          () => resolveTasks(env),
          () => readTasksConfig(env, fakes),
          (tasks, cfg) => getTasks(tasks, cfg, now, resolveTaskWrites(env)),
        );
      case "/api/calendar":
        return section(
          () => resolveCalendar(env),
          () => readCalendarConfig(env, fakes),
          (calendar, cfg) => getCalendar(calendar, cfg, now),
        );
      case "/api/habits":
        return section(
          () => resolveTasks(env),
          () => readHabitsConfig(env, fakes),
          (tasks, cfg) => getHabits(tasks, cfg, now),
        );
    }
  }

  return json({ error: "not_found" }, 404);
}

// `:provider` is one of the two literal names. Nothing is decoded, so an encoded or
// differently cased name is simply not a route.
const SETUP_ACTION_ROUTE = /^\/setup\/(connect|disconnect)\/(ticktick|google)$/;
const CALLBACK_ROUTE = /^\/oauth\/(ticktick|google)\/callback$/;

const methodNotAllowed = (allow: string): Response =>
  new Response("Method not allowed", { status: 405, headers: { Allow: allow } });

/**
 * The connection routes (`/setup*` and `/oauth/*`), or null for any other path. A path under
 * them that is not a route is a 404 here: it never falls through to the static files.
 */
async function routeSetup(
  request: Request,
  pathname: string,
  body: Record<string, unknown> | null,
  env: Env,
  access: VerifiedAccess,
): Promise<Response | null> {
  if (!pathname.startsWith("/setup/") && !pathname.startsWith("/oauth/")) return null;

  const action = pathname.match(SETUP_ACTION_ROUTE);
  if (action) {
    // `body` is set only for a POST that passed the same-origin and JSON checks below.
    if (!body) return methodNotAllowed("POST");
    const provider = action[2] as Provider;
    return action[1] === "connect" ? connect(request, env, access, provider) : disconnect(env, provider);
  }

  // The one GET that writes, so it is routed by name and by method: a HEAD does not run it.
  // Its checks are G6b's (state, cookie, Access email), inside `oauthCallback`.
  const callbackFrom = pathname.match(CALLBACK_ROUTE);
  if (callbackFrom) {
    if (request.method !== "GET") return methodNotAllowed("GET");
    return oauthCallback(request, env, access, callbackFrom[1] as Provider);
  }

  return json({ error: "not_found" }, 404);
}

/**
 * Everything that happens after the Access check. It does not verify the Access token
 * itself, so it can't be called without the result of a check that passed: `access` is
 * what `verifyAccess` returned, and nothing else is accepted (see `VerifiedAccess`).
 */
export async function routeRequest(request: Request, env: Env, access: VerifiedAccess): Promise<Response> {
  // The type already demands a passed check. This repeats it at run time, so a caller
  // that gets here some other way, or with an object it built itself, is refused.
  if (!isVerifiedAccess(access)) return new Response("Unauthorized", { status: 401 });

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

  const setup = await routeSetup(request, url.pathname, body, env, access);
  if (setup) return setup;

  if (!readOnly) return new Response("Method not allowed", { status: 405 });
  return env.ASSETS.fetch(request);
}
