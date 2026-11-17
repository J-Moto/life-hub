/**
 * Google's side of the connection: the sign-in address, the refresh call, and the rule for
 * handing out an access token (docs/design/v1.md, G4, G5).
 *
 * Addresses and parameters are from Google's "Using OAuth 2.0 for Web Server Applications"
 * page (read 2026-11-16). That page does not mention PKCE for this flow; the challenge is
 * sent anyway and the login does not rely on it (G6b).
 */

import type { Env } from "../env";
import { TokenStore, importKey, type StoredToken } from "../crypto/tokens";
import { NotConfiguredError, NotConnectedError } from "../sources/types";
import { ProviderError, providerFetch } from "./provider-fetch";

/** The one scope the hub asks for (G4). */
export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const FORM_HEADERS = { "Content-Type": "application/x-www-form-urlencoded" };
/** An access token with less than this left counts as expired (G5). */
const EXPIRY_MARGIN_MS = 60_000;

export interface GoogleClient {
  clientId: string;
  clientSecret: string;
}

/** The client settings, or null when either is missing. */
export function googleClient(env: Env): GoogleClient | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export interface SignInRequest {
  clientId: string;
  /** The fixed `<hub>/oauth/google/callback`. */
  redirectUri: string;
  state: string;
  /** The PKCE S256 challenge. */
  challenge: string;
}

/**
 * Where the owner's browser goes to sign in. Offline access with consent, so a refresh
 * token comes back. `include_granted_scopes` is never sent: the grant is this one scope.
 */
export function googleSignInUrl(request: SignInRequest): string {
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state: request.state,
    code_challenge: request.challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.href;
}

/** What a token answer from Google holds, in the hub's terms. */
export interface TokenGrant {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // epoch ms. Absent when Google gave no lifetime: no length is assumed.
  scope?: string;
}

function readGrant(json: unknown, now: number): TokenGrant | null {
  if (!json || typeof json !== "object") return null;
  const t = json as Record<string, unknown>;
  if (typeof t.access_token !== "string" || !t.access_token) return null;
  return {
    accessToken: t.access_token,
    refreshToken: typeof t.refresh_token === "string" && t.refresh_token ? t.refresh_token : undefined,
    expiresAt: typeof t.expires_in === "number" && t.expires_in > 0 ? now + t.expires_in * 1000 : undefined,
    scope: typeof t.scope === "string" ? t.scope : undefined,
  };
}

const errorCode = (json: unknown): unknown =>
  json && typeof json === "object" ? (json as Record<string, unknown>).error : undefined;

/**
 * True when the scope a provider returned is exactly the one requested, compared as sets of
 * space-separated, case-sensitive values. A missing or empty scope is not a match.
 */
export function sameScopes(returned: string | undefined, requested: string): boolean {
  const values = (scope: string): Set<string> => new Set(scope.split(" ").filter(Boolean));
  const got = values(returned ?? "");
  const wanted = values(requested);
  return got.size > 0 && got.size === wanted.size && [...wanted].every((scope) => got.has(scope));
}

export interface CodeExchange {
  code: string;
  /** The PKCE verifier whose challenge went out with the sign-in address. */
  verifier: string;
  /** The same fixed address the sign-in address named. */
  redirectUri: string;
}

/** Exchanges the callback's code for tokens. Anything but a token answer throws. */
export async function exchangeGoogleCode(client: GoogleClient, exchange: CodeExchange, now: number): Promise<TokenGrant> {
  const { status, json } = await providerFetch("google.token", TOKEN_URL, {
    method: "POST",
    headers: FORM_HEADERS,
    body: new URLSearchParams({
      code: exchange.code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: exchange.redirectUri,
      grant_type: "authorization_code",
      code_verifier: exchange.verifier,
    }).toString(),
  });
  const grant = status === 200 ? readGrant(json, now) : null;
  if (!grant) throw new ProviderError("refused");
  return grant;
}

/**
 * Asks Google to revoke a token. Revoking a refresh token, or an access token that has one,
 * ends the whole grant. The token goes in the form body, never in the address. Returns
 * whether Google said it was done; never throws.
 */
export async function revokeGoogleToken(token: string): Promise<boolean> {
  try {
    const { status } = await providerFetch("google.revoke", REVOKE_URL, {
      method: "POST",
      headers: FORM_HEADERS,
      body: new URLSearchParams({ token }).toString(),
    });
    return status === 200;
  } catch {
    return false;
  }
}

/**
 * Asks Google for a new access token. `invalid_grant` means the refresh token no longer
 * works (revoked or expired). Every other failure throws and says nothing about the token.
 */
async function refreshGoogleToken(
  client: GoogleClient,
  refreshToken: string,
  now: number,
): Promise<TokenGrant | "invalid_grant"> {
  const { status, json } = await providerFetch("google.refresh", TOKEN_URL, {
    method: "POST",
    headers: FORM_HEADERS,
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });
  if (status === 200) {
    const grant = readGrant(json, now);
    if (grant) return grant;
  } else if (status === 400 && errorCode(json) === "invalid_grant") {
    return "invalid_grant";
  }
  throw new ProviderError("refused");
}

const isFresh = (token: StoredToken, now: number): boolean =>
  token.expiresAt !== undefined && token.expiresAt - now >= EXPIRY_MARGIN_MS;

/**
 * Refreshes `token` and saves the result. Two requests may do this at once: each gets a
 * valid access token and the last one saved wins (G6c).
 *
 * On `invalid_grant` the record is re-read once. If it is still this connection, it is
 * deleted and the answer is `not_connected`. If a newer connection has replaced it, that
 * one is tried once (`mayRetry`) and never deleted.
 */
async function refreshAndSave(
  store: TokenStore,
  client: GoogleClient,
  token: StoredToken,
  now: number,
  mayRetry: boolean,
): Promise<string> {
  // Google records always have a refresh token (the callback stores nothing without one).
  if (!token.refreshToken) throw new NotConnectedError("google");

  const grant = await refreshGoogleToken(client, token.refreshToken, now);
  if (grant !== "invalid_grant") {
    await store.put("google", {
      ...token,
      accessToken: grant.accessToken,
      expiresAt: grant.expiresAt,
      // Google's docs show no new refresh token here. If one comes, it is the one to keep.
      refreshToken: grant.refreshToken ?? token.refreshToken,
      scope: grant.scope ?? token.scope,
    });
    return grant.accessToken;
  }

  // A newer connection that is refused as well: a plain failure. The next request starts from it.
  if (!mayRetry) throw new ProviderError("refused");
  const newer = await store.deleteIfSameConnection("google", token.connectedAt);
  if (!newer) throw new NotConnectedError("google");
  if (isFresh(newer, now)) return newer.accessToken;
  return refreshAndSave(store, client, newer, now, false);
}

/**
 * A Google access token that is good for at least another minute, refreshed first if need be.
 * Throws `NotConfiguredError` (the key or a client setting is missing or bad; Google is not
 * called), `NotConnectedError` (nothing usable is stored, or Google refused this connection),
 * or `ProviderError` (the call failed; the record is left alone).
 */
export async function googleAccessToken(env: Env, now: number = Date.now()): Promise<string> {
  const client = googleClient(env);
  if (!client) throw new NotConfiguredError();
  let key: CryptoKey;
  try {
    key = await importKey(env.TOKEN_ENC_KEY);
  } catch {
    throw new NotConfiguredError();
  }
  const store = new TokenStore(env.TOKENS, key);

  const token = await store.get("google");
  if (!token) throw new NotConnectedError("google");
  if (isFresh(token, now)) return token.accessToken;
  return refreshAndSave(store, client, token, now, true);
}
