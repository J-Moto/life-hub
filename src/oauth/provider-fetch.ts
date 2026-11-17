/**
 * The one way the Worker calls a provider: token, refresh, revoke and data calls alike
 * (docs/design/v1.md, section I).
 *
 * - A redirect is never followed, so a redirected token request can't carry the client
 *   secret or a token to another address. A redirect is a failure.
 * - The call is given up on after 10 seconds, body included. A timeout is a failure.
 * - It logs a fixed label, the status and the timing, and nothing else (G6).
 */

export const PROVIDER_TIMEOUT_MS = 10_000;

/** Why a provider call produced nothing usable. */
export type ProviderFailure = "redirect" | "timeout" | "network";

/** Carries a fixed word only: never an address, a body or a token. */
export class ProviderError extends Error {
  constructor(public readonly kind: ProviderFailure) {
    super(`provider_${kind}`);
    this.name = "ProviderError";
  }
}

/** What a provider answered: its status, and its body as JSON (null when it isn't JSON). */
export interface ProviderAnswer {
  status: number;
  json: unknown;
}

/**
 * Sends one request and reads the answer. Any status that is not a redirect comes back to
 * the caller, who decides what it means. `label` names the call in the log, for example
 * "google.token"; it is never the address.
 */
export async function providerFetch(label: string, url: string, init: RequestInit): Promise<ProviderAnswer> {
  const started = Date.now();
  const elapsed = (): string => `${Date.now() - started}ms`;
  const gaveUp = new AbortController();
  const timer = setTimeout(() => gaveUp.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, redirect: "manual", signal: gaveUp.signal });
    if (res.status >= 300 && res.status < 400) {
      console.warn("provider_call", label, res.status, elapsed());
      throw new ProviderError("redirect");
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      // Not JSON: the status alone is the answer.
    }
    console.log("provider_call", label, res.status, elapsed());
    return { status: res.status, json };
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    // The thrown error is not logged or passed on: its message can hold an address.
    const kind: ProviderFailure = gaveUp.signal.aborted ? "timeout" : "network";
    console.warn("provider_call", label, kind, elapsed());
    throw new ProviderError(kind);
  } finally {
    clearTimeout(timer);
  }
}
