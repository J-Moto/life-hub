// Tell TypeScript which bindings tests can see through `env` from "cloudflare:workers".
declare namespace Cloudflare {
  interface Env {
    TOKENS: KVNamespace;
    ASSETS: Fetcher;
    // Test values from vitest.config.ts.
    TOKEN_ENC_KEY: string;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    HUB_ORIGIN: string;
  }
}
