import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import worker from "../src/index";
import type { VerifiedAccess } from "../src/auth/access";
import { TokenStore, importKey, type StoredToken } from "../src/crypto/tokens";
import type { Env } from "../src/env";
import { googleAccessToken, googleSignInUrl } from "../src/oauth/google";
import { providerFetch } from "../src/oauth/provider-fetch";
import { clearLoginCookie, consumeLoginState, issueLoginState } from "../src/oauth/state";
import { routeRequest } from "../src/router";
import { NotConfiguredError, NotConnectedError } from "../src/sources/types";
import { ownerAccess } from "./helpers/access";
import {
  GOOGLE_SCOPE,
  GOOGLE_TOKEN_URL,
  googleRefreshed,
  mockProviders,
  neverAnswers,
  oauthError,
  redirectTo,
  type MockedProviders,
} from "./helpers/providers";

// The Google connection (docs/design/v1.md, step 2): the login state, the callback contract,
// refresh, disconnect, and how providers are called. Google itself is mocked.

const HUB = "https://hub.example.com";
const OWNER_EMAIL = "me@example.com";
/** A fixed "now" for the functions that take one. */
const T0 = 1_800_000_000_000;
const TEN_MINUTES = 600_000;

/** A passed Access check for the owner (me@example.com), made by `verifyAccess`. */
let OWNER: VerifiedAccess;

beforeAll(async () => {
  OWNER = await ownerAccess();
});

let providers: MockedProviders;

beforeEach(async () => {
  providers = mockProviders();
  for (const key of (await env.TOKENS.list()).keys) await env.TOKENS.delete(key.name);
});

afterEach(() => {
  providers.restore();
  vi.useRealTimers();
});

/** The keys of the login states KV holds. */
const loginKeys = async (): Promise<string[]> => (await env.TOKENS.list({ prefix: "login:" })).keys.map((k) => k.name);

/** What a browser sends back for a `Set-Cookie` value: the `name=value` part. */
const asCookieHeader = (setCookie: string): string => setCookie.split(";")[0]!;

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const fromBase64url = (text: string): Uint8Array =>
  Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** The PKCE S256 challenge for a verifier, worked out here and not by the code under test. */
const s256 = async (verifier: string): Promise<string> =>
  base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));

/** The deployed Worker's settings as tests see them: the real test KV, the test values, fake data off. */
const hubEnv = (over: Partial<Env> = {}): Env =>
  ({
    ASSETS: env.ASSETS,
    TOKENS: env.TOKENS,
    TIME_ZONE: "America/Indiana/Indianapolis",
    USE_FAKES: "false",
    TOKEN_ENC_KEY: env.TOKEN_ENC_KEY,
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
    HUB_ORIGIN: env.HUB_ORIGIN,
    ...over,
  }) as Env;

/** The token store under the test key, for putting records in place and reading them back. */
const tokenStore = async (): Promise<TokenStore> => new TokenStore(env.TOKENS, await importKey(env.TOKEN_ENC_KEY));

const ONE_DAY = 86_400_000;

/** A stored Google connection, made a day before T0, whose access token is good for another hour. */
const connection = (over: Partial<StoredToken> = {}): StoredToken => ({
  accessToken: "google-access-one",
  refreshToken: "google-refresh-one",
  expiresAt: T0 + 3_600_000,
  scope: GOOGLE_SCOPE,
  connectedAt: T0 - ONE_DAY,
  ...over,
});

/** KV that also notes which keys were read. */
function watchedKv(): { kv: KVNamespace; reads: string[] } {
  const reads: string[] = [];
  const kv = {
    get: (key: string) => {
      reads.push(key);
      return env.TOKENS.get(key);
    },
    put: (key: string, value: string, options?: KVNamespacePutOptions) => env.TOKENS.put(key, value, options),
    delete: (key: string) => env.TOKENS.delete(key),
  } as unknown as KVNamespace;
  return { kv, reads };
}

