import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  TokenStore,
  decryptToken,
  deleteTokenRecord,
  encryptToken,
  importKey,
  tokenRecordExists,
  type StoredToken,
} from "../src/crypto/tokens";

function randomKeyB64(): string {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...raw));
}

const sample = { accessToken: "access-abc", refreshToken: "refresh-xyz", expiresAt: 123, connectedAt: 1000 };

describe("token encryption", () => {
  it("round-trips", async () => {
    const key = await importKey(randomKeyB64());
    const env1 = await encryptToken(key, "google", sample);
    expect(env1.startsWith("v1.")).toBe(true);
    expect(env1).not.toContain("access-abc");
    expect(await decryptToken(key, "google", env1)).toEqual(sample);
  });

  it("uses a fresh IV every time", async () => {
    const key = await importKey(randomKeyB64());
    const a = await encryptToken(key, "google", sample);
    const b = await encryptToken(key, "google", sample);
    expect(a).not.toEqual(b);
  });

  it("fails with the wrong key", async () => {
    const a = await importKey(randomKeyB64());
    const b = await importKey(randomKeyB64());
    const e = await encryptToken(a, "google", sample);
    await expect(decryptToken(b, "google", e)).rejects.toThrow("token_decrypt_failed");
  });

  it("fails if a token is moved to the other provider's slot", async () => {
    const key = await importKey(randomKeyB64());
    const e = await encryptToken(key, "ticktick", sample);
    await expect(decryptToken(key, "google", e)).rejects.toThrow("token_decrypt_failed");
  });

  it("fails if the ciphertext is tampered with", async () => {
    const key = await importKey(randomKeyB64());
    const e = await encryptToken(key, "google", sample);
    const [v, iv, ct] = e.split(".");
    const flipped = (ct![0] === "A" ? "B" : "A") + ct!.slice(1);
    await expect(decryptToken(key, "google", `${v}.${iv}.${flipped}`)).rejects.toThrow();
  });

  it("rejects malformed envelopes", async () => {
    const key = await importKey(randomKeyB64());
    await expect(decryptToken(key, "google", "v2.a.b")).rejects.toThrow("token_envelope_invalid");
    await expect(decryptToken(key, "google", "nonsense")).rejects.toThrow("token_envelope_invalid");
    await expect(decryptToken(key, "google", "v1.!!.??")).rejects.toThrow();
  });

  it("rejects missing or wrong-size keys", async () => {
    await expect(importKey(undefined)).rejects.toThrow("token_key_missing");
    await expect(importKey(btoa("short"))).rejects.toThrow("token_key_invalid");
    await expect(importKey("not base64 !!")).rejects.toThrow("token_key_invalid");
  });

  it("refuses a record that does not say when it was connected", async () => {
    // Without `connectedAt` one connection can't be told from the next (G5).
    const key = await importKey(randomKeyB64());
    const { connectedAt: _, ...undated } = sample;
    const e = await encryptToken(key, "google", undated as StoredToken);
    await expect(decryptToken(key, "google", e)).rejects.toThrow("token_envelope_invalid");
  });
});

describe("TokenStore", () => {
  beforeEach(async () => {
    await env.TOKENS.delete("oauth:google");
    await env.TOKENS.delete("oauth:ticktick");
  });

  it("tells a missing record from one that can't be decrypted", async () => {
    const store = new TokenStore(env.TOKENS, await importKey(randomKeyB64()));
    expect(await store.read("google")).toEqual({ status: "none" });

    await env.TOKENS.put("oauth:google", "v1.garbage.garbage");
    expect(await store.read("google")).toEqual({ status: "unreadable" });

    // Written under another key, as after a key change (G2).
    await new TokenStore(env.TOKENS, await importKey(randomKeyB64())).put("google", sample);
    expect(await store.read("google")).toEqual({ status: "unreadable" });

    await store.put("google", sample);
    expect(await store.read("google")).toEqual({ status: "ok", token: sample });
  });

  it("deletes the record when it is still the same connection", async () => {
    const store = new TokenStore(env.TOKENS, await importKey(randomKeyB64()));
    await store.put("google", sample);
    expect(await store.deleteIfSameConnection("google", 1000)).toBeNull();
    expect(await env.TOKENS.get("oauth:google")).toBeNull();
  });

  it("leaves a newer connection in place and hands it back", async () => {
    const store = new TokenStore(env.TOKENS, await importKey(randomKeyB64()));
    const newer = { ...sample, accessToken: "access-newer", connectedAt: 2000 };
    await store.put("google", newer);
    expect(await store.deleteIfSameConnection("google", 1000)).toEqual(newer);
    expect(await store.get("google")).toEqual(newer);
  });

  it("has nothing to delete or hand back when no record is stored", async () => {
    const store = new TokenStore(env.TOKENS, await importKey(randomKeyB64()));
    expect(await store.deleteIfSameConnection("google", 1000)).toBeNull();
  });

  it("finds and deletes a record without the key", async () => {
    // Disconnect has to remove a record even when the key is missing or has changed (G1).
    expect(await tokenRecordExists(env.TOKENS, "google")).toBe(false);
    await env.TOKENS.put("oauth:google", "v1.garbage.garbage");
    await env.TOKENS.put("oauth:ticktick", "v1.garbage.garbage");
    expect(await tokenRecordExists(env.TOKENS, "google")).toBe(true);

    await deleteTokenRecord(env.TOKENS, "google");
    expect(await tokenRecordExists(env.TOKENS, "google")).toBe(false);
    expect(await tokenRecordExists(env.TOKENS, "ticktick")).toBe(true);
  });

  it("stores only ciphertext in KV and reads it back", async () => {
    const key = await importKey(randomKeyB64());
    const store = new TokenStore(env.TOKENS, key);
    await store.put("ticktick", sample);
    const raw = await env.TOKENS.get("oauth:ticktick");
    expect(raw).not.toBeNull();
    expect(raw).not.toContain("access-abc");
    expect(await store.get("ticktick")).toEqual(sample);
  });

  it("returns null for a missing or undecryptable token", async () => {
    const key = await importKey(randomKeyB64());
    const store = new TokenStore(env.TOKENS, key);
    expect(await store.get("google")).toBeNull();
    await env.TOKENS.put("oauth:google", "v1.garbage.garbage");
    expect(await store.get("google")).toBeNull();
  });
});
