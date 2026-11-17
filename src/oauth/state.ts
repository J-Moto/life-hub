/**
 * The login state for one OAuth connection attempt (docs/design/v1.md, G6b).
 *
 * Connect issues a `state` and stores a record under it in KV for 10 minutes. The record
 * ties the attempt to three things the callback must present again: the provider it was
 * made for, a cookie only this browser holds, and the Access email of whoever started it.
 * It also holds the PKCE verifier. It holds hashes of the cookie's value and of the email,
 * never the values themselves.
 *
 * A `state` is single use. Any callback that presents one uses it up, whether or not the
 * rest of its checks pass. KV can't read and delete in one step, so two callbacks within
 * a moment could both read it (accepted, G6b).
 */

import type { Provider } from "../crypto/tokens";

const TTL_SECONDS = 600;
const MAX_AGE_MS = TTL_SECONDS * 1000;
const COOKIE_NAME = "__Host-hub_login";
// `__Host-` needs Secure, Path=/ and no Domain. Lax, so the provider's redirect back carries it.
const COOKIE_ATTRIBUTES = "Path=/; Secure; HttpOnly; SameSite=Lax";
/** 32 random bytes in base64url: the form of a `state`. */
const STATE_SHAPE = /^[A-Za-z0-9_-]{43}$/;

interface LoginRecord {
  provider: Provider;
  verifier: string;
  emailHash: string;
  cookieHash: string;
  createdAt: number; // epoch ms
}

export interface IssuedLogin {
  /** Goes to the provider and comes back on the callback's address. */
  state: string;
  /** The PKCE S256 challenge for the stored verifier. */
  challenge: string;
  /** A `Set-Cookie` value for the answer to connect. */
  cookie: string;
}

/** What a callback presents. */
export interface LoginAttempt {
  state: string;
  /** The request's `Cookie` header. */
  cookieHeader: string | null;
  /** The provider named in the callback's path. */
  provider: Provider;
  /** The verified Access email of the request. */
  email: string;
  now: number;
}

const keyName = (state: string): string => `login:${state}`;

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 256 random bits, as 43 base64url characters. */
export function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256(text: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

/** Compares two strings without stopping at the first difference. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readCookie(header: string | null): string | null {
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === COOKIE_NAME) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

function parseRecord(raw: string): LoginRecord | null {
  try {
    const r = JSON.parse(raw) as Partial<LoginRecord> | null;
    const ok =
      r !== null &&
      typeof r === "object" &&
      (r.provider === "google" || r.provider === "ticktick") &&
      typeof r.verifier === "string" &&
      typeof r.emailHash === "string" &&
      typeof r.cookieHash === "string" &&
      typeof r.createdAt === "number";
    return ok ? (r as LoginRecord) : null;
  } catch {
    return null;
  }
}

/** Starts a connection attempt: stores the record and hands back what connect sends out. */
export async function issueLoginState(
  kv: KVNamespace,
  provider: Provider,
  email: string,
  now: number,
): Promise<IssuedLogin> {
  const state = randomToken();
  const verifier = randomToken();
  const cookieValue = randomToken();
  const record: LoginRecord = {
    provider,
    verifier,
    emailHash: await sha256(email),
    cookieHash: await sha256(cookieValue),
    createdAt: now,
  };
  await kv.put(keyName(state), JSON.stringify(record), { expirationTtl: TTL_SECONDS });
  return {
    state,
    challenge: await sha256(verifier),
    cookie: `${COOKIE_NAME}=${cookieValue}; ${COOKIE_ATTRIBUTES}; Max-Age=${TTL_SECONDS}`,
  };
}

/**
 * Uses a `state` up and checks the attempt against its record. Returns the PKCE verifier
 * when every check passes, or null. The log gets one fixed word for the reason.
 */
export async function consumeLoginState(kv: KVNamespace, attempt: LoginAttempt): Promise<{ verifier: string } | null> {
  const refuse = (reason: string): null => {
    console.warn("login_state_refused", reason);
    return null;
  };

  if (!STATE_SHAPE.test(attempt.state)) return refuse("shape");
  const raw = await kv.get(keyName(attempt.state));
  if (raw === null) return refuse("unknown");
  // Consume first: nothing below can leave the state usable again.
  await kv.delete(keyName(attempt.state));

  const record = parseRecord(raw);
  if (!record) return refuse("record");
  if (record.provider !== attempt.provider) return refuse("provider");
  // The creation time is checked as well as relying on KV's TTL.
  if (attempt.now - record.createdAt > MAX_AGE_MS) return refuse("age");
  const cookieValue = readCookie(attempt.cookieHeader);
  if (!cookieValue || !sameText(await sha256(cookieValue), record.cookieHash)) return refuse("cookie");
  if (!sameText(await sha256(attempt.email), record.emailHash)) return refuse("email");
  return { verifier: record.verifier };
}

/** A `Set-Cookie` value that removes the login cookie. */
export function clearLoginCookie(): string {
  return `${COOKIE_NAME}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;
}
