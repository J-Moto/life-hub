import type { Env } from "./env";
import { isSameOrigin } from "./auth/origin";
import {
  addToNext,
  completeTask,
  getToday,
  json,
  readConfig,
  resolveSources,
  resolveTaskWriter,
  restart,
  type Config,
  type Sources,
} from "./api";
import { readJson } from "./domain/input";
import { NotConnectedError } from "./sources/types";

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

async function routeApi(
  method: string,
  pathname: string,
  body: Record<string, unknown> | null,
  env: Env,
): Promise<Response> {
  const write = method === "POST" ? matchWriteRoute(pathname) : null;
  if (write && body) {
    // Write gate. Checked first, so a write route that isn't switched on answers
    // `not_enabled` whatever else is connected or configured.
    const writer = resolveTaskWriter(env);
    if (!writer) return json({ error: "not_enabled" }, 503);

    const ready = sourcesAndConfig(env);
    if (ready instanceof Response) return ready;
    const { sources, cfg } = ready;
    switch (write.kind) {
      case "complete":
        return completeTask(sources.tasks, writer, cfg, write.taskId);
      case "next":
        return addToNext(writer, cfg, body);
      case "restart":
        return restart(sources.tasks, writer, cfg);
    }
  }

  if (method === "GET" && pathname === "/api/today") {
    const ready = sourcesAndConfig(env);
    if (ready instanceof Response) return ready;
    return getToday(ready.sources, ready.cfg, new Date());
  }

  return json({ error: "not_found" }, 404);
}

/**
 * Everything that happens after the Access check. It does NOT check Access itself:
 * the only caller is `src/index.ts`, which has already verified the Access token.
 */
export async function routeRequest(request: Request, env: Env): Promise<Response> {
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
