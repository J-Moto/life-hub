import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import worker from "../src/index";
import type { VerifiedAccess } from "../src/auth/access";
import { TokenStore, importKey, type StoredToken } from "../src/crypto/tokens";
import type { Env } from "../src/env";
import { googleAccessToken, googleSignInUrl, sameScopes } from "../src/oauth/google";
import { providerFetch } from "../src/oauth/provider-fetch";
import { clearLoginCookie, consumeLoginState, issueLoginState } from "../src/oauth/state";
import { routeRequest } from "../src/router";
import { NotConfiguredError, NotConnectedError } from "../src/sources/types";
import { ownerAccess } from "./helpers/access";
import {
  GOOGLE_REVOKE_URL,
  GOOGLE_SCOPE,
  GOOGLE_TOKEN_URL,
  googleRefreshed,
  googleTokens,
  mockProviders,
  neverAnswers,
  oauthError,
  redirectTo,
  revoked,
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

/** What the owner's browser holds after connect: the state on its way to Google, and the cookie. */
interface Login {
  state: string;
  challenge: string;
  /** As the browser sends it back: `name=value`. */
  cookie: string;
}

/** Presses Connect for Google as the owner. */
async function startLogin(e: Env = hubEnv(), body = "{}"): Promise<Login> {
  const res = await post("/setup/connect/google", e, { body });
  expect(res.status).toBe(200);
  const address = new URL(((await res.json()) as { url: string }).url);
  return {
    state: address.searchParams.get("state")!,
    challenge: address.searchParams.get("code_challenge")!,
    cookie: asCookieHeader(res.headers.get("Set-Cookie")!),
  };
}

interface CallbackOptions {
  e?: Env;
  /** What comes back beside the state. Default: a code. */
  query?: Record<string, string>;
  path?: string;
  headers?: Record<string, string>;
  access?: VerifiedAccess;
}

/** Google's redirect back to the hub, as the owner's browser makes it. */
function callback(login: Pick<Login, "state" | "cookie">, o: CallbackOptions = {}): Promise<Response> {
  const query = new URLSearchParams({ state: login.state, ...(o.query ?? { code: "the-code" }) });
  const request = new Request(`${HUB}${o.path ?? "/oauth/google/callback"}?${query}`, {
    headers: { ...(login.cookie ? { Cookie: login.cookie } : {}), ...o.headers },
  });
  return routeRequest(request, o.e ?? hubEnv(), o.access ?? OWNER);
}

/** The callback's one kind of answer: back to /setup with a fixed word, uncached, the cookie cleared. */
async function expectSentBack(res: Response, result: "connected" | "failed", label = ""): Promise<void> {
  expect(res.status, label).toBe(303);
  expect(res.headers.get("Location"), label).toBe(`/setup?result=${result}`);
  expect(res.headers.get("Cache-Control"), label).toBe("no-store");
  expect(res.headers.get("Set-Cookie"), label).toBe("__Host-hub_login=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0");
  expect(await res.text(), label).toBe("");
}

const allKeys = async (): Promise<string[]> => (await env.TOKENS.list()).keys.map((k) => k.name);

/** KV in which a token record can't be written. Everything else works. */
const kvThatCannotStoreTokens = (): KVNamespace =>
  ({
    get: (key: string) => env.TOKENS.get(key),
    delete: (key: string) => env.TOKENS.delete(key),
    put: (key: string, value: string, options?: KVNamespacePutOptions) =>
      key.startsWith("oauth:") ? Promise.reject(new Error("KV put failed")) : env.TOKENS.put(key, value, options),
  }) as unknown as KVNamespace;

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

    // Nothing was stored, so there was nothing to ask Google for.
    expect(providers.calls).toEqual([]);
  });

  it("connect ends a connection that is already stored, so a new one can't leave its grant alive", async () => {
    // Say a second /setup tab that still shows Connect although Google is connected (G1).
    await (await tokenStore()).put("google", connection());
    providers.answer(GOOGLE_REVOKE_URL, revoked());
    await startLogin();

    // One call to Google: the stored refresh token, which ends the whole grant, in the form body.
    expect(providers.calls).toHaveLength(1);
    expect(providers.calls[0]).toMatchObject({ url: GOOGLE_REVOKE_URL, method: "POST", redirect: "manual" });
    expect(Object.fromEntries(providers.calls[0]!.form)).toEqual({ token: "google-refresh-one" });
    // The old record is gone before the owner leaves for Google: KV holds the new login state only.
    expect(await allKeys()).toEqual(await loginKeys());
    expect(await loginKeys()).toHaveLength(1);
  });

  it("the connection made after that is the only one, and nothing of it is revoked", async () => {
    await (await tokenStore()).put("google", connection());
    providers.answer(GOOGLE_REVOKE_URL, revoked());
    const login = await startLogin();
    providers.answer(GOOGLE_TOKEN_URL, googleTokens({ access_token: "google-access-new", refresh_token: "google-refresh-new" }));
    await expectSentBack(await callback(login), "connected");

    expect(await (await tokenStore()).get("google")).toMatchObject({
      accessToken: "google-access-new",
      refreshToken: "google-refresh-new",
    });
    // The old token was revoked before the new grant existed. Nothing is revoked after it:
    // Google's docs don't say a revoke leaves the account's other tokens for this app alone.
    expect(providers.calls.map((c) => c.url)).toEqual([GOOGLE_REVOKE_URL, GOOGLE_TOKEN_URL]);
    expect(providers.calls[0]!.form.get("token")).toBe("google-refresh-one");
  });

  it("a revoke that fails does not stop connect, and the old record still goes", async () => {
    const failures = [
      new Response("upstream trouble", { status: 500 }),
      () => {
        throw new TypeError("connection reset");
      },
    ];
    for (const failure of failures) {
      await (await tokenStore()).put("google", connection());
      providers.answer(GOOGLE_REVOKE_URL, failure);
      await startLogin();
      expect(await env.TOKENS.get("oauth:google")).toBeNull();
    }
    expect(providers.calls.map((c) => c.url)).toEqual(failures.map(() => GOOGLE_REVOKE_URL));

    // A record that can't be decrypted has nothing to revoke with: it goes, and Google is not called.
    await env.TOKENS.put("oauth:google", "v1.garbage.garbage");
    await startLogin();
    expect(await env.TOKENS.get("oauth:google")).toBeNull();
    expect(providers.calls).toHaveLength(failures.length);
  });

  it("a connect that is refused leaves a stored connection as it was", async () => {
    await (await tokenStore()).put("google", connection());
    const stored = await env.TOKENS.get("oauth:google");

    await expectNotConfigured(await post("/setup/connect/google", hubEnv({ HUB_ORIGIN: undefined })), "no HUB_ORIGIN");
    await expectNotConfigured(await post("/setup/connect/google", hubEnv({ GOOGLE_CLIENT_SECRET: undefined })), "no client secret");
    const crossSite = await post("/setup/connect/google", hubEnv(), {
      headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
    });
    expect(crossSite.status).toBe(403);

    expect(await env.TOKENS.get("oauth:google")).toBe(stored);
    expect(providers.calls).toEqual([]);
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

describe("Callback", () => {
  const storedGoogle = async () => (await tokenStore()).get("google");

  it("the callback stores only an encrypted record", async () => {
    const login = await startLogin();
    providers.answer(GOOGLE_TOKEN_URL, googleTokens());
    const before = Date.now();
    const res = await callback(login);
    const after = Date.now();
    await expectSentBack(res, "connected");

    // One request to Google: the code exchange, as its docs describe it, with the PKCE verifier.
    expect(providers.calls).toHaveLength(1);
    const [exchange] = providers.calls;
    expect(exchange).toMatchObject({ url: GOOGLE_TOKEN_URL, method: "POST", redirect: "manual" });
    expect(exchange!.headers.get("Content-Type")).toBe("application/x-www-form-urlencoded");
    const { code_verifier, ...form } = Object.fromEntries(exchange!.form);
    expect(form).toEqual({
      code: "the-code",
      client_id: "test-google-client-id",
      client_secret: "test-google-client-secret",
      redirect_uri: "https://hub.example.com/oauth/google/callback",
      grant_type: "authorization_code",
    });
    expect(await s256(code_verifier!)).toBe(login.challenge);

    // KV holds the token record and nothing else: the login state is used up.
    expect(await allKeys()).toEqual(["oauth:google"]);
    const raw = (await env.TOKENS.get("oauth:google"))!;
    expect(raw.startsWith("v1.")).toBe(true);
    expect(raw).not.toContain("google-access-one");
    expect(raw).not.toContain("google-refresh-one");

    // Under the key it is the connection: both tokens, the scope, the expiry and when it was made.
    const token = (await storedGoogle())!;
    expect(token).toMatchObject({ accessToken: "google-access-one", refreshToken: "google-refresh-one", scope: GOOGLE_SCOPE });
    expect(token.expiresAt).toBeGreaterThanOrEqual(before + 3_920_000);
    expect(token.expiresAt).toBeLessThanOrEqual(after + 3_920_000);
    expect(token.connectedAt).toBeGreaterThanOrEqual(before);
    expect(token.connectedAt).toBeLessThanOrEqual(after);
  });

  it("the state is gone after a failed code exchange", async () => {
    const login = await startLogin();
    providers.answer(GOOGLE_TOKEN_URL, oauthError("invalid_grant"), googleTokens());
    await expectSentBack(await callback(login), "failed");
    expect(await loginKeys()).toEqual([]);

    // Going back to the same address does not try again: Google's good answer is never asked for.
    await expectSentBack(await callback(login), "failed");
    expect(providers.calls).toHaveLength(1);
    expect(await allKeys()).toEqual([]);
  });

  it("a failed code exchange stores nothing and leaves an existing record alone", async () => {
    const failures = (): Response[] => [
      oauthError("invalid_grant"),
      new Response("upstream trouble", { status: 500 }),
      new Response('{"hello":"world"}', { status: 200 }), // a 200 that is not a token answer
      redirectTo("https://elsewhere.example/token"),
    ];

    // Nothing was stored before: nothing is stored after.
    for (const failure of failures()) {
      const login = await startLogin();
      providers.answer(GOOGLE_TOKEN_URL, failure);
      await expectSentBack(await callback(login), "failed");
      expect(await allKeys()).toEqual([]);
    }

    // A connection is stored by the time the callback runs (connect ends one that is there
    // before, so this one arrived since): it is byte for byte what it was.
    for (const failure of failures()) {
      const login = await startLogin();
      await (await tokenStore()).put("google", connection());
      const existing = await env.TOKENS.get("oauth:google");
      providers.answer(GOOGLE_TOKEN_URL, failure);
      await expectSentBack(await callback(login), "failed");
      expect(await env.TOKENS.get("oauth:google")).toBe(existing);
      await env.TOKENS.delete("oauth:google");
    }
    // One request per attempt: no retry, and the redirect was not followed.
    expect(providers.calls.map((c) => c.url)).toEqual(Array(8).fill(GOOGLE_TOKEN_URL));
  });

  it("a callback with error= consumes the state, stores nothing and shows a fixed message", async () => {
    const login = await startLogin();
    const res = await callback(login, {
      query: { error: "access_denied", error_description: "<script>alert(1)</script>" },
    });
    // The fixed word `failed`, which the setup page turns into fixed text. Nothing from the
    // query string is in the answer.
    await expectSentBack(res, "failed");
    for (const [name, value] of res.headers) {
      expect(value, name).not.toContain("access_denied");
      expect(value, name).not.toContain("script");
    }
    expect(await allKeys()).toEqual([]);

    // An error wins over a code that comes with it, and the state is used up by either.
    const both = await startLogin();
    await expectSentBack(await callback(both, { query: { error: "access_denied", code: "the-code" } }), "failed");
    await expectSentBack(await callback(login), "failed");
    await expectSentBack(await callback(both), "failed");
    expect(providers.calls).toEqual([]);
    expect(await allKeys()).toEqual([]);
  });

  it("a token response without a refresh token stores nothing", async () => {
    const login = await startLogin();
    providers.answer(GOOGLE_TOKEN_URL, googleTokens({ refresh_token: undefined }));
    providers.answer(GOOGLE_REVOKE_URL, revoked());
    await expectSentBack(await callback(login), "failed");
    expect(await allKeys()).toEqual([]);

    // The grant Google just made is given back, so none is left that the hub doesn't hold.
    const revokes = providers.callsTo(GOOGLE_REVOKE_URL);
    expect(revokes).toHaveLength(1);
    expect(Object.fromEntries(revokes[0]!.form)).toEqual({ token: "google-access-one" });
  });

  it("a scope that differs from the one requested stores nothing (the same scopes in another order are accepted)", async () => {
    const differing = [
      `${GOOGLE_SCOPE} https://www.googleapis.com/auth/calendar.readonly`, // more than was asked for
      "https://www.googleapis.com/auth/calendar.readonly", // something else
      GOOGLE_SCOPE.toUpperCase(), // scopes are case-sensitive
      "",
      undefined, // no scope field at all
    ];
    for (const scope of differing) {
      const login = await startLogin();
      providers.answer(GOOGLE_TOKEN_URL, googleTokens({ scope }));
      providers.answer(GOOGLE_REVOKE_URL, revoked());
      await expectSentBack(await callback(login), "failed", String(scope));
      expect(await allKeys(), String(scope)).toEqual([]);
    }
    // Each of those grants is given back.
    expect(providers.callsTo(GOOGLE_REVOKE_URL).map((c) => c.form.get("token"))).toEqual(
      differing.map(() => "google-refresh-one"),
    );

    // The compare is of sets of space-separated values: order and spacing don't matter.
    expect(sameScopes("b a", "a b")).toBe(true);
    expect(sameScopes("  b   a ", "a b")).toBe(true);
    expect(sameScopes("a b", "a b")).toBe(true);
    expect(sameScopes("a", "a b")).toBe(false);
    expect(sameScopes("a b c", "a b")).toBe(false);
    expect(sameScopes("a c", "a b")).toBe(false);
    expect(sameScopes("A B", "a b")).toBe(false);
    expect(sameScopes("", "a b")).toBe(false);
    expect(sameScopes(undefined, "a b")).toBe(false);
  });

  it("the callback answers 303 to /setup with no-store and clears the cookie", async () => {
    // On every way of failing, with the same answer each time.
    const login = await startLogin();
    await expectSentBack(await callback({ state: "never-issued", cookie: login.cookie }), "failed", "unknown state");
    await expectSentBack(await get("/oauth/google/callback?code=the-code"), "failed", "no state");
    await expectSentBack(await get("/oauth/google/callback"), "failed", "nothing at all");
    await expectSentBack(await callback(login, { query: {} }), "failed", "no code");
    const broken = { get: () => Promise.reject(new Error("KV is down")) } as unknown as KVNamespace;
    await expectSentBack(await callback(await startLogin(), { e: hubEnv({ TOKENS: broken }) }), "failed", "KV down");
    await expectSentBack(await callback(await startLogin(), { e: hubEnv({ TOKEN_ENC_KEY: "not a key" }) }), "failed", "bad key");
    // None of those asked Google for anything.
    expect(providers.calls).toEqual([]);

    // And on success.
    const good = await startLogin();
    providers.answer(GOOGLE_TOKEN_URL, googleTokens());
    await expectSentBack(await callback(good), "connected");
  });

  it("a token that can't be stored is revoked", async () => {
    const e = hubEnv({ TOKENS: kvThatCannotStoreTokens() });
    const login = await startLogin(e);
    providers.answer(GOOGLE_TOKEN_URL, googleTokens());
    providers.answer(GOOGLE_REVOKE_URL, revoked());
    await expectSentBack(await callback(login, { e }), "failed");
    expect(await allKeys()).toEqual([]);

    // One revoke, of the refresh token (which ends the whole grant), in the form body: the
    // token is never part of an address.
    const revokes = providers.callsTo(GOOGLE_REVOKE_URL);
    expect(revokes).toHaveLength(1);
    expect(revokes[0]).toMatchObject({ url: GOOGLE_REVOKE_URL, method: "POST", redirect: "manual" });
    expect(revokes[0]!.headers.get("Content-Type")).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(revokes[0]!.form)).toEqual({ token: "google-refresh-one" });

    // A revoke that fails too still ends in the same answer.
    const again = await startLogin(e);
    providers.answer(GOOGLE_TOKEN_URL, googleTokens());
    providers.answer(GOOGLE_REVOKE_URL, new Response("no", { status: 500 }));
    await expectSentBack(await callback(again, { e }), "failed");
  });

  it("a state works once at the callback", async () => {
    const login = await startLogin();
    providers.answer(GOOGLE_TOKEN_URL, googleTokens(), googleTokens({ access_token: "google-access-again" }));
    await expectSentBack(await callback(login), "connected");
    await expectSentBack(await callback(login), "failed");
    expect(providers.calls).toHaveLength(1);
    expect((await storedGoogle())!.accessToken).toBe("google-access-one");
  });

  it("the callback refuses a state with the wrong cookie or the wrong Access email", async () => {
    const someoneElse = await ownerAccess("someone-else@example.com");
    const other = await startLogin();
    const attempts: ((login: Login) => Promise<Response>)[] = [
      (login) => callback({ state: login.state, cookie: "" }), // no cookie
      (login) => callback({ state: login.state, cookie: other.cookie }), // another login's cookie
      (login) => callback(login, { access: someoneElse }),
    ];
    for (const attempt of attempts) {
      const login = await startLogin();
      await expectSentBack(await attempt(login), "failed");
      // Refused or not, the state is used up.
      await expectSentBack(await callback(login), "failed");
    }
    expect(providers.calls).toEqual([]);
    expect(await tokenStore().then((s) => s.read("google"))).toEqual({ status: "none" });
  });

  it("a Google state is refused at TickTick's callback", async () => {
    const login = await startLogin();
    await expectSentBack(await callback(login, { path: "/oauth/ticktick/callback" }), "failed");
    // The code and the verifier went nowhere, and the state can't be taken to the right path after.
    await expectSentBack(await callback(login), "failed");
    expect(providers.calls).toEqual([]);
    expect(await allKeys()).toEqual([]);
  });

  it("only a GET runs the callback", async () => {
    const login = await startLogin();
    const address = `${HUB}/oauth/google/callback?state=${login.state}&code=the-code`;
    const others = [
      new Request(address, { method: "HEAD", headers: { Cookie: login.cookie } }),
      new Request(address, { method: "POST", headers: { ...JSON_FROM_HUB, Cookie: login.cookie }, body: "{}" }),
    ];
    for (const request of others) {
      const res = await routeRequest(request, hubEnv(), OWNER);
      expect(res.status, request.method).toBe(405);
      expect(res.headers.get("Allow"), request.method).toBe("GET");
    }
    // Nothing happened: the state is still there, and Google was not called.
    expect(await loginKeys()).toEqual([`login:${login.state}`]);
    expect(providers.calls).toEqual([]);
    for (const path of ["/oauth/evil/callback", "/oauth/google", "/oauth/google/callback/extra", "/oauth/Google/callback"]) {
      const res = await get(`${path}?state=${login.state}&code=the-code`, hubEnv(), { Cookie: login.cookie });
      expect(res.status, path).toBe(404);
    }
    expect(await loginKeys()).toEqual([`login:${login.state}`]);
  });

  it("the callback refuses under the local-development skip", async () => {
    // A hub at https://localhost with every setting in place, and a state made for the
    // skip's own identity. Only the skip itself stands in the way (G7).
    const LOCAL = "https://localhost";
    const devEnv = { ...hubEnv({ HUB_ORIGIN: LOCAL }), USE_FAKES: "true", DEV_SKIP_ACCESS: "true" } as Env;
    const login = await issueLoginState(env.TOKENS, "google", "dev@localhost", Date.now());
    providers.answer(GOOGLE_TOKEN_URL, googleTokens());

    const res = await worker.fetch(
      new Request(`${LOCAL}/oauth/google/callback?state=${login.state}&code=the-code`, {
        headers: { Cookie: asCookieHeader(login.cookie), "CF-Connecting-IP": "127.0.0.1" },
      }),
      devEnv,
    );
    await expectSentBack(res, "failed");
    expect(providers.calls).toEqual([]);
    expect(await tokenStore().then((s) => s.read("google"))).toEqual({ status: "none" });
  });
});

describe("PKCE switch", () => {
  /** Runs one connection and returns the verifier that went to Google. */
  async function verifierSent(e: Env, connectBody = "{}", options: CallbackOptions = {}): Promise<{ verifier: string; login: Login }> {
    const login = await startLogin(e, connectBody);
    providers.answer(GOOGLE_TOKEN_URL, googleTokens());
    await callback(login, { e, ...options });
    return { verifier: providers.calls.at(-1)!.form.get("code_verifier")!, login };
  }

  it("the correct verifier is sent when the var is unset or holds anything but true", async () => {
    for (const value of [undefined, "", "false", "TRUE", "True", "1", "yes", " true", "true ", "true\n"]) {
      const { verifier, login } = await verifierSent(hubEnv({ PKCE_TEST_WRONG_VERIFIER: value }));
      expect(await s256(verifier), JSON.stringify(value)).toBe(login.challenge);
    }
  });

  it("a wrong verifier is sent only when the var is exactly true", async () => {
    const e = hubEnv({ PKCE_TEST_WRONG_VERIFIER: "true" });
    const login = await startLogin(e);
    // Google, if it checks PKCE, refuses the exchange.
    providers.answer(GOOGLE_TOKEN_URL, oauthError("invalid_grant"));
    await expectSentBack(await callback(login, { e }), "failed");

    // A verifier of the right form that does not belong to the challenge Google was given.
    const sent = providers.calls[0]!.form.get("code_verifier")!;
    expect(sent).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await s256(sent)).not.toBe(login.challenge);
    expect(await allKeys()).toEqual([]);
  });

  it("a request that asks for the test in its body, query or headers still gets the correct verifier", async () => {
    const asking = '{"PKCE_TEST_WRONG_VERIFIER":"true","pkce_test_wrong_verifier":true}';
    const { verifier, login } = await verifierSent(hubEnv(), asking, {
      query: { code: "the-code", PKCE_TEST_WRONG_VERIFIER: "true", pkce_test_wrong_verifier: "true" },
      headers: { "PKCE-Test-Wrong-Verifier": "true", "X-PKCE-TEST-WRONG-VERIFIER": "true" },
    });
    expect(await s256(verifier)).toBe(login.challenge);

    // And as a cookie of that name.
    const second = await startLogin();
    providers.answer(GOOGLE_TOKEN_URL, googleTokens());
    await callback({ state: second.state, cookie: `${second.cookie}; PKCE_TEST_WRONG_VERIFIER=true` });
    expect(await s256(providers.calls.at(-1)!.form.get("code_verifier")!)).toBe(second.challenge);
  });
});

