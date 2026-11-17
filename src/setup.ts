/**
 * The connections to TickTick and Google (docs/design/v1.md, G1, and the step 2 "Callback
 * contract"). Only Google is built so far: TickTick arrives in step 4, and until then its
 * routes answer `not_configured`.
 */

import type { Env } from "./env";
import type { VerifiedAccess } from "./auth/access";
import { json } from "./api";
import { TokenStore, deleteTokenRecord, importKey, tokenRecordExists, type Provider } from "./crypto/tokens";
import {
  GOOGLE_SCOPE,
  exchangeGoogleCode,
  googleClient,
  googleSignInUrl,
  revokeGoogleToken,
  sameScopes,
  type GoogleClient,
} from "./oauth/google";
import { clearLoginCookie, consumeLoginState, issueLoginState, randomToken } from "./oauth/state";

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

/** What /setup shows for one provider. `stored` is true for any record, readable or not. */
async function connectionState(env: Env, provider: Provider): Promise<{ connected: boolean; stored: boolean }> {
  if (!(await tokenRecordExists(env.TOKENS, provider))) return { connected: false, stored: false };
  try {
    const store = new TokenStore(env.TOKENS, await importKey(env.TOKEN_ENC_KEY));
    return { connected: (await store.get(provider)) !== null, stored: true };
  } catch {
    // The key is missing or bad: the record is there but can't be read.
    return { connected: false, stored: true };
  }
}

const hiddenIf = (hide: boolean): string => (hide ? " hidden" : "");

/**
 * The setup page. It says "connected" or "not connected" for each service and nothing else
 * about the tokens (G1). Built from fixed text only: nothing from the request goes into it.
 * The result word in the address (`?result=…`) is read by the static script, `setup.js`.
 *
 * Buttons: Connect is offered only while not connected, so a second connect can't leave an
 * older grant live at the provider. Disconnect is offered whenever a record is stored, even
 * one that can't be decrypted, so the G2 key-change steps can delete it.
 */
