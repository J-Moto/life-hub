# Plan review: steps 2, 4, 5, 6 and 8 (Fable 5.2, 2026-11-16)

- **Reviewer:** Fable 5.2 in Claude Code, read-only, no network. Run around 2 am on 2026-11-16, after step 1a was deployed.
- **Scope:** `CLAUDE.md`, `docs/design/v1.md` (sections F, G, H, I and build steps 2, 4, 5, 6, 8), `src/index.ts`, `src/router.ts`, `src/env.ts`, `src/api.ts`, `src/auth/`, `src/crypto/`.
- **Goal given:** find real security or correctness gaps in the plan for the OAuth logins, token storage and refresh, and write routes before they are built, plus any mismatch between the plan and the code in `src/`.
- **Result:** no high, 5 medium, 9 low.
- **Sorting:** see "Decisions" at the end. The plan fixes are applied in a separate pull request (`docs/plan-fixes-fable-review`).

---

## Report (as printed)

I found no high-severity gap: 5 medium and 9 low findings. The core login design (single-use state, `__Host-` cookie, Access email, fixed redirect_uri, Access check before the callback) holds up. The weak spots are the rules for when a stored token gets deleted, the TickTick refresh path, and details the plan leaves unspecified for the callback.

This was read-only with no network, so nothing was checked against provider or Cloudflare docs. Claims about KV consistency, Workers Logs and provider behaviour are from memory, and I mark the ones I am unsure of.

### Medium

#### M1. "A refused token deletes the record" is too broad and collides with the step 4 habit probe

- **What is wrong:** Step 4 says a refused token deletes the record, without defining "refused". The same step makes a habit check-ins request in the callback precisely because the token may be refused there (C5).
- **How it fails:** If the habit endpoint answers 401 or 403 for a scope reason, a generic "401 means delete" rule wipes the token just stored. Every later `/api/habits` load then disconnects TickTick again until step 7 removes the section.
- **Fix:**
  - Define "refused" as a 401 from a task endpoint only.
  - A 401 or 403 from the habit endpoint fails that section and never touches the record.
  - A 403 anywhere never deletes.
  - Add a test: "a refused habit request leaves the TickTick record in place".

#### M2. Delete-on-failure can destroy a connection the owner just made

- **What is wrong:** G5 leans on "re-read KV once" after `invalid_grant` to catch a fresh reconnect. KV is eventually consistent: a re-read moments later can return the same stale record, and there is no compare-and-delete.
- **How it fails:** The phone's request holds the old record and gets `invalid_grant`. The owner reconnects on the PC. The phone's re-read is stale, so it deletes the key, which now holds the new record. The owner sees "Reconnect Google" seconds after connecting. The same applies to the TickTick delete in step 4.
- **Fix:**
  - Delete only when the re-read record carries the same refresh token (or the same stored `connectedAt`) as the one that failed.
  - If it differs, retry once with the new record.
  - State the small remaining window in G6c as accepted.
  - Add a test: "invalid_grant on an old record does not delete a newer one".

#### M3. The TickTick refresh path is unchecked for rotation, and concurrent refreshes are guaranteed

- **What is wrong:** G5 says TickTick refreshes "the same way" if a refresh token exists. G6c's safety rests on the refresh token not being replaced, which is checked for Google only. The step 4 check logs field names of the first token response, which cannot show rotation.
- **How it fails:** One page load fires `/api/tasks` and `/api/habits` in parallel, so every expiry produces two refreshes at once, not only the PC-plus-phone case. If TickTick rotates, the loser gets `invalid_grant` and, under G5, deletes the record. TickTick would disconnect at roughly every token expiry.
- **Fix:**
  - Add a "To confirm" row at step 4: does a TickTick refresh return a new refresh token, and does the old one still work?
  - Log the field names of one refresh response as well.
  - If it rotates, G6c does not apply to TickTick. Either skip refresh there (use until refused, then Reconnect) or add the M2 compare-and-retry before any delete.
- **Unsure:** whether TickTick issues refresh tokens at all. I recall it does not, in which case this closes itself, but the plan should say so.

#### M4. A token refused during a call does not reach the page as not_connected

- **What is wrong:** In `src/router.ts:30-41`, `NotConnectedError` is caught only around `resolveSources`. With real clients the refusal happens inside the call. The plan tests this for the read route in step 4, but steps 5, 6 and 8 list no such test.
- **How it fails:**
  - Complete or add: the error reaches the catch in `src/index.ts:40` and becomes a 500 `internal`. The page shows "didn't save" forever instead of the Reconnect banner (H4).
  - Restart: the bare `catch {}` at `src/api.ts:182` counts it as a failed move, so the owner reads "Moved 0, 3 didn't move. Try again." Each remaining task still makes a doomed call.
