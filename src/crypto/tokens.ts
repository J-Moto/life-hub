/**
 * Encrypts OAuth tokens before they touch KV (AES-256-GCM via WebCrypto).
 *
 * Envelope: "v1.<iv>.<ciphertext>" (base64url). The provider name is bound in as
 * additional authenticated data, so a TickTick token can't be swapped into the
 * Google slot without decryption failing.
 *
 * Rotating the key: re-run /setup after setting a new TOKEN_ENC_KEY. Old tokens
 * then fail to decrypt and the dashboard shows "Reconnect".
 */

export type Provider = "ticktick" | "google";

export interface StoredToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // epoch ms
  scope?: string;
}

const VERSION = "v1";
const IV_BYTES = 12;
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("bad_encoding");
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function aad(provider: Provider): Uint8Array {
  return enc.encode(`life-hub:token:${provider}:${VERSION}`);
}

/** Imports the base64 key from the TOKEN_ENC_KEY secret. Must be exactly 32 bytes. */
export async function importKey(base64Key: string | undefined): Promise<CryptoKey> {
  if (!base64Key) throw new Error("token_key_missing");
  let raw: Uint8Array;
  try {
    raw = Uint8Array.from(atob(base64Key.trim()), (c) => c.charCodeAt(0));
  } catch {
    throw new Error("token_key_invalid");
  }
  if (raw.length !== 32) throw new Error("token_key_invalid");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptToken(key: CryptoKey, provider: Provider, token: StoredToken): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad(provider) },
    key,
    enc.encode(JSON.stringify(token)),
  );
  return `${VERSION}.${b64urlEncode(iv)}.${b64urlEncode(new Uint8Array(ct))}`;
}

export async function decryptToken(key: CryptoKey, provider: Provider, envelope: string): Promise<StoredToken> {
  const parts = envelope.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) throw new Error("token_envelope_invalid");
  const iv = b64urlDecode(parts[1]!);
  const ct = b64urlDecode(parts[2]!);
  if (iv.length !== IV_BYTES) throw new Error("token_envelope_invalid");
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad(provider) }, key, ct);
  } catch {
    throw new Error("token_decrypt_failed");
  }
  const parsed = JSON.parse(dec.decode(plain)) as StoredToken;
  if (typeof parsed.accessToken !== "string") throw new Error("token_envelope_invalid");
  return parsed;
}

/** Thin KV wrapper. Only ciphertext ever reaches KV. */
export class TokenStore {
  constructor(private kv: KVNamespace, private key: CryptoKey) {}

  private keyName(provider: Provider): string {
    return `oauth:${provider}`;
  }

  async put(provider: Provider, token: StoredToken): Promise<void> {
    await this.kv.put(this.keyName(provider), await encryptToken(this.key, provider, token));
  }

  /** Returns null if nothing is stored or it can't be decrypted (treated as "reconnect needed"). */
  async get(provider: Provider): Promise<StoredToken | null> {
    const envelope = await this.kv.get(this.keyName(provider));
    if (!envelope) return null;
    try {
      return await decryptToken(this.key, provider, envelope);
    } catch {
      return null;
    }
  }

  async delete(provider: Provider): Promise<void> {
    await this.kv.delete(this.keyName(provider));
  }
}
