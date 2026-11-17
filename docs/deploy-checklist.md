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
| 3 | A request without a sign-in gets nothing from the hub | `curl -i https://<hub>/api/tasks` | A redirect to the Access sign-in, or `401`. Never `200`. |
| 4 | There is no preview address | In the Cloudflare dashboard, open the Worker's settings for its addresses | Preview URLs are switched off. Only the workers.dev address is listed. |
| 5 | There is no cron | In the Cloudflare dashboard, open the Worker's trigger settings | No Cron Trigger is listed |
| 6 | Signed in, nothing reaches TickTick | Sign in, open `https://<hub>/api/tasks`, then press Restart on the page | `/api/tasks` answers `not_connected` (TickTick isn't connected until step 4). Restart reports a failure, and nothing changes in TickTick. |
| 7 | From the page, complete and add send and are not refused with 403 | Signed in, with the browser's developer tools open on the Network tab: add a task from the box. From step 4 on, when the Today list shows, tick a task too. | The hub answers the POST itself: `not_enabled` (503) until that route's own step (5 for complete, 6 for add), success after it. Never 403 `cross_site`, which would mean the browser didn't send the page's `Origin`. |

Checks 2 and 4 are the two that step 1a's "done when" names. Check 7 is run again after steps 5 and 6.

## Step 2. Google connection

Before these: the Google OAuth app exists (redirect address `https://<hub>/oauth/google/callback`, scope `calendar.events.readonly`, status "In production"), and `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `HUB_ORIGIN` are set on the Worker. `HUB_ORIGIN` is `https://<hub>` exactly: no path and no slash at the end.

| # | Check | How | Expected |
|---|---|---|---|
| 8 | The setup page shows both services | Signed in, open `https://<hub>/setup` | "not connected" for Google and for TickTick. Google has a Connect button; TickTick has none until step 4. |
| 9 | A missing setting is caught before Google | Only if a setting above is not entered yet: press Connect | "Not set up yet." The browser does not leave the hub. |
| 10 | Connect works | Press Connect, pass the "Google hasn't verified this app" screen, approve | Back on `/setup` with "Connected.", the address bar shows `/setup` with nothing after it, and Google shows "connected" with only a Disconnect button |
| 11 | The grant is the narrow one | Open the Google account's page for third-party apps with access | The hub is listed with access to view calendar events only |
| 12 | The PKCE test (once) | Disconnect. Set `PKCE_TEST_WRONG_VERIFIER` to `true` on the Worker, press Connect and approve, note what `/setup` says, then **unset the var** and connect again | Record the result in v1.md ("To confirm", and G6b): "The connection didn't complete" means Google rejects a wrong verifier; "Connected." means it does not check. Either is acceptable (G6b). If it connected, press Disconnect before unsetting the var, so the test's grant is revoked. |
| 13 | What the logs hold | In the Cloudflare dashboard, open the Worker's logs for the callback request of check 10 | Record in v1.md whether the request's address is logged with its query string (code and `state`). The hub's own lines hold only fixed words, status codes and timings: `provider_call google.token 200 <n>ms`, `oauth_callback google connected`. No token, code or email. |
| 14 | Does a refresh return a new refresh token? | **Can't be checked at step 2.** Nothing refreshes the Google token until the calendar route exists (step 3b), and the hub logs nothing about Google's refresh answer (G6 allows field names only for TickTick's step 4 checks). | Open. The code is safe either way for one refresh at a time: a new refresh token, if one comes, is saved. Decide at step 3b how to answer the "To confirm" row: a "refresh token changed: yes/no" log line under a G6 exception like TickTick's, or leave it open. |
| 15 | Disconnect revokes | Press Disconnect on `/setup` | "Disconnected." with no remove-access note, Google shows "not connected", and the hub is gone from the Google account's third-party access page (it can take a moment). If the note shows instead, remove the hub there by hand and record it: the hub sends the token in the form body, where Google's example puts it in the address. |
| 16 | Connect again | Press Connect and approve | "Connected." This is the connection the later steps use. |
| 17 | Disconnect after access was removed at Google (once) | Remove the hub on the Google account's third-party access page, wait a moment, then press Disconnect on `/setup`. Afterwards connect again, as in check 16. | "Disconnected." with no remove-access note: Google answers a revoke of an already revoked token with a 400 `invalid_token`, which the hub counts as done. If the note shows, record it in v1.md (Google facts, Revoke): Google's answer is not the one the hub expects. The Worker's log line for the call shows the status: `provider_call google.revoke <status> <n>ms`. |

Checks 10, 12 and 13 are the ones step 2's "done when" names that can be run now (Google connected; two of the three "To confirm" rows). The third row is check 14.

## Record

One row per deploy.

| Date | Step deployed | Checks run | Result | Notes |
|---|---|---|---|---|
| | | | | |
| 2026-11-16 | 1a | 1–7 | All passed | Fail-closed order; Access enabled from the Worker's Access tab; GitHub only (instant auth) |
| 2026-11-16 | 1b | Checks passed; ended-session check done | All passed | Revoked the session and confirmed a background request gets a 302 to the Access sign-in page; the page shows "Sign in again" |