describe("Disconnect", () => {
  const putConnection = async (over: Partial<StoredToken> = {}) => (await tokenStore()).put("google", connection(over));

  /** Disconnect answered, and the page is told whether to show the remove-access note. */
  async function expectDisconnected(res: Response, removeAccess: boolean, label = ""): Promise<void> {
    expect(res.status, label).toBe(200);
    expect(await res.json(), label).toEqual({ ok: true, removeAccess });
    expect(await env.TOKENS.get("oauth:google"), label).toBeNull();
  }

  it("disconnect revokes and deletes", async () => {
    await putConnection();
    providers.answer(GOOGLE_REVOKE_URL, revoked());
    await expectDisconnected(await post("/setup/disconnect/google"), false);

    // One call: the refresh token, which ends the whole grant, in the form body.
    expect(providers.calls).toHaveLength(1);
    expect(providers.calls[0]).toMatchObject({ url: GOOGLE_REVOKE_URL, method: "POST", redirect: "manual" });
    expect(Object.fromEntries(providers.calls[0]!.form)).toEqual({ token: "google-refresh-one" });

    // A record with no refresh token: the access token is what there is to revoke.
    await putConnection({ refreshToken: undefined });
    providers.answer(GOOGLE_REVOKE_URL, revoked());
    await expectDisconnected(await post("/setup/disconnect/google"), false);
    expect(Object.fromEntries(providers.calls[1]!.form)).toEqual({ token: "google-access-one" });
  });

  it("a revoke Google refuses because the token is already invalid counts as done", async () => {
    // The owner removed the hub on the Google account page, or the token lapsed: Google
    // answers 400 `invalid_token`. No access is left, so the page shows no remove-access note.
    await putConnection();
    providers.answer(GOOGLE_REVOKE_URL, oauthError("invalid_token", 400));
    await expectDisconnected(await post("/setup/disconnect/google"), false);
    expect(providers.calls.map((c) => c.url)).toEqual([GOOGLE_REVOKE_URL]);
  });

  it("a failed revoke still deletes", async () => {
    const failures = [
      // A 400 that says something else, or nothing readable, is not "already invalid".
      oauthError("invalid_request", 400),
      new Response("Bad Request", { status: 400 }),
      // The same word under another status is not that answer either.
      oauthError("invalid_token", 401),
      new Response("upstream trouble", { status: 500 }),
      redirectTo("https://elsewhere.example/revoke"),
      () => {
        throw new TypeError("connection reset");
      },
    ];
    for (const failure of failures) {
      await putConnection();
      providers.answer(GOOGLE_REVOKE_URL, failure);
      // The page is told to say: remove the hub's access on the provider's own account page.
      await expectDisconnected(await post("/setup/disconnect/google"), true);
    }
    // One request each: the redirect was not followed.
    expect(providers.calls.map((c) => c.url)).toEqual(failures.map(() => GOOGLE_REVOKE_URL));

    // A provider that never answers is given up on after 10 seconds, and the record still goes.
    await putConnection();
    providers.answer(GOOGLE_REVOKE_URL, neverAnswers());
    vi.useFakeTimers();
    const pending = post("/setup/disconnect/google");
    await vi.advanceTimersByTimeAsync(10_000);
    vi.useRealTimers();
    await expectDisconnected(await pending, true);
  });

  it("disconnect deletes a record that can't be decrypted and shows the remove-access note", async () => {
    // Not a record at all.
    await env.TOKENS.put("oauth:google", "v1.garbage.garbage");
    await expectDisconnected(await post("/setup/disconnect/google"), true, "garbage");

    // Written under another key, as after a key change (G2).
    const otherKey = await importKey(btoa("B".repeat(32)));
    await new TokenStore(env.TOKENS, otherKey).put("google", connection());
    await expectDisconnected(await post("/setup/disconnect/google"), true, "another key");

    // A good record, but the key is missing or bad now.
    for (const TOKEN_ENC_KEY of [undefined, "not a key"]) {
      await putConnection();
      await expectDisconnected(await post("/setup/disconnect/google", hubEnv({ TOKEN_ENC_KEY })), true, String(TOKEN_ENC_KEY));
    }

    // Nothing could be revoked, so Google was not called.
    expect(providers.calls).toEqual([]);
  });

  it("disconnect with nothing stored has nothing to do", async () => {
    await expectDisconnected(await post("/setup/disconnect/google"), false);
    expect(providers.calls).toEqual([]);
  });

  it("disconnect needs POST and the F5 checks", async () => {
    await putConnection();
    const stored = await env.TOKENS.get("oauth:google");

    const viaGet = await get("/setup/disconnect/google");
    expect(viaGet.status).toBe(405);
    expect(viaGet.headers.get("Allow")).toBe("POST");

    const refused: { headers: Record<string, string>; status: number; error: string }[] = [
      { headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, status: 403, error: "cross_site" },
      { headers: { "Content-Type": "application/json" }, status: 403, error: "cross_site" },
      { headers: { Origin: HUB, "Content-Type": "text/plain" }, status: 400, error: "bad_body" },
    ];
    for (const { headers, status, error } of refused) {
      const res = await post("/setup/disconnect/google", hubEnv(), { headers });
      expect(res.status, error).toBe(status);
      expect(await res.json(), error).toMatchObject({ error });
    }

    // The connection is as it was, and Google was not called.
    expect(await env.TOKENS.get("oauth:google")).toBe(stored);
    expect(providers.calls).toEqual([]);
  });

  it("disconnect for TickTick answers not_configured until step 4 builds it", async () => {
    const res = await post("/setup/disconnect/ticktick");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "not_configured" });
  });
});

