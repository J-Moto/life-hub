import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Env } from "../env";

export type AccessResult =
  | { ok: true; email: string; devBypass: boolean }
  | { ok: false; status: 401 | 403 | 500; reason: string };

// One JWKS fetcher per team domain, reused across requests in the same isolate.
const jwksCache = new Map<string, JWTVerifyGetKey>();

function remoteKeys(teamDomain: string): JWTVerifyGetKey {
  let keys = jwksCache.get(teamDomain);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    jwksCache.set(teamDomain, keys);
  }
  return keys;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const LOOPBACK_IPS = new Set(["127.0.0.1", "::1"]);

/**
 * Local-dev shortcut. ALL must hold: the flag is on, fake data is on, Access isn't
 * configured, the URL host is local AND the connecting IP is loopback. The Host header
 * alone can be spoofed from the LAN; the connecting IP can't. In production Cloudflare
 * sets CF-Connecting-IP to the real client IP, which is never loopback.
 */
export function devBypassAllowed(request: Request, env: Env): boolean {
  if (env.DEV_SKIP_ACCESS !== "true" || env.USE_FAKES !== "true" || env.ACCESS_AUD) return false;
  const host = new URL(request.url).hostname;
  const ip = request.headers.get("CF-Connecting-IP") ?? "";
  return LOCAL_HOSTS.has(host) && LOOPBACK_IPS.has(ip);
}

function validTeamDomain(d: string): boolean {
  return /^[a-z0-9-]+\.cloudflareaccess\.com$/.test(d);
}

/**
 * Verifies the Cloudflare Access JWT on a request. Fails closed: any missing
 * config or invalid token is a rejection. `getKey` is injectable for tests.
 */
export async function verifyAccess(
  request: Request,
  env: Env,
  getKey?: JWTVerifyGetKey,
): Promise<AccessResult> {
  if (devBypassAllowed(request, env)) {
    console.warn("DEV ACCESS BYPASS ACTIVE (local only)");
    return { ok: true, email: "dev@localhost", devBypass: true };
  }

  const team = env.ACCESS_TEAM_DOMAIN;
  const aud = env.ACCESS_AUD;
  const allowed = env.ALLOWED_EMAIL?.trim().toLowerCase();
  if (!team || !validTeamDomain(team) || !aud || !allowed) {
    return { ok: false, status: 500, reason: "access_not_configured" };
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return { ok: false, status: 401, reason: "missing_token" };

  try {
    const { payload } = await jwtVerify(token, getKey ?? remoteKeys(team), {
      issuer: `https://${team}`,
      audience: aud,
      algorithms: ["RS256"],
      clockTolerance: 30,
    });
    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
    if (email !== allowed) return { ok: false, status: 403, reason: "email_not_allowed" };
    return { ok: true, email, devBypass: false };
  } catch {
    return { ok: false, status: 401, reason: "invalid_token" };
  }
}