const JSON_FROM_HUB = { Origin: HUB, "Content-Type": "application/json" };

/** A POST as the setup page sends it (its own origin, a JSON object), past the Access check as the owner. */
function post(
  path: string,
  e: Env = hubEnv(),
  init: { headers?: Record<string, string>; body?: string } = {},
): Promise<Response> {
  const request = new Request(`${HUB}${path}`, {
    method: "POST",
    headers: init.headers ?? JSON_FROM_HUB,
    body: init.body ?? "{}",
  });
  return routeRequest(request, e, OWNER);
}

/** A GET past the Access check as the owner. */
const get = (path: string, e: Env = hubEnv(), headers: Record<string, string> = {}): Promise<Response> =>
  routeRequest(new Request(`${HUB}${path}`, { headers }), e, OWNER);

describe("state", () => {
  const issue = (now = T0) => issueLoginState(env.TOKENS, "google", OWNER_EMAIL, now);

  /** The callback's view of an issued login: by default the right cookie, email, provider and time. */
  const consume = (login: { state: string; cookie: string }, over: Record<string, unknown> = {}) =>
    consumeLoginState(env.TOKENS, {
      state: login.state,
      cookieHeader: asCookieHeader(login.cookie),
      provider: "google",
      email: OWNER_EMAIL,
      now: T0 + 1000,
      ...over,
    });

  it("a state works once", async () => {
    const login = await issue();
    const first = await consume(login);
    // What comes back is the PKCE verifier whose challenge went to the provider.
    expect(first).not.toBeNull();
    expect(await s256(first!.verifier)).toBe(login.challenge);

    expect(await consume(login)).toBeNull();
    expect(await loginKeys()).toEqual([]);
  });

  it("an expired state is refused", async () => {
    const login = await issue();
    // KV is told to drop the record after 10 minutes.
    const [stored] = (await env.TOKENS.list({ prefix: "login:" })).keys;
    const secondsLeft = stored!.expiration! - Date.now() / 1000;
    expect(secondsLeft).toBeGreaterThan(590);
    expect(secondsLeft).toBeLessThanOrEqual(600);

    // What KV does at that point: the record is gone.
    await env.TOKENS.delete(stored!.name);
    expect(await consume(login)).toBeNull();
  });

  it("a state older than 10 minutes by its creation time is refused even while KV still holds it", async () => {
    const onTime = await issue(T0);
    expect(await consume(onTime, { now: T0 + TEN_MINUTES })).not.toBeNull();

    const late = await issue(T0);
    expect(await loginKeys()).toHaveLength(1);
    expect(await consume(late, { now: T0 + TEN_MINUTES + 1 })).toBeNull();
  });

  it("a state carries at least 128 random bits", async () => {
    const a = await issue();
    const b = await issue();
    for (const { state } of [a, b]) {
      expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(fromBase64url(state).length).toBeGreaterThanOrEqual(16);
    }
    // Nothing repeats from one login to the next.
    expect(a.state).not.toBe(b.state);
    expect(a.challenge).not.toBe(b.challenge);
    expect(a.cookie).not.toBe(b.cookie);
    // The cookie's value is its own secret, not the state that travels in addresses.
    expect(a.cookie).not.toContain(a.state);
  });

  it("the state record holds a hash of the Access email, not the email", async () => {
    const login = await issue();
    const [key] = await loginKeys();
    const raw = (await env.TOKENS.get(key!))!;
    expect(raw).not.toContain(OWNER_EMAIL);
    expect(raw).not.toContain("example.com");
    // Nor the cookie's value: only its hash.
    const cookieValue = asCookieHeader(login.cookie).split("=")[1]!;
    expect(cookieValue.length).toBeGreaterThanOrEqual(22);
    expect(raw).not.toContain(cookieValue);
    // And nothing beyond the five things G6b names.
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(["cookieHash", "createdAt", "emailHash", "provider", "verifier"]);
  });

  it("a state is refused with the wrong cookie or the wrong Access email", async () => {
    const other = await issue();
    const cookieValue = (login: { cookie: string }) => asCookieHeader(login.cookie).split("=")[1]!;
    const wrong: Record<string, unknown>[] = [
      { cookieHeader: null },
      { cookieHeader: "" },
      { cookieHeader: asCookieHeader(other.cookie) }, // another login's cookie
      { cookieHeader: "__Host-hub_login=" },
      { cookieHeader: `session=${cookieValue(other)}` },
      { email: "someone-else@example.com" },
      { email: "" },
    ];
    for (const over of wrong) {
      const login = await issue();
      expect(await consume(login, over), JSON.stringify(over)).toBeNull();
      // A refused attempt uses the state up all the same.
      expect(await consume(login), JSON.stringify(over)).toBeNull();
    }

    // The right value under another name is not the cookie either.
    const renamed = await issue();
    expect(await consume(renamed, { cookieHeader: `other=${cookieValue(renamed)}` })).toBeNull();

    // The cookie is found among others, as a browser sends them.
    const login = await issue();
    expect(await consume(login, { cookieHeader: `a=1; ${asCookieHeader(login.cookie)}; b=2` })).not.toBeNull();
  });

  it("a state made for one provider is refused at the other's callback", async () => {
    const login = await issue();
    expect(await consume(login, { provider: "ticktick" })).toBeNull();
    expect(await consume(login)).toBeNull();
  });

  it("a state of the wrong shape is refused without asking KV", async () => {
    const untouched = {
      get: () => Promise.reject(new Error("KV was asked")),
      delete: () => Promise.reject(new Error("KV was asked")),
    } as unknown as KVNamespace;
    for (const state of ["", "short", "../oauth:google", "x".repeat(500), "has space and + / chars in it, 43 long...."]) {
      const refused = await consumeLoginState(untouched, {
        state,
        cookieHeader: null,
        provider: "google",
        email: OWNER_EMAIL,
        now: T0,
      });
      expect(refused, state).toBeNull();
    }
  });

  it("the cookie is a __Host- cookie: Secure, HttpOnly, SameSite=Lax, for 10 minutes", async () => {
    const { cookie } = await issue();
    const [pair, ...attributes] = cookie.split("; ");
    expect(pair).toMatch(/^__Host-hub_login=[A-Za-z0-9_-]+$/);
    // A __Host- cookie must be Secure, have Path=/ and no Domain, or browsers drop it.
    expect(attributes.sort()).toEqual(["HttpOnly", "Max-Age=600", "Path=/", "SameSite=Lax", "Secure"]);

    // Clearing it: the same cookie, empty and ended.
    expect(clearLoginCookie().split("; ").sort()).toEqual([
      "HttpOnly",
      "Max-Age=0",
      "Path=/",
      "SameSite=Lax",
      "Secure",
      "__Host-hub_login=",
    ]);
  });
});

