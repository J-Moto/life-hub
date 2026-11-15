# Stage 5: Initial Zoom Out Report

**Target:** `docs/design/v1.md` (full file, lines 1-255)
**Reviewer context:** `DESIGN.md`, `CLAUDE.md`, `docs/setup-runbook.md`, `wrangler.jsonc`, `src/`

## Reviewer Status

| Reviewer | Status | Findings |
| --- | --- | --- |
| `egm-zoom-out` | completed | 0 Blocker, 5 Major, 6 Nit |
| `egm-inventive-catalyst` | completed | 0 Blocker, 2 Major, 5 Nit (all advisory) |

Finding ids are `<reviewer>-<round>-<n>`: `ZO-1-n` for zoom-out, `IC-1-n` for inventive catalyst.

## Prioritized Findings (Blockers -> Major -> Nits)

No Blockers.

### ZO-1-1. The design reads as if nothing exists, but much of steps 1, 2, 5, 6 and 8 is already in `src/` - Severity: Major
* **Reviewer Lens:** `egm-zoom-out` (also noted by `egm-inventive-catalyst`)
* **Affected Scope:** Section 5 (lines 188-201); Section 3 (lines 130-148); F1/F2 (85-86); F5 (89); G2/G3 (98-99); H2 (113)
* **Discrepancy Description:** The build order lists the skeleton, Access JWT check, lockdown headers, token storage and shared POST checks as work to do. They already exist: `src/auth/access.ts` (JWT check with local skip), `src/index.ts` (CSP, security headers, same-origin check on non-GET), `src/crypto/tokens.ts` (AES-GCM, provider binding, version label, KV wrapper), `src/api.ts` (complete, add-to-Next, Restart handlers), `src/domain/week.ts` and `src/domain/input.ts`. The doc and the code disagree without saying so:

  | Topic | Design says | Code or config has |
  |---|---|---|
  | Read routes | Three: `/api/calendar`, `/api/tasks`, `/api/habits` | One combined `/api/today` |
  | Address | The `*.workers.dev` address (F2) | `"workers_dev": false` in `wrangler.jsonc`, with no route |
  | Cron | Every 20 minutes | `"7 * * * *"` (hourly) |
  | Missing `Origin` | Rejected (F5) | `src/auth/origin.ts` falls back to `Sec-Fetch-Site` |
  | Secrets | "Exactly five"; audience and email are uncommitted vars | `wrangler.jsonc` header lists seven, including `ACCESS_AUD` and `ALLOWED_EMAIL` |
  | Habit % | Today counts only once done; `value` must reach `goal` | `weeklyPercents` always counts today; `HabitCheckin` has no `value` or `goal` |
  | Habit names | From config, one request | `TaskSource.listHabits` fetches them |
  | Priority tag | Prefix and label from config | `JOB:` hardcoded in `api.ts` and `input.ts` |
  | Restart | Move first, then add; report a failed add | Adds the Minimum task even when moves failed |
  | Complete | Trusts the Today project ID alone | Re-reads Today first to confirm the task is there |

* **Rationale & Recommendation:** A fresh reader cannot tell whether to rebuild, adapt or delete the existing code. Add a short "Starting point" note that maps each existing module to its build step and lists the differences above as planned changes. Reword steps 1, 2 and 5 from "build" to "adapt". Add "complete only works on Today tasks" to the "To confirm" table, because it depends on TickTick rejecting a mismatched project ID.

### ZO-1-4 / IC-1-1. The cron-only Google refresh rests on an unsupported premise and is not a single writer - Severity: Major
* **Reviewer Lens:** `egm-zoom-out`, `egm-inventive-catalyst`
* **Affected Scope:** G5, G6c (lines 102, 105); G1, G2 (97-98); H2, H4 (113, 115); build step 2 (191); "To confirm" cron row (209)
* **Discrepancy Description:**
  - G6c makes the cron the only refresher so two refreshes cannot "race and lose a rotated token". The doc's own Google facts (line 172) say the docs do not mention refresh-token rotation. Without rotation the race is harmless.
  - The cron is not the only writer. The `/setup` callback writes the same record and Disconnect deletes it. The record holds the refresh and access tokens together, and KV reads can be stale for about a minute, so a cron run just after a reconnect can write the old refresh token back over the new one.
  - The page cannot tell a dead Google login from a late cron. H2 says the page never reads cron results, and G6c's "re-read KV once before showing Reconnect" has no stated path from the cron to the page.
  - Cost: about 72 token mints a day whether or not the page is open, plus a "cron failed for an hour" banner state.
