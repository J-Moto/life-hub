# Deploy checklist

Manual checks, run by the owner after each deploy. There is no automated live test: with Cloudflare Access in front, one would need its own credential (`docs/design/v1.md`, section I).

Each build step adds its own checks below. Run every section up to the step that was just deployed, then add a row to the record at the bottom.

`<hub>` stands for the hub's workers.dev address. Don't write the real address, the email or any ID in this file: the repo is public.

## Before the first deploy (step 1a)

The deployed hub must never be reachable without Access (F1). Use one of these two orders:

- **Access first.** Create the Access application for the workers.dev address, set `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ALLOWED_EMAIL` and `TOKEN_ENC_KEY` on the Worker, then deploy.
- **Fail-closed order,** if Cloudflare needs the address to exist before Access can be attached. Deploy with the Access settings unset, check that the Worker refuses everything (check 1 below), attach Access, and only then enter the settings.

At the first deploy Wrangler may create the KV namespace and write its ID into `wrangler.jsonc`. The ID is not a secret and may be committed (`CLAUDE.md`, security rules). Nothing else that the deploy writes into that file may be.

## Step 1a. Foundation

| # | Check | How | Expected |
|---|---|---|---|
| 1 | The Worker refuses a request without Access | Only in the fail-closed order, before Access is attached: `curl -i https://<hub>/` and `curl -i -X POST https://<hub>/api/restart` | `401` for both, and no page content |
| 2 | The address shows the GitHub sign-in | Open `https://<hub>/` in a private browser window | The Cloudflare Access page, offering GitHub only. No part of the hub's page shows first. |
| 3 | A request without a sign-in gets nothing from the hub | `curl -i https://<hub>/api/today` | A redirect to the Access sign-in, or `401`. Never `200`. |
| 4 | There is no preview address | In the Cloudflare dashboard, open the Worker's settings for its addresses | Preview URLs are switched off. Only the workers.dev address is listed. |
| 5 | There is no cron | In the Cloudflare dashboard, open the Worker's trigger settings | No Cron Trigger is listed |
| 6 | Signed in, nothing reaches TickTick | Sign in, open `https://<hub>/api/today`, then press Restart on the page | `/api/today` answers `not_connected` (TickTick isn't connected until step 4). Restart reports a failure, and nothing changes in TickTick. |
| 7 | From the page, complete and add send and are not refused with 403 | Signed in, with the browser's developer tools open on the Network tab: add a task from the box. From step 4 on, when the Today list shows, tick a task too. | The hub answers the POST itself: `not_enabled` (503) until that route's own step (5 for complete, 6 for add), success after it. Never 403 `cross_site`, which would mean the browser didn't send the page's `Origin`. |

Checks 2 and 4 are the two that step 1a's "done when" names. Check 7 is run again after steps 5 and 6.

## Record

One row per deploy.

| Date | Step deployed | Checks run | Result | Notes |
|---|---|---|---|---|
| | | | | |
| 2026-11-16 | 1a | 1–7 | All passed | Fail-closed order; Access enabled from the Worker's Access tab; GitHub only (instant auth) |