describe("Setup page", () => {
  /** One provider's part of the page. */
  function part(html: string, provider: string) {
    const section = html.match(new RegExp(`<section data-provider="${provider}">[\\s\\S]*?</section>`))?.[0] ?? "";
    const button = (action: string) => section.match(new RegExp(`<button [^>]*data-action="${action}"[^>]*>`))?.[0];
    return {
      status: section.match(/<p class="status">([^<]*)<\/p>/)?.[1],
      /** "shown", "hidden", or "absent" when the page has no such button. */
      connect: button("connect") ? (/\shidden[\s>]/.test(button("connect")!) ? "hidden" : "shown") : "absent",
      disconnect: button("disconnect") ? (/\shidden[\s>]/.test(button("disconnect")!) ? "hidden" : "shown") : "absent",
    };
  }

  async function page(e: Env = hubEnv(), path = "/setup"): Promise<string> {
    const res = await get(path, e);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    return res.text();
  }

  it("shows both services as not connected, with no inline script, and ignores the query string", async () => {
    const html = await page();
    expect(part(html, "google")).toEqual({ status: "not connected", connect: "shown", disconnect: "hidden" });
    // TickTick has no buttons until step 4.
    expect(part(html, "ticktick")).toEqual({ status: "not connected", connect: "absent", disconnect: "absent" });

    // The CSP allows no inline script or style: the one script is the static file.
    expect(html.match(/<script[^>]*>[^<]*<\/script>/g)).toEqual(['<script type="module" src="/setup.js"></script>']);
    expect(html).not.toMatch(/\son[a-z]+=/i);
    expect(html).not.toMatch(/\sstyle=/i);
    expect(html).not.toContain("<style");

    // Nothing from the address reaches the page: the result word is the script's to read.
    expect(await page(hubEnv(), "/setup?result=%3Cscript%3Ealert(1)%3C/script%3E&error=nope")).toBe(html);
    expect(await page(hubEnv(), "/setup?result=connected")).toBe(html);
  });

  it("shows Google as connected, and nothing else about the token", async () => {
    await (await tokenStore()).put("google", connection());
    const html = await page();
    // Connected: Disconnect is the only thing offered, so a second connect can't leave an
    // older grant live at Google.
    expect(part(html, "google")).toEqual({ status: "connected", connect: "hidden", disconnect: "shown" });
    expect(part(html, "ticktick").status).toBe("not connected");
    for (const secret of ["google-access-one", "google-refresh-one", "calendar.events.readonly", "oauth:google", "v1."]) {
      expect(html, secret).not.toContain(secret);
    }
  });

  it("shows a record that can't be decrypted as not connected, with Disconnect offered", async () => {
    // G2: after a key change the old record is there but unreadable. Disconnect deletes it.
    await env.TOKENS.put("oauth:google", "v1.garbage.garbage");
    expect(part(await page(), "google")).toEqual({ status: "not connected", connect: "shown", disconnect: "shown" });

    // The same when the record is good but the key is missing or bad: never a 500.
    await (await tokenStore()).put("google", connection());
    for (const TOKEN_ENC_KEY of [undefined, "not a key"]) {
      const html = await page(hubEnv({ TOKEN_ENC_KEY }));
      expect(part(html, "google"), String(TOKEN_ENC_KEY)).toEqual({ status: "not connected", connect: "shown", disconnect: "shown" });
    }
  });

  it("offers no Connect under the local-development skip", async () => {
    const res = await worker.fetch(
      new Request("http://localhost:8787/setup", { headers: { "CF-Connecting-IP": "127.0.0.1" } }),
      { ...hubEnv(), USE_FAKES: "true", DEV_SKIP_ACCESS: "true" } as Env,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    // What `npm run dev` shows: both not connected, and where connections are made (G7).
    expect(part(html, "google")).toEqual({ status: "not connected", connect: "absent", disconnect: "hidden" });
    expect(part(html, "ticktick").status).toBe("not connected");
    expect(html).toContain("Connections are made on the deployed hub.");
    expect(await page()).not.toContain("Connections are made on the deployed hub.");
  });

  it("is a GET only", async () => {
    const viaPost = await post("/setup");
    expect(viaPost.status).toBe(405);
    expect(viaPost.headers.get("Allow")).toBe("GET");
    const viaHead = await routeRequest(new Request(`${HUB}/setup`, { method: "HEAD" }), hubEnv(), OWNER);
    expect(viaHead.status).toBe(405);
  });
});

describe("Logs", () => {
  it("no token value appears in any log line", async () => {
    const lines: string[] = [];
    const levels = ["log", "info", "warn", "error", "debug"] as const;
    const spies = levels.map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      }),
    );
    const secrets = new Set<string>([
      "the-code",
      "test-google-client-secret",
      OWNER_EMAIL,
      "google-access-one",
      "google-access-two",
      "google-refresh-one",
      "google-refresh-two",
    ]);
    const cookieValue = (login: Login) => login.cookie.split("=")[1]!;

    try {
      // A connection that works.
      const good = await startLogin();
      providers.answer(GOOGLE_TOKEN_URL, googleTokens());
      await expectSentBack(await callback(good), "connected");
      secrets.add(good.state).add(good.challenge).add(cookieValue(good));
      secrets.add(providers.calls[0]!.form.get("code_verifier")!);

      // Callbacks that fail in each way: a refused state, an error from Google, a failed
      // exchange, no refresh token (revoked), a redirect, and a token that can't be stored.
      const refusedState = await startLogin();
      await callback({ state: refusedState.state, cookie: "" });
      const denied = await startLogin();
      await callback(denied, { query: { error: "access_denied", error_description: "the owner said no" } });
      const failedExchange = await startLogin();
      providers.answer(GOOGLE_TOKEN_URL, oauthError("invalid_grant"));
      await callback(failedExchange);
      const noRefresh = await startLogin();
      providers.answer(GOOGLE_TOKEN_URL, googleTokens({ refresh_token: undefined }));
      providers.answer(GOOGLE_REVOKE_URL, revoked());
      await callback(noRefresh);
      const redirected = await startLogin();
      providers.answer(GOOGLE_TOKEN_URL, redirectTo("https://elsewhere.example/token?leak=google-access-one"));
      await callback(redirected);
      const cannotStore = hubEnv({ TOKENS: kvThatCannotStoreTokens() });
      const unstored = await startLogin(cannotStore);
      providers.answer(GOOGLE_TOKEN_URL, googleTokens());
      providers.answer(GOOGLE_REVOKE_URL, new Response("no", { status: 500 }));
      await callback(unstored, { e: cannotStore });
      for (const login of [refusedState, denied, failedExchange, noRefresh, redirected, unstored]) {
        secrets.add(login.state).add(login.challenge).add(cookieValue(login));
      }

      // Refreshes: one that works, one that fails on the way, one Google refuses.
      const store = await tokenStore();
      await store.put("google", connection({ expiresAt: T0 - 1 }));
      providers.answer(GOOGLE_TOKEN_URL, googleRefreshed({ refresh_token: "google-refresh-two" }));
      await googleAccessToken(hubEnv(), T0);
      await store.put("google", connection({ expiresAt: T0 - 1 }));
      providers.answer(GOOGLE_TOKEN_URL, () => {
        throw new TypeError("could not reach https://oauth2.googleapis.com/token with google-refresh-one");
      });
      await googleAccessToken(hubEnv(), T0).catch(() => undefined);
      providers.answer(GOOGLE_TOKEN_URL, oauthError("invalid_grant"));
      await googleAccessToken(hubEnv(), T0).catch(() => undefined);

      // Disconnects: one revoked, one whose token Google calls already invalid, one whose revoke fails.
      await store.put("google", connection());
      providers.answer(GOOGLE_REVOKE_URL, revoked());
      await post("/setup/disconnect/google");
      await store.put("google", connection());
      providers.answer(GOOGLE_REVOKE_URL, oauthError("invalid_token"));
      await post("/setup/disconnect/google");
      await store.put("google", connection());
      providers.answer(GOOGLE_REVOKE_URL, new Response("upstream trouble with google-refresh-one", { status: 500 }));
      await post("/setup/disconnect/google");
    } finally {
      for (const spy of spies) spy.mockRestore();
    }

    // Something was logged for every provider call, so the checks below are about real lines.
    expect(lines.filter((l) => l.startsWith("provider_call "))).toHaveLength(providers.calls.length);
    expect(providers.calls.length).toBeGreaterThanOrEqual(10);

    for (const line of lines) {
      for (const secret of secrets) expect(line, `a secret in: ${line.slice(0, 40)}…`).not.toContain(secret);
      // Status codes, timings and fixed words only (G6): every line has one of these shapes.
      expect(line).toMatch(
        /^(provider_call google\.(token|refresh|revoke) (\d{3}|redirect|timeout|network) \d+ms|login_state_refused [a-z]+|oauth_callback google (connected|failed)|oauth_callback_error [A-Za-z]+)$/,
      );
    }
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
