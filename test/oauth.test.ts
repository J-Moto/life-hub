import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { providerFetch } from "../src/oauth/provider-fetch";
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

let providers: MockedProviders;

beforeEach(() => {
  providers = mockProviders();
});

afterEach(() => {
  providers.restore();
  vi.useRealTimers();
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
