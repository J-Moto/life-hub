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
        },
      },
    }),
  ],
});
