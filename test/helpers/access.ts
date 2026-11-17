import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { verifyAccess, type VerifiedAccess } from "../../src/auth/access";
import type { Env } from "../../src/env";

const TEAM = "test-team.cloudflareaccess.com";
const AUD = "test-aud";
const EMAIL = "me@example.com";

/**
 * A passed Access check for the owner, made the only way one can be made: by `verifyAccess`,
 * on a request whose token is signed with a key created here. It is what src/index.ts hands
 * the router once the owner's token has been verified.
 *
 * `email` is for the tests that need a second identity: a hub whose allowed email is that one.
 */
export async function ownerAccess(email: string = EMAIL): Promise<VerifiedAccess> {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" }] });
  const jwt = await new SignJWT({ email })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(`https://${TEAM}`)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);

  const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ALLOWED_EMAIL: email } as unknown as Env;
  const request = new Request("https://hub.example.com/", { headers: { "Cf-Access-Jwt-Assertion": jwt } });
  const result = await verifyAccess(request, env, keys);
  if (!result.ok) throw new Error(`test setup: the Access check did not pass (${result.reason})`);
  return result;
}
