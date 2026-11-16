export interface Env {
  ASSETS: Fetcher;
  TOKENS: KVNamespace;

  // --- Committed in wrangler.jsonc (the only two) ---
  TIME_ZONE: string;
  USE_FAKES: string; // "true" only in local dev/tests

  // --- Set on Cloudflare as Worker vars or secrets, never in the repo. ---
  // Any of these can be missing, so all are optional. Names and forms: docs/design/v1.md, section 3.

  // Access. If any of the three is missing, every request is rejected.
  ACCESS_TEAM_DOMAIN?: string; // "<team>.cloudflareaccess.com"
  ACCESS_AUD?: string;
  ALLOWED_EMAIL?: string;

  // Secrets
  TOKEN_ENC_KEY?: string; // base64, 32 bytes
  TICKTICK_CLIENT_ID?: string;
  TICKTICK_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;

  // Personal settings
  HUB_ORIGIN?: string; // the hub's own address, for the fixed redirect_uri
  TICKTICK_TODAY_PROJECT_ID?: string;
  TICKTICK_NEXT_PROJECT_ID?: string;
  MINIMUM_TASK_TEXT?: string;
  HABITS?: string; // JSON text: [{"id":"…","name":"…"}]
  CALENDAR_IDS?: string; // JSON text: ["…"]
  WORK_BLOCK_TITLE?: string;
  TICKTICK_HABIT_IDS?: string; // comma-separated. Still read today; HABITS replaces it in step 7.

  // --- Local dev only (.dev.vars) ---
  // Lets requests from localhost skip Access. Ignored on any other host.
  DEV_SKIP_ACCESS?: string;
}