* **Rationale & Recommendation:** Two options were raised.
  1. Refresh inside the calendar request when the stored access token is near expiry, and store a new refresh token if one ever comes back (zoom-out).
  2. Split storage into two encrypted records per provider: a refresh-token record written only by `/setup` (or when a provider returns a new one), and a disposable access-token record any writer may replace. Optionally let a page request mint an access token, so the page learns `invalid_grant` directly; the cron could then stay hourly (inventive catalyst). Costs: two KV keys per provider, the record binding must cover the slot, and a rule is needed if Google ever starts rotating.

  If the cron-only design is kept, state why on-demand refresh was rejected and add "does Google rotate the refresh token?" to the "To confirm" table at step 2.

### IC-1-2. No failure state for "the hub's own sign-in expired" - Severity: Major
* **Reviewer Lens:** `egm-inventive-catalyst`
* **Affected Scope:** H1, H3, H4 (lines 112, 114, 115); F3 (87); A3 (38); B1 (47)
* **Discrepancy Description:** The design names two failure classes: upstream down (H3) and provider token expired (H4). It has none for the Access session ending. A page left open on the desk monitor refreshes every 10 minutes and the session lasts one month, so this happens about monthly. As written, all three sections show "didn't answer" and retry, and every checkbox tap or add shows "didn't save". The documented remedy, "tap again", can never work in this case.
* **Rationale & Recommendation:** Treat an auth failure on any `/api/*` call as its own signal. Show one page-level "Sign in again" action that reloads the page, stop section retries, do not show "didn't save", and keep typed text and unchecked rows in place until the reload. Add a "To confirm" row: what a background request receives when the Access session has expired (possibly a cross-site redirect that the page's own Content-Security-Policy blocks, or a 401). The reviewer could not verify this.

### ZO-1-2 / IC-1-6. Where config lives is not decided, and it has no checked shape - Severity: Major
* **Reviewer Lens:** `egm-zoom-out` (Major), `egm-inventive-catalyst` (Nit)
* **Affected Scope:** Section 3 config paragraph and public-repo note (lines 148-150); A1, A5, C1, D2, E1, E2
* **Discrepancy Description:** The doc says every decision is settled, but config is "in `wrangler.jsonc` vars or KV" and then "Worker vars that aren't committed, or in KV". Those are two designs. KV config needs a write path and a read per request, and it puts non-token data in the store the hard rules reserve for tokens and login state. The config is structured (ID-and-name pairs, a calendar list, a prefix and label), while `src/env.ts` uses flat comma-separated strings. Line 23's "if the hub is deleted, nothing is lost" does not hold for dashboard-only config.
* **Rationale & Recommendation:** Choose uncommitted Worker vars and delete the KV option; `wrangler.jsonc` already sets `keep_vars: true`. State the encoding of structured values (for example one JSON var each, or one JSON var for all). Consider committing a schema and an example file with placeholder IDs, and validating per section so a bad calendar list disables only the calendar. Have line 23 name the config as something to re-enter after a delete.

### ZO-1-3 / IC-1-3. The hourly TickTick check has no consumer - Severity: Major
* **Reviewer Lens:** `egm-zoom-out` (Major), `egm-inventive-catalyst` (Nit)
* **Affected Scope:** H2 (line 113); build step 9 (198); Section I (120); G6 (103)
* **Discrepancy Description:** Once an hour the cron makes a TickTick read whose result goes to logs only. The doc says the page does not depend on it and finds a dead token on its own. v1 has no notifications, so nothing acts on the result. It spends 24 calls a day against undocumented rate limits.
* **Rationale & Recommendation:** Drop it from v1 and add it back with the v1.1 "Hub needs attention" calendar, its first consumer. Alternative from the inventive catalyst: turn it into a contract probe that checks required field names are present (names only) and logs a fixed mismatch code, which would partly replace the missing live test. That needs G6 amended to allow a mismatch code.

### ZO-1-5. The 5-second undo is the largest piece of page state in v1, and it leaks into other features - Severity: Major
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** A3 (line 38); D1 (66); H1 (112); build step 5 (194)
* **Discrepancy Description:** Holding the completion needs a timer per task, a flush on page hide or close, and a rule that Restart sends pending completions first. Two gaps remain: a send during page close is best-effort and cannot show the promised "didn't save" note; and a refresh inside the window (refresh button or the 10-minute timer) would bring the faded task back as unfinished.
* **Rationale & Recommendation:** The simplest alternative is to send at once and un-check the rare mistake in the TickTick app. If the undo stays, add the rule for refreshes during the window and say plainly that the close-time send is not guaranteed. (The inventive catalyst judged the delay-the-send undo a balanced answer to a real API limit, so the reviewers differ on whether to cut it.)

### IC-1-5. Restart's partial-failure rules cover only one failure - Severity: Nit
* **Reviewer Lens:** `egm-inventive-catalyst`
* **Affected Scope:** D1 (line 66); A3 (38); API facts, "Restart's move" (159)
* **Discrepancy Description:** Three cases are open. Pending completions are "sent first", but only the page can do that, and nothing says what happens if one fails (the just-checked task would be moved, not completed). The move uses a batch endpoint, but only the "add failed" case has a message. Duplicate detection is by title, so changing the Minimum text in config leaves the old one to be moved and a second one added.
* **Rationale & Recommendation:** State the target once: "Today holds only the Minimum task; everything else unfinished is in Next". Every partial failure then reports what is left, and pressing again finishes it. Add: if a pending completion fails, Restart stops before moving anything. Add a "To confirm" row for the batch move's partial-failure behaviour.

### IC-1-4. "No stored cache" is read as "nothing to show when upstream is down" - Severity: Nit
* **Reviewer Lens:** `egm-inventive-catalyst`
* **Affected Scope:** H1, H3 (lines 112, 114); hard rules (23)
* **Discrepancy Description:** H3's "Show whatever loaded" does not say whether a section that loaded at 9:41 and failed at 9:51 keeps its 9:41 content or goes blank. The hard rule is about persistence, not page memory.
* **Rationale & Recommendation:** Keep each section's last good data on screen, in page memory only, with its own "as of 9:41" time. Costs: per-section timestamps, and stale checkboxes may need to be disabled.

### IC-1-7. The page look is chosen before the habit question is answered - Severity: Nit
* **Reviewer Lens:** `egm-inventive-catalyst`
* **Affected Scope:** Build steps 3 and 4 (lines 192-193); C5 (59)
* **Discrepancy Description:** The mockup is picked before step 3, but whether the habit section exists is decided at step 4.
* **Rationale & Recommendation:** Either move the TickTick login and the C5 check ahead of the mockup choice, or require the mockup to show a with-habits and a without-habits layout.

### ZO-1-6. Configurable priority-tag prefix and label is built for a future rename - Severity: Nit
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** A5 (line 40); B2 (48); config list (148)
* **Rationale & Recommendation:** Two config values for a speculative need. One named constant in one place is enough for v1 and fixes the current two-place hardcoding.

### ZO-1-7. The key-version label does nothing when rotation means "reconnect" - Severity: Nit
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** G2 (line 98)
* **Rationale & Recommendation:** An old record fails to decrypt and shows "Reconnect" anyway. Either say the label is the existing envelope format version (`v1` in `src/crypto/tokens.ts`), or drop it.

### ZO-1-8. Automatic read retries stack on top of four refresh triggers - Severity: Nit
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** H3 (line 114); H5 (116); H1 (112)
* **Rationale & Recommendation:** The doc does not say how three retries interact with "back off on a 429". A banner plus the existing refresh triggers would do for v1.

### ZO-1-9. Disconnect with provider-side revoke may be cuttable - Severity: Nit
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** G1 (line 97); `/setup/disconnect/:provider` (141)
* **Rationale & Recommendation:** One route and two revoke integrations, when both providers let the owner revoke from their account pages. If it stays for the portfolio's security story, say so.

### ZO-1-10. Sections 6 and 7 put about 40 lines of non-v1 material in the file the builder reads before every feature - Severity: Nit
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** Section 6 (lines 217-226); Section 7 (230-254)
* **Rationale & Recommendation:** Move them to a separate later-versions file. Keep only the "v1 rules this would have to revisit" list here.

### ZO-1-11. Section 4 and the per-row checkmarks repeat section 2 - Severity: Nit
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** Section 4 (lines 177-184); status lines (3-5)
* **Rationale & Recommendation:** Delete section 4 and the checkmarks; keep the one status line.

## Checked and found sound

- The security depth (Access plus an in-Worker JWT check, encrypted tokens, `state` and PKCE) fits the stated portfolio purpose.
- One Worker instead of Worker plus Pages (F1) is the simpler option and matches `wrangler.jsonc`.
- Live fetch with no cache (H1) is right for one user and keeps "stores no data" true.
- Separate read routes are justified; the existing combined `/api/today` waits for every upstream.
- The habit-scope check sits at step 4 with a clear fallback (C5).
- Rejecting requests when Access keys cannot be fetched (F4), dropping habits instead of adding a broader credential (C5), and reconnecting both services on key change (G2) were examined and judged balanced.