export async function setupPage(env: Env, access: VerifiedAccess): Promise<Response> {
  const [google, ticktick] = await Promise.all([connectionState(env, "google"), connectionState(env, "ticktick")]);
  const status = (connected: boolean): string => (connected ? "connected" : "not connected");
  // Real connections are made on the deployed hub only (G7): no Connect button in local dev.
  const connectButton = access.devBypass
    ? ""
    : `<button type="button" data-action="connect"${hiddenIf(google.connected)}>Connect</button>\n    `;
  const localNote = access.devBypass ? "\n  <p>Connections are made on the deployed hub.</p>" : "";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Life Hub setup</title>
<link rel="stylesheet" href="/app.css">
<script type="module" src="/setup.js"></script>
</head>
<body>
<main>
  <h1>Connections</h1>
  <p id="signin" hidden><a href="/setup">Sign in again</a></p>
  <p id="note" role="status"></p>${localNote}
  <section data-provider="google">
    <h2>Google Calendar</h2>
    <p class="status">${status(google.connected)}</p>
    <p>
    ${connectButton}<button type="button" data-action="disconnect"${hiddenIf(!google.stored)}>Disconnect</button>
    </p>
  </section>
  <section data-provider="ticktick">
    <h2>TickTick</h2>
    <p class="status">${status(ticktick.connected)}</p>
  </section>
  <p><a href="/">Back to the hub</a></p>
</main>
</body>
</html>
`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
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

/**
 * Ends a connection: revokes the token at the provider and deletes the record (G1). The
 * record is deleted whatever the revoke does. `removeAccess` tells the page to show its
 * note: the token could not be revoked (the call failed, or the record can't be decrypted,
 * as after a key change), so the owner should remove the hub on the provider's account page.
 */
export async function disconnect(env: Env, provider: Provider): Promise<Response> {
  if (provider !== "google") return notConfigured();
  if (!(await tokenRecordExists(env.TOKENS, provider))) return json({ ok: true, removeAccess: false });

  let revoked = false;
  try {
    const store = new TokenStore(env.TOKENS, await importKey(env.TOKEN_ENC_KEY));
    const token = await store.get(provider);
    // The refresh token ends the whole grant. Without one, the access token is what there is.
    if (token) revoked = await revokeGoogleToken(token.refreshToken ?? token.accessToken);
  } catch {
    // The key is missing or bad: the record can't be read, so there is nothing to revoke with.
  } finally {
    await deleteTokenRecord(env.TOKENS, provider);
  }
  return json({ ok: true, removeAccess: !revoked });
}

/** How a callback ended. It travels to /setup as this one fixed word, and nothing else does. */
type CallbackResult = "connected" | "failed";

/**
 * The callback contract, in order (docs/design/v1.md, step 2). Returns how it ended; a
 * thrown error (a failed exchange, KV down) is a failure too, handled by `oauthCallback`.
 */
async function finishLogin(
  request: Request,
  env: Env,
  access: VerifiedAccess,
  provider: Provider,
): Promise<CallbackResult> {
  // Real connections are made on the deployed hub only (G7).
  if (access.devBypass) return "failed";

  const url = new URL(request.url);
  const now = Date.now();

  // Consume first. This also checks the provider against the path, the creation time, the
  // cookie and the Access email. From here on the state can't be used again.
  const login = await consumeLoginState(env.TOKENS, {
    state: url.searchParams.get("state") ?? "",
    cookieHeader: request.headers.get("Cookie"),
    provider,
    email: access.email,
    now,
  });
  if (!login) return "failed";

  // The provider reported an error (say, the owner pressed Cancel). Its text is not read.
  if (url.searchParams.has("error")) return "failed";
  const code = url.searchParams.get("code");
  if (!code) return "failed";

  // No TickTick state can exist before step 4, so this is never reached for it.
  if (provider !== "google") return "failed";
  const settings = await loginSettings(env, url.origin);
  if (!settings) return "failed";

  // Temporary test switch: only the Worker var, set to exactly "true", sends a wrong
  // verifier. Nothing in the request is consulted. Step 10 removes this.
  const verifier = env.PKCE_TEST_WRONG_VERIFIER === "true" ? randomToken() : login.verifier;
  // A failed exchange throws: nothing has been written, and an existing record is untouched.
  const grant = await exchangeGoogleCode(settings.client, { code, verifier, redirectUri: settings.redirectUri }, now);

  // Without a refresh token the hub would look connected for an hour and then ask again.
  // With another scope the token is not the one G4 allows. Either way nothing is stored,
  // and the grant Google just made is given back.
  if (!grant.refreshToken || !sameScopes(grant.scope, GOOGLE_SCOPE)) {
    await revokeGoogleToken(grant.refreshToken ?? grant.accessToken);
    return "failed";
  }

  try {
    await settings.store.put("google", { ...grant, connectedAt: now });
  } catch {
    // A grant the hub can't hold is not left behind at Google.
    await revokeGoogleToken(grant.refreshToken);
    return "failed";
  }
  return "connected";
}

/**
 * Finishes a connection. The one GET that writes: it is guarded by the `state`, its cookie
 * and the Access email (G6b), not by the F5 checks. Whatever happens, the answer is a 303
 * to /setup with the cookie cleared and nothing cached, so the code never stays in the
 * address bar.
 */
export async function oauthCallback(
  request: Request,
  env: Env,
  access: VerifiedAccess,
  provider: Provider,
): Promise<Response> {
  let result: CallbackResult = "failed";
  try {
    result = await finishLogin(request, env, access, provider);
  } catch (e) {
    // The error's name only: messages can hold addresses.
    console.warn("oauth_callback_error", e instanceof Error ? e.name : "unknown");
  }
  console.log("oauth_callback", provider, result);
  return new Response(null, {
    status: 303,
    headers: { Location: `/setup?result=${result}`, "Cache-Control": "no-store", "Set-Cookie": clearLoginCookie() },
  });
}
