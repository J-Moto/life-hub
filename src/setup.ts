/**
 * The connections to TickTick and Google (docs/design/v1.md, G1, and the step 2 "Callback
 * contract"). Only Google is built so far: TickTick arrives in step 4, and until then its
 * routes answer `not_configured`.
 */

import type { Env } from "./env";
import type { VerifiedAccess } from "./auth/access";
import { json } from "./api";
import { TokenStore, importKey, type Provider } from "./crypto/tokens";
import { googleClient, googleSignInUrl, type GoogleClient } from "./oauth/google";
import { issueLoginState } from "./oauth/state";

const notConfigured = (): Response => json({ error: "not_configured" }, 503);

/** `HUB_ORIGIN` when it is an `https` origin with nothing after it, else null. */
function hubOrigin(env: Env): string | null {
  const raw = env.HUB_ORIGIN?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  // `origin` drops any path, query, fragment and user name, so equality means there is none.
  return url.protocol === "https:" && url.origin === raw ? raw : null;
}

interface LoginSettings {
  store: TokenStore;
  client: GoogleClient;
  /** The fixed address Google sends the owner back to. */
  redirectUri: string;
}

/**
 * Everything a Google login needs, or null if any of it is missing or bad: the key must
 * load, both client settings must be set, and `HUB_ORIGIN` must be an `https` origin equal
 * to the request's own. Checked before a `state` is issued, so the owner is never sent to
 * Google for an answer the hub can't store (section 3).
 */
async function loginSettings(env: Env, requestOrigin: string): Promise<LoginSettings | null> {
  const client = googleClient(env);
  const origin = hubOrigin(env);
  if (!client || !origin || origin !== requestOrigin) return null;
  try {
    const store = new TokenStore(env.TOKENS, await importKey(env.TOKEN_ENC_KEY));
    return { store, client, redirectUri: `${origin}/oauth/google/callback` };
  } catch {
    return null;
  }
}

/**
 * Starts a connection: answers with the provider's sign-in address, which the page goes to.
 * The router has already done the F5 checks (POST, same origin, JSON body).
 */
export async function connect(request: Request, env: Env, access: VerifiedAccess, provider: Provider): Promise<Response> {
  // Real connections are made on the deployed hub only (G7). Not a 401 or 403, which the
  // page would read as "sign in again".
  if (access.devBypass) return json({ error: "not_enabled" }, 503);
  if (provider !== "google") return notConfigured();

  const settings = await loginSettings(env, new URL(request.url).origin);
  if (!settings) return notConfigured();

  const login = await issueLoginState(env.TOKENS, provider, access.email, Date.now());
  const url = googleSignInUrl({
    clientId: settings.client.clientId,
    redirectUri: settings.redirectUri,
    state: login.state,
    challenge: login.challenge,
  });
  const res = json({ url });
  res.headers.set("Set-Cookie", login.cookie);
  return res;
}