- **Fix:**
  - Map `NotConnectedError` to `not_connected` in one place for every route.
  - In Restart, stop the loop on it and answer `not_connected`.
  - Add one test per write route in steps 5, 6 and 8.

#### M5. The callback's contract is not written down

- **What is wrong:** Section 3 gives the callback one line, and the step 2 test list covers only state, cookie and email. The tests are derived from that list, so anything missing from it will not be built deliberately.
- **Fix:** add these rules and a test for each.
  - **Provider match:** the provider in the state record must match the callback path. Otherwise a Google state at `/oauth/ticktick/callback` sends the code and verifier to the wrong token endpoint.
  - **Consume first:** delete the state before the code exchange, not after. A failed exchange writes nothing and never touches an existing record.
  - **Provider error:** a callback with `error=…` consumes the state, stores nothing, and shows a fixed message. Nothing from the query string is put into the page.
  - **No refresh token:** if Google's response lacks one, store nothing and answer as a failure. Otherwise the hub looks connected for an hour, then asks to reconnect.
  - **Scope:** the returned scope must be exactly the one requested, and `include_granted_scopes` is never sent. Otherwise the stored token can be broader than G4 allows.
  - **Answer:** a 303 to `/setup` with `Cache-Control: no-store`, clearing the cookie, so the code does not stay in the address bar.
  - **State details:** at least 128 random bits. Keep a creation time in the record and check it, instead of relying on KV's TTL alone for "expired".

### Low

#### L1. The authorization code and state land in logs through the URL

- **What is wrong:** `wrangler.jsonc` has observability on. I believe Workers Logs records each request's full URL, including the query string, but I am unsure. G6 says nothing about it.
- **How it fails:** The callback URL with code and state sits in log storage. Both are single-use, and the code needs the client secret, so the exposure is small.
- **Fix:** check at step 2 what the invocation log holds. Then either record it in G6 as accepted, with the reason, or switch invocation logs off.

#### L2. Changing the key or reconnecting leaves live tokens at the provider

- **What is wrong:** G2's key change is "set a new secret and reconnect". The old record can no longer be decrypted, so Disconnect cannot revoke it.
- **How it fails:** If the key is changed because key and KV may have leaked, the leaked Google refresh token stays valid until six months without use.
- **Fix:** G2's procedure becomes: Disconnect both, change the key, then connect. Disconnect on an undecryptable record deletes it and shows the "remove access at the provider" note. Add a test for that.

#### L3. Missing key or client settings fail late and as a 500

- **What is wrong:** `importKey` (`src/crypto/tokens.ts:46`) throws on a missing or bad `TOKEN_ENC_KEY`. Section 3 says a missing setting answers `not_configured`.
- **How it fails:** The owner approves at Google, the callback cannot store the token, and a live grant exists that the hub cannot hold or revoke. Read routes answer 500 instead of "not set up yet".
- **Fix:** connect checks the key, client ID, client secret and `HUB_ORIGIN` before issuing a state, and answers `not_configured`. Read routes do the same. If storing fails in the callback, try a revoke.

#### L4. Google refusing an unexpired access token is not covered

- **What is wrong:** G5 handles only an expired token and `invalid_grant`.
- **How it fails:** The owner removes the hub at Google. `events.list` answers 401, but the stored expiry is up to an hour away, so the page shows "couldn't update" instead of Reconnect.
- **Fix:** a 401 from `events.list` triggers one refresh, which returns `invalid_grant` and follows G5. Also treat a token within about 60 seconds of expiry, or with no stored expiry, as expired.

#### L5. Restart identifies the Minimum task by exact title, and counts moves by status alone

- **What is wrong:** `src/api.ts:173-174` compares `t.title === cfg.minimumTask`. `MINIMUM_TASK_TEXT` is only trimmed, not passed through `cleanTitle`.
- **How it fails:** If TickTick changes the title in any way on save, each Restart moves the old Minimum task to Next and adds a new one. "Pressing it twice changes nothing" breaks and Next fills up.
- **Second issue (unsure):** the move endpoint takes an array. If it answers 200 with a per-item failure inside, the hub reports "moved" for a task that stayed.
- **Fix:**
  - Compare titles after the same cleaning on both sides.
  - Add a "To confirm" row at step 8: does the title come back unchanged, and what does a failed move look like?
  - Safest is to re-read Today after the moves and report counts from that.

#### L6. Two sources of truth for the hub's address

