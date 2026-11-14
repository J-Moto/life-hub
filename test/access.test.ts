import { describe, expect, it, beforeAll } from "vitest";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet, type JWTVerifyGetKey } from "jose";
import { verifyAccess } from "../src/auth/access";
import type { Env } from "../src/env";

const TEAM = "test-team.cloudflareaccess.com";
const AUD = "test-aud";

const baseEnv = {
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUD,
  ALLOWED_EMAIL: "Me@Example.com",
  TIME_ZONE: "America/Indiana/Indianapolis",
  USE_FAKES: "false",
} as unknown as Env;

let keys: JWTVerifyGetKey;
let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;

beforeAll(async () => {
  const kp = await generateKeyPair("RS256");
  const other = await generateKeyPair("RS256");
  privateKey = kp.privateKey;
  otherPrivateKey = other.privateKey;
  const jwk = { ...(await exportJWK(kp.publicKey)), kid: "k1", alg: "RS256" };
  keys = createLocalJWKSet({ keys: [jwk] });
});

async function token(opts: { email?: string; aud?: string; iss?: string; exp?: string; key?: CryptoKey } = {}) {
  return new SignJWT({ email: opts.email ?? "me@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opts.iss ?? `https://${TEAM}`)
    .setAudience(opts.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "5m")
    .sign(opts.key ?? privateKey);
}

function req(jwt?: string, host = "hub.example.com") {
  const headers = new Headers();
  if (jwt) headers.set("Cf-Access-Jwt-Assertion", jwt);
  return new Request(`https://${host}/api/today`, { headers });
}

describe("verifyAccess", () => {
  it("accepts a valid token for the allowed email (case-insensitive)", async () => {
    const r = await verifyAccess(req(await token()), baseEnv, keys);
    expect(r).toEqual({ ok: true, email: "me@example.com", devBypass: false });
  });

  it("rejects a missing token", async () => {
    expect(await verifyAccess(req(), baseEnv, keys)).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects another email", async () => {
    const r = await verifyAccess(req(await token({ email: "someone@else.com" })), baseEnv, keys);
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it("rejects the wrong audience", async () => {
    expect(await verifyAccess(req(await token({ aud: "other" })), baseEnv, keys)).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects the wrong issuer", async () => {
    const r = await verifyAccess(req(await token({ iss: "https://evil.cloudflareaccess.com" })), baseEnv, keys);
    expect(r).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects an expired token", async () => {
    const r = await verifyAccess(req(await token({ exp: "-10m" })), baseEnv, keys);
    expect(r).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects a token signed by a different key", async () => {
    const r = await verifyAccess(req(await token({ key: otherPrivateKey })), baseEnv, keys);
    expect(r).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects an unsigned (alg none) token", async () => {
    const enc = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    const now = Math.floor(Date.now() / 1000);
    const none = `${enc({ alg: "none" })}.${enc({ email: "me@example.com", aud: AUD, iss: `https://${TEAM}`, exp: now + 300 })}.`;
    expect(await verifyAccess(req(none), baseEnv, keys)).toMatchObject({ ok: false, status: 401 });
  });

  it("fails closed when config is missing", async () => {
    const env = { ...baseEnv, ACCESS_AUD: undefined } as Env;
    expect(await verifyAccess(req(await token()), env, keys)).toMatchObject({ ok: false, status: 500 });
  });

  it("fails closed on a malformed team domain", async () => {
    const env = { ...baseEnv, ACCESS_TEAM_DOMAIN: "evil.com/x" } as Env;
    expect(await verifyAccess(req(await token()), env, keys)).toMatchObject({ ok: false, status: 500 });
  });

  describe("dev bypass", () => {
    const devEnv = { ...baseEnv, DEV_SKIP_ACCESS: "true", USE_FAKES: "true", ACCESS_AUD: undefined } as Env;
    const local = (ip: string | null, host = "localhost:8787") => {
      const headers = new Headers();
      if (ip) headers.set("CF-Connecting-IP", ip);
      return new Request(`http://${host}/api/today`, { headers });
    };

    it("works for a loopback client on localhost", async () => {
      expect(await verifyAccess(local("127.0.0.1"), devEnv, keys)).toMatchObject({ ok: true, devBypass: true });
    });
    it("refuses a spoofed Host from the LAN", async () => {
      expect((await verifyAccess(local("192.168.1.50"), devEnv, keys)).ok).toBe(false);
      expect((await verifyAccess(local(null), devEnv, keys)).ok).toBe(false);
    });
    it("refuses when Access is configured or fakes are off", async () => {
      expect((await verifyAccess(local("127.0.0.1"), { ...devEnv, ACCESS_AUD: "x" } as Env, keys)).ok).toBe(false);
      expect((await verifyAccess(local("127.0.0.1"), { ...devEnv, USE_FAKES: "false" } as Env, keys)).ok).toBe(false);
    });
    it("refuses non-local hosts", async () => {
      expect((await verifyAccess(local("127.0.0.1", "hub.example.com"), devEnv, keys)).ok).toBe(false);
    });
  });
});