describe("Sign-in address", () => {
  it("the sign-in address never asks for include_granted_scopes", () => {
    const address = new URL(
      googleSignInUrl({
        clientId: "test-google-client-id",
        redirectUri: "https://hub.example.com/oauth/google/callback",
        state: "the-state",
        challenge: "the-challenge",
      }),
    );
    expect(address.origin + address.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    // Exactly these: the one scope, offline access with consent (so a refresh token comes
    // back, G5), the state and the PKCE challenge. Nothing that widens the grant.
    expect(Object.fromEntries(address.searchParams)).toEqual({
      client_id: "test-google-client-id",
      redirect_uri: "https://hub.example.com/oauth/google/callback",
      response_type: "code",
      scope: "https://www.googleapis.com/auth/calendar.events.readonly",
      access_type: "offline",
      prompt: "consent",
      state: "the-state",
      code_challenge: "the-challenge",
      code_challenge_method: "S256",
    });
    expect(address.href).not.toContain("include_granted_scopes");
  });
});

describe("Refresh", () => {
  /** What is stored for Google now, or null. */
  const stored = async () => (await tokenStore()).get("google");
  const put = async (token: StoredToken) => (await tokenStore()).put("google", token);

  it("uses a token that has not expired as it is", async () => {
    await put(connection());
    expect(await googleAccessToken(hubEnv(), T0)).toBe("google-access-one");
    expect(providers.calls).toEqual([]);
  });

  it("an expired access token is refreshed and the refresh token is kept", async () => {
    await put(connection({ expiresAt: T0 - 1 }));
    providers.answer(GOOGLE_TOKEN_URL, googleRefreshed());

    expect(await googleAccessToken(hubEnv(), T0)).toBe("google-access-two");

    // One request, to Google's token address, as its docs describe a refresh.
    expect(providers.calls).toHaveLength(1);
    const [call] = providers.calls;
    expect(call).toMatchObject({ url: GOOGLE_TOKEN_URL, method: "POST", redirect: "manual" });
    expect(call!.headers.get("Content-Type")).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(call!.form)).toEqual({
      client_id: "test-google-client-id",
      client_secret: "test-google-client-secret",
      grant_type: "refresh_token",
      refresh_token: "google-refresh-one",
    });

    // The new access token and its expiry (3920 seconds on) are saved. The rest is as it was.
    expect(await stored()).toEqual({
      accessToken: "google-access-two",
      refreshToken: "google-refresh-one",
      expiresAt: T0 + 3_920_000,
      scope: GOOGLE_SCOPE,
      connectedAt: T0 - ONE_DAY,
    });
  });

  it("a token within 60 seconds of expiry is refreshed first", async () => {
    await put(connection({ expiresAt: T0 + 60_000 }));
    expect(await googleAccessToken(hubEnv(), T0)).toBe("google-access-one");
    expect(providers.calls).toEqual([]);

    await put(connection({ expiresAt: T0 + 59_999 }));
    providers.answer(GOOGLE_TOKEN_URL, googleRefreshed());
    expect(await googleAccessToken(hubEnv(), T0)).toBe("google-access-two");
    expect(providers.calls).toHaveLength(1);
  });

  it("a token with no stored expiry is refreshed first", async () => {
    await put(connection({ expiresAt: undefined }));
    // Google's answer gives no lifetime this time, so none is stored: no length is assumed.
    providers.answer(GOOGLE_TOKEN_URL, googleRefreshed({ expires_in: undefined }));
    expect(await googleAccessToken(hubEnv(), T0)).toBe("google-access-two");
    expect((await stored())!.expiresAt).toBeUndefined();

    // So the next use refreshes again.
    providers.answer(GOOGLE_TOKEN_URL, googleRefreshed({ access_token: "google-access-three" }));
    expect(await googleAccessToken(hubEnv(), T0)).toBe("google-access-three");
    expect(providers.calls).toHaveLength(2);
  });

  it("a new refresh token is saved", async () => {
    await put(connection({ expiresAt: T0 - 1 }));
    providers.answer(GOOGLE_TOKEN_URL, googleRefreshed({ refresh_token: "google-refresh-two" }));
    await googleAccessToken(hubEnv(), T0);
    expect(await stored()).toMatchObject({
      accessToken: "google-access-two",
      refreshToken: "google-refresh-two",
      connectedAt: T0 - ONE_DAY,
    });
  });

  it("invalid_grant re-reads once and deletes only the same connection, then answers not_connected", async () => {
    await put(connection({ expiresAt: T0 - 1 }));
    providers.answer(GOOGLE_TOKEN_URL, oauthError("invalid_grant"));
    const { kv, reads } = watchedKv();

    // NotConnectedError("google") is what the router answers `not_connected` for.
    const refused = await googleAccessToken(hubEnv({ TOKENS: kv }), T0).catch((e) => e);
    expect(refused).toBeInstanceOf(NotConnectedError);
    expect(refused.provider).toBe("google");

    // Read once to use it, once more after the refusal, and then deleted.
    expect(reads).toEqual(["oauth:google", "oauth:google"]);
    expect(await env.TOKENS.get("oauth:google")).toBeNull();
    expect(providers.calls).toHaveLength(1);
  });

  it("invalid_grant on an old record does not delete a newer one (the newer one is tried once)", async () => {
    const newer = connection({ accessToken: "google-access-newer", refreshToken: "google-refresh-newer", connectedAt: T0 });
    /** The owner reconnects while the old record's refresh is on its way. */
    const reconnectDuringRefresh = (record: StoredToken) => async () => {
      await put(record);
      return oauthError("invalid_grant");
    };

    // The newer connection's token is good: it is used, with no further call.
    await put(connection({ expiresAt: T0 - 1 }));
    providers.answer(GOOGLE_TOKEN_URL, reconnectDuringRefresh(newer));
    expect(await googleAccessToken(hubEnv(), T0)).toBe("google-access-newer");
    expect(await stored()).toEqual(newer);
    expect(providers.calls).toHaveLength(1);

    // The newer connection's token has expired too: it is refreshed, with its own refresh token.
    const newerExpired = { ...newer, expiresAt: T0 - 1 };
    await put(connection({ expiresAt: T0 - 1 }));
    providers.answer(GOOGLE_TOKEN_URL, reconnectDuringRefresh(newerExpired), googleRefreshed());
    expect(await googleAccessToken(hubEnv(), T0)).toBe("google-access-two");
    expect(providers.calls.at(-1)!.form.get("refresh_token")).toBe("google-refresh-newer");
    expect(await stored()).toMatchObject({ accessToken: "google-access-two", connectedAt: T0 });
    expect(providers.calls).toHaveLength(3);

    // The newer connection is refused as well: it is tried once and never deleted. A plain
    // failure, not `not_connected`; the next request starts from that record.
    await put(connection({ expiresAt: T0 - 1 }));
    providers.answer(GOOGLE_TOKEN_URL, reconnectDuringRefresh(newerExpired), oauthError("invalid_grant"));
    const failed = await googleAccessToken(hubEnv(), T0).catch((e) => e);
    expect(failed).toMatchObject({ name: "ProviderError", kind: "refused" });
    expect(await stored()).toEqual(newerExpired);
    expect(providers.calls).toHaveLength(5);
  });

  it("two refreshes at once both succeed", async () => {
    await put(connection({ expiresAt: T0 - 1 }));
    providers.answer(GOOGLE_TOKEN_URL, googleRefreshed(), googleRefreshed({ access_token: "google-access-three" }));

    const both = await Promise.all([googleAccessToken(hubEnv(), T0), googleAccessToken(hubEnv(), T0)]);
    expect(both.sort()).toEqual(["google-access-three", "google-access-two"]);

    // The last one saved wins, and the refresh token is still there for next time.
    const after = await stored();
    expect(both).toContain(after!.accessToken);
    expect(after).toMatchObject({ refreshToken: "google-refresh-one", connectedAt: T0 - ONE_DAY });
  });

  it("a refresh that fails some other way leaves the record alone", async () => {
    const expired = connection({ expiresAt: T0 - 1 });
    const failures = [
      { answer: new Response("upstream trouble", { status: 500 }), kind: "refused" },
      { answer: oauthError("invalid_client", 401), kind: "refused" },
      { answer: oauthError("invalid_request", 400), kind: "refused" },
      // A 200 that is not a token answer.
      { answer: new Response('{"hello":"world"}', { status: 200 }), kind: "refused" },
      { answer: redirectTo("https://elsewhere.example/token"), kind: "redirect" },
    ];
    for (const { answer, kind } of failures) {
      await put(expired);
      providers.answer(GOOGLE_TOKEN_URL, answer);
      const failed = await googleAccessToken(hubEnv(), T0).catch((e) => e);
      expect(failed, kind).toMatchObject({ name: "ProviderError", kind });
      expect(await stored()).toEqual(expired);
    }
    // One request each: nothing is retried, and no redirect is followed.
    expect(providers.calls.map((c) => c.url)).toEqual(failures.map(() => GOOGLE_TOKEN_URL));
  });

  it("answers not_connected when there is nothing usable to refresh", async () => {
    // Nothing stored.
    await expect(googleAccessToken(hubEnv(), T0)).rejects.toBeInstanceOf(NotConnectedError);
    // A record this key can't read (a key change, G2). It is left for Disconnect to delete.
    await env.TOKENS.put("oauth:google", "v1.garbage.garbage");
    await expect(googleAccessToken(hubEnv(), T0)).rejects.toBeInstanceOf(NotConnectedError);
    expect(await env.TOKENS.get("oauth:google")).toBe("v1.garbage.garbage");
    // An expired token with no refresh token.
    await put(connection({ expiresAt: T0 - 1, refreshToken: undefined }));
    await expect(googleAccessToken(hubEnv(), T0)).rejects.toBeInstanceOf(NotConnectedError);

    expect(providers.calls).toEqual([]);
  });

  it("answers not_configured, without calling Google, when the key or a client setting is missing or bad", async () => {
    await put(connection({ expiresAt: T0 - 1 }));
    const broken: Partial<Env>[] = [
      { TOKEN_ENC_KEY: undefined },
      { TOKEN_ENC_KEY: "not a key" },
      { GOOGLE_CLIENT_ID: undefined },
      { GOOGLE_CLIENT_ID: "  " },
      { GOOGLE_CLIENT_SECRET: undefined },
      { GOOGLE_CLIENT_SECRET: "" },
    ];
    for (const over of broken) {
      await expect(googleAccessToken(hubEnv(over), T0), JSON.stringify(over)).rejects.toBeInstanceOf(NotConfiguredError);
    }
    expect(providers.calls).toEqual([]);
  });
});