- **What is wrong:** `isSameOrigin` (`src/auth/origin.ts:7`) uses the request's own URL. The redirect_uri will use `HUB_ORIGIN`. F5 says "the hub's own address" without choosing.
- **How it fails:** A mis-set `HUB_ORIGIN` fails closed, but only after the trip to the provider, and with a provider error page. It gets riskier when the hub moves to the custom domain.
- **Fix:** validate `HUB_ORIGIN` as an https origin with no path. Connect answers `not_configured` unless it equals the request's origin.

#### L7. The written rules no longer match what steps 2 and 4 build

- **What is wrong:**
  - `CLAUDE.md` says every route that changes data is POST-only, and that KV holds only encrypted tokens.
  - The callback is a GET that writes KV.
  - Read routes will write refreshed tokens.
  - The login state record holds the PKCE verifier and the owner's email unencrypted.
  - `src/router.ts:116` also treats every GET as read-only.
- **How it fails:** `CLAUDE.md` says to stop on a conflict, so step 2 stalls. Or the reviewer waves the exception through without it being written down.
- **Fix:** name the two exceptions in `CLAUDE.md` and F5: the callback (guarded by G6b) and token refresh. Store a hash of the email in the state record instead of the email.

#### L8. Step 4's temporary probes are never removed

- **What is wrong:** Step 10 removes only the PKCE switch. The field-name log and the habit probe stay in the callback.
- **How it fails:** Every later reconnect makes an extra TickTick call and uses the G6 logging exception, after their purpose has ended.
- **Fix:** remove both in step 7, or in step 10, and close the G6 exception in the same step.

#### L9. Smaller hardening notes for the login code

- Provider calls should not follow redirects and should have a timeout. Otherwise a redirected token request carries the Basic Auth header elsewhere, and a hung provider hangs the route.
- `:provider` in the `/setup` routes should match only the two literal names.
- Connect should refuse when `access.devBypass` is true, which enforces G7 in code.
- One cookie name for both providers means two connects in two tabs break each other. Use a per-provider name or accept it.

### Checked and found sound

- New POST routes inherit the F5 checks. The router does the origin check and body read before dispatch (`src/router.ts:118-126`), so `/setup/connect` and `/setup/disconnect` get them once they are routed.
- The callback is behind Access. `src/index.ts:26` runs `verifyAccess` for every path, and the verified email is available for the state binding.
- Record swapping is blocked. The provider name is bound into the encryption in `src/crypto/tokens.ts:41`.
- Complete cannot be steered to another path. `validTaskId` plus the re-read of Today cover it (`src/api.ts:143-146`).
- The write gate is per route and typed (`src/router.ts:59-84`), matching the plan.
- Local development cannot reach real KV. `npm run dev` is plain `wrangler dev`.

---

## Decisions (owner, 2026-11-16)

Fix the plan now, all in the follow-up plan-fix pull request:

| # | Decision | Notes |
|---|---|---|
| M1 | Fix the plan now | Step 4. |
| M2 | Fix the plan now | Compare a stored `connectedAt` (works for both providers, even without a refresh token). Accept the small window in G6c. |
| M3 | Fix the plan now | If TickTick rotates refresh tokens, do not refresh it: use until refused, then "Reconnect TickTick". Fits decision 6 ("refresh if possible, else Reconnect"). M2's compare does not cover rotation, because both parallel refreshes start from the same record. |
| M4 | Fix the plan now | One-place mapping in step 4; Restart stops on it in step 8; one test per write route in steps 5, 6 and 8. |
| M5 | Fix the plan now | All seven rules, one test each, in step 2. Scope is compared as a set of space-separated values, not as exact text. |
| L1 | Fix the plan now | "To confirm" row at step 2. |
| L2 | Fix the plan now | G2 procedure order plus the undecryptable-record test. |
| L3 | Fix the plan now | Check settings before issuing a state. |
| L4 | Fix the plan now | G5 rule. |
| L5 | Fix the plan now | Cleaned titles on both sides plus a "To confirm" row at step 8. Re-reading Today after the moves only if that row shows per-item failures. |
| L6 | Fix the plan now | |
| L7 | Fix the plan now | Write the two exceptions into `CLAUDE.md` and F5; store a hash of the email in the state record. |
| L8 | Fix the plan now | Remove the probes in step 10 and close the G6 exception there. |
| L9 | Fix the plan now, except the shared cookie | Shared cookie skipped: the owner will not connect two providers in two tabs at once, and the failure is a harmless "try again". |

No finding needed a follow-up from Fable. The three "unsure" points (TickTick refresh tokens, what Workers Logs records, how a failed TickTick move looks) are provider facts and became "To confirm" rows.
