export interface Env {
  ASSETS: Fetcher;
  TOKENS: KVNamespace;

  // Plain vars (wrangler.jsonc)
  TIME_ZONE: string;
  ACCESS_TEAM_DOMAIN: string; // e.g. "yourteam.cloudflareaccess.com"
  USE_FAKES: string; // "true" only in local dev/tests

  // Secrets
  ACCESS_AUD?: string;
  ALLOWED_EMAIL?: string;
  TOKEN_ENC_KEY?: string; // base64, 32 bytes

  // Local dev only: lets requests from localhost skip Access. Ignored on any other host.
  DEV_SKIP_ACCESS?: string;

  // Non-secret personal config, set as uncommitted vars or secrets
  TICKTICK_TODAY_PROJECT_ID?: string;
  TICKTICK_NEXT_PROJECT_ID?: string;
  TICKTICK_HABIT_IDS?: string; // comma-separated
  MINIMUM_TASK_TEXT?: string;
}
