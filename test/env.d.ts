// Tell TypeScript which bindings tests can see through `env` from "cloudflare:workers".
declare namespace Cloudflare {
  interface Env {
    TOKENS: KVNamespace;
    ASSETS: Fetcher;
  }
}
