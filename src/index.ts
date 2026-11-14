import type { Env } from "./env";
import { verifyAccess } from "./auth/access";
import { isSameOrigin } from "./auth/origin";
import { addToNext, completeTask, getToday, json, readConfig, resolveSources, restart } from "./api";
import { NotConnectedError } from "./sources/types";

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000",
};

function withSecurityHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;

  const access = await verifyAccess(request, env);
  if (!access.ok) {
    // Callers only ever see 401/403; the real reason goes to the log.
    console.warn("access_denied", access.reason);
    return new Response("Unauthorized", { status: access.status === 403 ? 403 : 401 });
  }

  if (method !== "GET" && method !== "HEAD" && !isSameOrigin(request)) {
    return json({ error: "cross_site" }, 403);
  }

  if (url.pathname.startsWith("/api/")) {
    let sources;
    try {
      sources = resolveSources(env);
    } catch (e) {
      if (e instanceof NotConnectedError) return json({ error: "not_connected", provider: e.provider }, 503);
      throw e;
    }
    const cfg = readConfig(env, env.USE_FAKES === "true");
    if (!cfg) return json({ error: "not_configured" }, 503);

    if (url.pathname === "/api/today" && method === "GET") return getToday(sources, cfg, new Date());
    if (url.pathname === "/api/next" && method === "POST") return addToNext(sources, cfg, request);
    if (url.pathname === "/api/restart" && method === "POST") return restart(sources, cfg);
    const m = url.pathname.match(/^\/api\/tasks\/([^/]+)\/complete$/);
    // No decoding: valid ids are plain [A-Za-z0-9_-], so anything encoded is rejected as 400.
    if (m && method === "POST") return completeTask(sources, cfg, m[1]!);
    return json({ error: "not_found" }, 404);
  }

  if (method !== "GET" && method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return withSecurityHeaders(await route(request, env));
    } catch (e) {
      // Log only the error type, never messages (they can contain URLs, bodies or tokens).
      console.error("unhandled", e instanceof Error ? e.name : "unknown");
      return withSecurityHeaders(json({ error: "internal" }, 500));
    }
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    // Health check placeholder: real TickTick/Google pings arrive with the OAuth features.
    const configured = Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD && env.TOKEN_ENC_KEY);
    console.log("health", { configured });
  },
} satisfies ExportedHandler<Env>;
