import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { providerFetch } from "../src/oauth/provider-fetch";
import { clearLoginCookie, consumeLoginState, issueLoginState } from "../src/oauth/state";
import {
  GOOGLE_TOKEN_URL,
  mockProviders,
  neverAnswers,
  oauthError,
  redirectTo,
  type MockedProviders,
} from "./helpers/providers";

// The Google connection (docs/design/v1.md, step 2): the login state, the callback contract,
// refresh, disconnect, and how providers are called. Google itself is mocked.

const OWNER_EMAIL = "me@example.com";
/** A fixed "now" for the functions that take one. */
const T0 = 1_800_000_000_000;
const TEN_MINUTES = 600_000;

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
