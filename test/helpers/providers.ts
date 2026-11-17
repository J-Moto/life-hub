import { vi } from "vitest";

// Mocked provider answers. Tests never reach Google: `fetch` is replaced for the length of a
// test, every call is recorded, and a call nobody queued an answer for fails.

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
/** Written out here, not imported from src: the tests state the scope on their own. */
export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";

/** One request the code under test sent to a provider. */
export interface ProviderCall {
  /** The full address, query string included. */
  url: string;
  method: string;
  headers: Headers;
  /** The form body, parsed. Empty when there was none. */
  form: URLSearchParams;
  /** The redirect mode the caller asked for. */
  redirect: string | undefined;
  signal: AbortSignal | undefined;
}

/** What the mocked provider does with a call: an answer, or a function that makes one. */
export type ProviderAnswer = Response | ((call: ProviderCall) => Response | Promise<Response>);

export interface MockedProviders {
  /** Every call, in order. */
  calls: ProviderCall[];
  /** The calls to one address (matched without its query string), in order. */
  callsTo(url: string): ProviderCall[];
  /** Queues answers for one address. Each call takes the next; a call with none queued fails. */
  answer(url: string, ...answers: ProviderAnswer[]): void;
  /** Puts the real `fetch` back. */
  restore(): void;
}

const withoutQuery = (url: string): string => {
  const u = new URL(url);
  return u.origin + u.pathname;
};

export function mockProviders(): MockedProviders {
  const calls: ProviderCall[] = [];
  const queues = new Map<string, ProviderAnswer[]>();

  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = init?.body;
    const call: ProviderCall = {
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      form: new URLSearchParams(typeof body === "string" || body instanceof URLSearchParams ? body.toString() : ""),
      redirect: init?.redirect,
      signal: init?.signal ?? undefined,
    };
    calls.push(call);
    const next = queues.get(withoutQuery(url))?.shift();
    if (!next) throw new Error(`test setup: no answer queued for ${withoutQuery(url)}`);
    return typeof next === "function" ? next(call) : next;
  });

  return {
    calls,
    callsTo: (url) => calls.filter((c) => withoutQuery(c.url) === url),
    answer(url, ...answers) {
      queues.set(url, [...(queues.get(url) ?? []), ...answers]);
    },
    restore: () => spy.mockRestore(),
  };
}

const jsonAnswer = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

/**
 * Google's answer to a code exchange, with every field its docs list. Pass a field as
 * `undefined` to leave it out.
 */
export function googleTokens(over: Record<string, unknown> = {}): Response {
  return jsonAnswer({
    access_token: "google-access-one",
    expires_in: 3920,
    token_type: "Bearer",
    scope: GOOGLE_SCOPE,
    refresh_token: "google-refresh-one",
    ...over,
  });
}

/** Google's answer to a refresh. Its docs show no `refresh_token` in it. */
export function googleRefreshed(over: Record<string, unknown> = {}): Response {
  return jsonAnswer({
    access_token: "google-access-two",
    expires_in: 3920,
    scope: GOOGLE_SCOPE,
    token_type: "Bearer",
    ...over,
  });
}

/** An OAuth error answer in the standard's form (RFC 6749, section 5.2). */
export function oauthError(error: string, status = 400): Response {
  return jsonAnswer({ error, error_description: "Described by the provider." }, status);
}

/** Google's answer to a revoke that worked: a 200. */
export const revoked = (): Response => new Response(null, { status: 200 });

/** A redirect, as a provider (or something in front of it) might answer. */
export const redirectTo = (location: string, status = 302): Response =>
  new Response(null, { status, headers: { Location: location } });

/** A provider that never answers: the call ends only when the caller gives up on it. */
export const neverAnswers = (): ProviderAnswer => (call) =>
  new Promise<Response>((_resolve, reject) => {
    call.signal?.addEventListener("abort", () => reject(call.signal?.reason));
  });
