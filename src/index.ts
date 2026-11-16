import type { Env } from "./env";
import { verifyAccess } from "./auth/access";
import { json } from "./api";
import { routeRequest } from "./router";

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  // Not `no-referrer`: under it a browser sends `Origin: null` on some same-site POSTs, which
  // the same-origin check refuses. `same-origin` still sends nothing to other sites.
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000",
};

function withSecurityHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
}

/** The Access check comes first, for every request. Nothing else runs without it. */
async function handle(request: Request, env: Env): Promise<Response> {
  const access = await verifyAccess(request, env);
  if (!access.ok) {
    // Callers only ever see 401/403; the real reason goes to the log.
    console.warn("access_denied", access.reason);
    return new Response("Unauthorized", { status: access.status === 403 ? 403 : 401 });
  }
  return routeRequest(request, env, access);
}

// `fetch` is the only handler. v1 has no cron, so there is no `scheduled` handler.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return withSecurityHeaders(await handle(request, env));
    } catch (e) {
      // Log only the error type, never messages (they can contain URLs, bodies or tokens).
      console.error("unhandled", e instanceof Error ? e.name : "unknown");
      return withSecurityHeaders(json({ error: "internal" }, 500));
    }
  },
} satisfies ExportedHandler<Env>;
