import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // Test-only values. Not real secrets.
        bindings: {
          ACCESS_TEAM_DOMAIN: "test-team.cloudflareaccess.com",
          ACCESS_AUD: "test-aud",
          ALLOWED_EMAIL: "me@example.com",
          USE_FAKES: "true",
          // The login settings (step 2). The key is 32 bytes of "A": valid, and plainly not a real one.
          TOKEN_ENC_KEY: "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=",
          GOOGLE_CLIENT_ID: "test-google-client-id",
          GOOGLE_CLIENT_SECRET: "test-google-client-secret",
          HUB_ORIGIN: "https://hub.example.com",
        },
      },
    }),
  ],
});