describe("Connect", () => {
  /** Nothing was started: no login state in KV, no cookie handed out. */
  async function expectNoLoginStarted(res: Response, label = ""): Promise<void> {
    expect(await loginKeys(), label).toEqual([]);
    expect(res.headers.get("Set-Cookie"), label).toBeNull();
  }

  const expectNotConfigured = async (res: Response, label = ""): Promise<void> => {
    expect(res.status, label).toBe(503);
    expect(await res.json(), label).toEqual({ error: "not_configured" });
    await expectNoLoginStarted(res, label);
  };

  it("answers with Google's sign-in address, and sets the login state and its cookie", async () => {
    const res = await post("/setup/connect/google");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const { url } = (await res.json()) as { url: string };

    const address = new URL(url);
    expect(address.origin + address.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(address.searchParams.get("client_id")).toBe("test-google-client-id");
    // The fixed redirect address: the hub's own origin and the Google callback path.
    expect(address.searchParams.get("redirect_uri")).toBe("https://hub.example.com/oauth/google/callback");

    // The state in the address is the one KV now holds, and the challenge is its verifier's.
    const state = address.searchParams.get("state")!;
    expect(await loginKeys()).toEqual([`login:${state}`]);
    const record = JSON.parse((await env.TOKENS.get(`login:${state}`))!);
    expect(record.provider).toBe("google");
    expect(address.searchParams.get("code_challenge")).toBe(await s256(record.verifier));

    expect(res.headers.get("Set-Cookie")).toMatch(/^__Host-hub_login=[A-Za-z0-9_-]{43}; /);
  });

  it("connect needs POST and the F5 checks", async () => {
    const viaGet = await get("/setup/connect/google");
    expect(viaGet.status).toBe(405);
    expect(viaGet.headers.get("Allow")).toBe("POST");
    await expectNoLoginStarted(viaGet, "GET");

    const refused: { label: string; headers: Record<string, string>; body?: string; status: number; error: string }[] = [
      { label: "another origin", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, status: 403, error: "cross_site" },
      { label: "no Origin", headers: { "Content-Type": "application/json" }, status: 403, error: "cross_site" },
      { label: "not JSON", headers: { Origin: HUB, "Content-Type": "text/plain" }, status: 400, error: "bad_body" },
      { label: "a form", headers: { Origin: HUB, "Content-Type": "application/x-www-form-urlencoded" }, body: "a=1", status: 400, error: "bad_body" },
      { label: "not an object", headers: JSON_FROM_HUB, body: "[]", status: 400, error: "bad_body" },
    ];
    for (const { label, headers, body, status, error } of refused) {
      const res = await post("/setup/connect/google", hubEnv(), { headers, body });
      expect(res.status, label).toBe(status);
      expect(await res.json(), label).toMatchObject({ error });
      await expectNoLoginStarted(res, label);
    }
  });

  it("connect answers not_configured and issues no state when the key, a client setting or HUB_ORIGIN is missing or bad", async () => {
    const broken: Partial<Env>[] = [
      { TOKEN_ENC_KEY: undefined },
      { TOKEN_ENC_KEY: "" },
      { TOKEN_ENC_KEY: "not a key" },
      { TOKEN_ENC_KEY: btoa("too short to be a key") },
      { GOOGLE_CLIENT_ID: undefined },
      { GOOGLE_CLIENT_ID: "" },
      { GOOGLE_CLIENT_SECRET: undefined },
      { GOOGLE_CLIENT_SECRET: "   " },
      { HUB_ORIGIN: undefined },
      { HUB_ORIGIN: "" },
      { HUB_ORIGIN: "not an address" },
    ];
    for (const over of broken) {
      await expectNotConfigured(await post("/setup/connect/google", hubEnv(over)), JSON.stringify(over));
    }
  });

  it("connect answers not_configured when HUB_ORIGIN is not an https origin or has a path", async () => {
    const notAnHttpsOrigin = [
      "http://hub.example.com",
      "hub.example.com",
      "https://hub.example.com/",
      "https://hub.example.com/hub",
      "https://hub.example.com?next=1",
      "https://hub.example.com#top",
      "https://owner@hub.example.com",
    ];
    for (const HUB_ORIGIN of notAnHttpsOrigin) {
      await expectNotConfigured(await post("/setup/connect/google", hubEnv({ HUB_ORIGIN })), HUB_ORIGIN);
    }
  });

  it("connect answers not_configured when HUB_ORIGIN differs from the request's origin", async () => {
    for (const HUB_ORIGIN of ["https://other.example.com", "https://hub.example.com:8443", "https://hub.example.com.evil.example"]) {
      await expectNotConfigured(await post("/setup/connect/google", hubEnv({ HUB_ORIGIN })), HUB_ORIGIN);
    }
  });

  it("connect refuses under the local-development skip", async () => {
    // Everything connect needs is set, for a hub at https://localhost. A caller with a real
    // Access result is served there...
    const LOCAL = "https://localhost";
    const settings = hubEnv({ HUB_ORIGIN: LOCAL });
    const connectRequest = (headers: Record<string, string> = {}) =>
      new Request(`${LOCAL}/setup/connect/google`, {
        method: "POST",
        headers: { Origin: LOCAL, "Content-Type": "application/json", ...headers },
        body: "{}",
      });
    expect((await routeRequest(connectRequest(), settings, OWNER)).status).toBe(200);
    for (const key of await loginKeys()) await env.TOKENS.delete(key);

    // ...but a request that got past Access by the local-development skip is not (G7).
    const devEnv = { ...settings, USE_FAKES: "true", DEV_SKIP_ACCESS: "true" } as Env;
    const res = await worker.fetch(connectRequest({ "CF-Connecting-IP": "127.0.0.1" }), devEnv);
    // Not 401 or 403: the page reads those as "sign in again".
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "not_enabled" });
    await expectNoLoginStarted(res);
  });

  it("an unknown provider name in the /setup routes answers 404", async () => {
    const unknown = [
      "/setup/connect/evil",
      "/setup/connect/Google",
      "/setup/connect/%67oogle",
      "/setup/connect/google/",
      "/setup/connect/google/extra",
      "/setup/connect/",
      "/setup/connect",
      "/setup/disconnect/evil",
      "/setup/disconnect/",
      "/setup/elsewhere/google",
    ];
    for (const path of unknown) {
      const res = await post(path);
      expect(res.status, path).toBe(404);
      // The router's own answer, not a missing static file.
      expect(await res.json(), path).toEqual({ error: "not_found" });
      await expectNoLoginStarted(res, path);
    }
  });

  it("connect for TickTick answers not_configured until step 4 builds it", async () => {
    await expectNotConfigured(await post("/setup/connect/ticktick"));
  });
});

describe("Provider calls", () => {
  const send = () =>
    providerFetch("test.call", GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=test",
    });

  it("hands back the status and the JSON of an answer, whatever the status", async () => {
    providers.answer(
      GOOGLE_TOKEN_URL,
      new Response('{"access_token":"google-access-one"}', { status: 200 }),
      oauthError("invalid_grant", 400),
      new Response("<html>not json</html>", { status: 502 }),
    );
    expect(await send()).toEqual({ status: 200, json: { access_token: "google-access-one" } });
    expect(await send()).toEqual({
      status: 400,
      json: { error: "invalid_grant", error_description: "Described by the provider." },
    });
    expect(await send()).toEqual({ status: 502, json: null });

    // What was asked for is what was sent.
    expect(providers.calls).toHaveLength(3);
    expect(providers.calls[0]).toMatchObject({ url: GOOGLE_TOKEN_URL, method: "POST" });
    expect(providers.calls[0]!.form.get("grant_type")).toBe("test");
  });

  it("a redirected provider answer is a failure and the redirect is not followed", async () => {
    const statuses = [301, 302, 303, 307, 308];
    for (const status of statuses) {
      providers.answer(GOOGLE_TOKEN_URL, redirectTo("https://elsewhere.example/token", status));
      await expect(send()).rejects.toMatchObject({ name: "ProviderError", kind: "redirect" });
    }
    // One request per call, each telling `fetch` not to follow, and none to the redirect's address.
    expect(providers.calls.map((c) => c.url)).toEqual(statuses.map(() => GOOGLE_TOKEN_URL));
    expect(providers.calls.map((c) => c.redirect)).toEqual(statuses.map(() => "manual"));
  });

  it("a provider that doesn't answer in time is a failure", async () => {
    vi.useFakeTimers();
    providers.answer(GOOGLE_TOKEN_URL, neverAnswers());
    let outcome = "waiting";
    const call = send().then(
      () => (outcome = "answered"),
      (e) => (outcome = `${e.name}: ${e.kind}`),
    );

    // Still waiting just before 10 seconds; given up on at 10 seconds.
    await vi.advanceTimersByTimeAsync(9_999);
    expect(outcome).toBe("waiting");
    await vi.advanceTimersByTimeAsync(1);
    await call;
    expect(outcome).toBe("ProviderError: timeout");
  });

  it("a call that fails on the way is a failure", async () => {
    providers.answer(GOOGLE_TOKEN_URL, () => {
      throw new TypeError("connection reset");
    });
    await expect(send()).rejects.toMatchObject({ name: "ProviderError", kind: "network" });
  });
});
