# Consolidated Review Report: Life Hub v1 Design

**Target:** `docs/design/v1.md` (255 lines)
**Split:** feature spec = lines 1-187 (sections 1-4); build plan = lines 188-214 (section 5); sections 6-7 read by the full-file reviewers only
**Reviewer context:** `DESIGN.md`, `CLAUDE.md`, `docs/setup-runbook.md`, `wrangler.jsonc`, `src/`
**Mode:** consolidated report, all rubrics, one round per stage. No fixes were applied. `docs/design/v1.md` is unchanged.

## 1. Result

**The feature spec has no Blockers but is not finished. The build plan is not ready to build from.**

What is wrong, in order of weight:

1. **The doc is written as if the repo were empty.** A working skeleton already covers much of build steps 1, 2 and 4-8, and it disagrees with the spec in about sixteen places. Several of those are pinned by passing tests. Stages 5, 7 and 9 each reached this finding independently, and Stage 8 refined it. The comprehension reviewer, who read the doc alone, concluded "there appears to be no existing hub software".
2. **The build plan is a list of ten titles.** It names no files, no tests, no route contracts and no finish line per step. Following the current order would also put unreviewed write routes live against the real TickTick account at step 4.
3. **Three mechanisms collect most of the open rules:** the cron-only Google token refresh, the 5-second undo, and automatic read retries. The reviewers split on whether to specify them further or cut them. These are owner decisions (section 3).
4. **The doc says "all decisions were settled" while it holds open items:** where config lives, the TickTick token lifetime, PKCE support at both providers, and whether habits can be read at all.

What held up under review: one Worker instead of Worker plus Pages; Access plus the in-Worker JWT check; encrypted tokens in KV; live fetch with no stored cache; rejecting requests when Access keys cannot be fetched; dropping habit % instead of adding a broader credential; the placement of the habit-scope check at step 4. No reviewer found a reason to change these.

### Stage summary

| Stage | Reviewers | Status | Blocker | Major | Nit | Report |
|---|---|---|---|---|---|---|
| 5. Initial Zoom Out | `egm-zoom-out`, `egm-inventive-catalyst` | completed | 0 | 6 | 8 | `zoom_out_report.md` |
| 6. Comprehension Test | `egm-comprehension` | completed | 0 | 5 | 8 | `comprehension_report.md` |
| 7. Critic Review | `egm-design`, `egm-structural`, `egm-style` | completed | 0 | 21 | 16 | `critic_report.md` |
| 8. Intermediate Zoom Out | `egm-zoom-out` | completed | 0 | 6 | 7 | `intermediate_zoom_out_report.md` |
| 9. Implementation Readiness | `egm-implementation-readiness`, `egm-codebase-details`, `egm-style` | completed | 4 | 9 | 7 | `implementation_readiness_report.md` |

Counts are after merging overlaps inside each stage. All ten reviewer runs completed; none was retried.

After merging across stages: **4 Blockers, 21 Major (6 owner decisions and 15 fixes), 7 Nit groups.**

### Limits of this review

- No reviewer had web access. Every statement about TickTick, Google or Cloudflare behaviour was taken from the doc or from the reviewer's memory. Two are flagged as unverified in the items below (`keep_vars` in M3, the declined-event format in M9).
- No reviewer ran the tests, the typecheck or `wrangler dev`. "Passing tests" means the reviewer read the test file.
- One reviewer claim was checked and found wrong: `.dev.vars.example` is tracked in the repo (the reviewer could not see it because `.dev.vars*` paths are hidden from reviewers).
- Reviewers are fresh readers by design. They did not see the design session, so some findings ask for reasons the owner already has. Where a finding reverses a decision the owner made on purpose, it is listed as a decision, not a defect.
- Consolidated mode skips the fix-and-re-audit loop, so nothing here has been through a second round.

## 2. Blockers

All four come from Stage 9 and concern section 5. They are Blockers against the implementation-readiness standard, which assumes the builder may make no decisions.

Counter-view: `CLAUDE.md` makes the building agent the owner of the design and requires test-first work per branch. Under that workflow, B2 and B4 could be met by a rule ("each branch starts by listing its files and test cases in the PR") instead of by writing all ten lists now. B1 and B3 stand either way.

### 🔴 B1. Add a "Starting point" section that reconciles the doc with the skeleton
* **Scope:** Header (lines 1-5); section 5 (190-199); F1, F2, F4, F5, G2, G3, A5, B1, B2, C1, C3, D1-D5; section 3 routes
* **Problem:** Steps 1, 2 and 4-8 are phrased as new work, but `src/`, `public/` and `test/` already implement much of them. The code and the spec disagree on: three read routes against one `/api/today`; the 20-minute cron against an hourly one; `workers_dev: false`; five secrets against seven; a missing `Origin`; JSON bodies on POST; the habit formula (always counts today, no `value`/`goal`, no "—"); habit names fetched instead of configured; hardcoded `JOB:`; input cleaning beyond "trim only"; per-task moves against a batch move; a generic 500 when Restart's add fails; browser `confirm()`; "Restart the day"; a hardcoded Minimum-task fallback. The full tables with file and line references are in `implementation_readiness_report.md` (R-1).
* **Action:** Add one section listing each difference and naming which side wins. Stage 7 said "the doc wins". Stage 8 argued the skeleton should win where it is safer or simpler: the Today-membership check before completing, the stricter local-dev skip, and the per-task move with one count message. Then mark each build step as reuse, change (with the tests to rewrite) or new, and say in which step `/api/today` is split and removed.

### 🔴 B2. Give each build step its files and a branch name
* **Scope:** Lines 188-199
* **Problem:** No step names a file to create, modify or delete. No branch names, though `CLAUDE.md` requires `feat/<name>`. Steps 2 and 9 each hold several features against "one feature per branch".
* **Action:** Per step: created / modified / deleted files and the branch name. Or adopt the per-branch rule in the counter-view above and state it in section 5.

### 🔴 B3. Turn each step from a title into decided behaviour
* **Scope:** Lines 190-199; section 3
* **Problem:** The builder would have to decide: request and response shapes, status and error codes for every route; whether `/setup` is a static file or Worker-rendered and where its five routes go (today any non-API POST returns 405); how "connect" redirects to the provider under a CSP with `form-action 'self'` and a JSON-body rule; where login state and the PKCE verifier live; the missing `Env` settings (client IDs, `redirect_uri`, the hub's own address); that the cron must carry the refresh token forward because `TokenStore.put` overwrites the record; what happens when revoke fails; the calendar dedupe key and Work Block match rule; hand-written OAuth or a library; what the page is built with and how page logic is tested.
* **Action:** Answer each in the doc. Owner decisions D1-D4 remove a share of these questions if the mechanisms are cut, so decide those first.

### 🔴 B4. Add a test plan and fix the shared test files
* **Scope:** Lines 190-199, 201; section I (120)
* **Problem:** The only mention of tests is "+ tests (no real APIs)" on step 1. No step lists cases. The fakes cannot simulate value/goal check-ins, a batch move or several calendars; there is no helper for mocking provider calls, which G7 requires; `vitest.config.ts` supplies no encryption key or client IDs. The "short manual checklist run after each deploy" does not exist.
* **Action:** Per step, name the test file and the cases (happy path and edges). List the changes to the shared test files. Write the manual checklist or name the file it will live in.

## 3. Major: decisions for the owner

Each of these reopens or reverses something the doc marks as settled. The reviewers disagree with each other on most of them, so the positions are laid out side by side. The "Orchestrator's view" lines are the opinion of the agent that ran this review, not a reviewer finding.

### 🟡 D1. Google token refresh: cron-only, or on demand?
* **Scope:** G5, G6c (lines 102, 105); G1 (97); H2, H4 (113, 115); step 2 (191); row 209
* **Problem with the current design:** The cron exists so two refreshes cannot "lose a rotated token", but the doc's own facts table (line 172) says Google's docs do not mention rotation. The cron is not the only writer: `/setup` connect and disconnect write the same record, and KV reads can be stale, so a cron run after a reconnect can write the old token back. The page cannot tell a dead Google login from a late cron, because cron results go to logs only.
* **Options:**
  1. Keep the cron and add a cron-to-page signal, such as a "needs reconnect" marker (Stage 7, `C-1`).
  2. Split storage into a refresh-token record and a disposable access-token record (Stage 5, `IC-1-1`).
  3. Remove the cron from v1. `/setup` becomes the only KV writer; the calendar request mints an access token from the stored refresh token and does not store it; `invalid_grant` reaches the page directly as "Reconnect" (Stages 5 and 8, `ZO-1-4`, `ZO-2-1`). Cost: one extra Google call per calendar read.
* **Orchestrator's view:** Option 3. It removes a race, a banner state, the `invalid_grant` re-read and an unverified cron setting, and it needs no new storage. Add a "To confirm" row at step 2: does Google ever return a new refresh token? If it does, reopen this. Note that this changes `CLAUDE.md` too, which says "cron every 20 minutes".

### 🟡 D2. Hourly TickTick check: keep, repurpose or drop?
* **Scope:** H2 (line 113); step 9 (198)
* **Problem:** Its result goes to logs only, the page ignores it, and v1 has no notifications. It spends 24 calls a day against undocumented rate limits. The plan gives no mechanism for running it hourly on a 20-minute schedule.
* **Options:** Drop it until v1.1's "Hub needs attention" calendar gives it a consumer (`ZO-1-3`, `ZO-2-1`). Or turn it into a check that the API's field names still match what the mocks assume, as a partial stand-in for the missing live test (`IC-1-3`); that needs G6 amended to allow a fixed mismatch code.
* **Orchestrator's view:** Drop it. With D1 option 3, v1 then has no cron at all.

### 🟡 D3. The 5-second undo: keep as is, simplify, or cut?
* **Scope:** A3 (line 38); D1 (66); H1 (112); step 5 (194)
* **Problem:** It is the largest piece of page state in v1 and leaks into Restart and page refresh. Undefined today: a refresh during the window brings the task back; a send on page close cannot show "didn't save"; Restart's "sent first" is a page-side step the Worker cannot enforce, so a failed flush leaves the task moved instead of completed. "A mis-tap costs nothing" is contradicted in the same cell.
* **Options:**
  1. Keep it and specify all three interactions (`C-2`).
  2. Keep it with one rule: while any completion is pending, page refreshes are skipped and Restart is disabled (`ZO-2-2`).
  3. Cut it: send at once, and fix the rare mis-tap in the TickTick app (`ZO-1-5`, `ZO-2-2`).
* **Dissent among reviewers:** The inventive-catalyst reviewer judged the delayed send a balanced answer to a real API limit (TickTick's API has no un-complete).
* **Orchestrator's view:** Option 2. It keeps a decision the owner made on purpose and bounds its cost to one rule. Option 3 rests on the assumption that the TickTick app can un-complete a task, which no reviewer verified. Either way, reword A3 to "a mis-tap can be undone while the page stays open".

### 🟡 D4. Automatic read retries and the 429 rule: specify or cut?
* **Scope:** H3 (line 114); H5 (116); H1 (112)
* **Problem:** "Three times with growing gaps" and "back off on a 429" have no intervals, no ceiling and no owner; the Worker keeps no state to remember a backoff. H5 is circular. The retries stack on four existing refresh triggers.
* **Options:** Give the numbers (`C-19`). Or cut automatic retries: a failed section shows its banner and waits for the next regular refresh, and H5 is deleted (`ZO-1-8`, `ZO-2-5`).
* **Orchestrator's view:** Cut them. A related low-cost addition from `IC-1-4`: say that a section keeps its last loaded data on screen, in page memory only, with its own "as of 9:41" time when a refresh fails. H3's "show whatever loaded" does not say this today.

### 🟡 D5. Where config lives
* **Scope:** Lines 148-150; line 23; F4 (88); G3 (99); A1, A5, C1, D2, E1, E2
* **Problem:** Line 148 says "`wrangler.jsonc` vars or KV"; line 150 says keep the IDs out of the repo, "or in KV"; F4 says "uncommitted Worker vars". `wrangler.jsonc` is committed and its first line says "no personal IDs here". KV config would break the rule that only tokens and login state are stored. The structured values (habit ID-and-name pairs, the calendar list) have no stated encoding, and `src/env.ts` uses flat comma-separated strings. G3 says "exactly five secrets" while the repo lists seven. Line 23's "if the hub is deleted, nothing is lost" does not hold for dashboard-only config. Raised by four stages.
* **Action:** Choose uncommitted Worker vars set on the deployed Worker; delete the KV option. State the encoding of the structured values. Say once which values are secrets and which are plain vars, and correct the count. Stage 8's one-line version: only `TIME_ZONE` and `USE_FAKES` are committed; everything else is set on the Worker. Optional (`IC-1-6`): commit an example file with placeholder IDs so the shape is versioned.

### 🟡 D6. TickTick token lifetime needs a decision rule
* **Scope:** G5 (line 102); Tokens fact (162); row 212
* **Problem:** Four of five features depend on a token whose lifetime and refresh support are undocumented. The plan is "decide then". C5 has an explicit exit; this larger dependency has none.
* **Action:** Write the rule now. Stage 8's wording: if the token response includes a refresh token, refresh the same way as Google; if it does not, and the token lasts less than the Access session, stop and re-scope.

## 4. Major: fixes

### 🟡 M1. Keep unreviewed write routes away from the real account during the build
* **Scope:** Steps 3-4 (lines 192-193); `src/api.ts:22-48`, `src/sources/types.ts:31-38`
* **Problem:** At step 3 the deployed calendar would answer 503, because every `/api/*` request requires TickTick to be connected and configured. At step 4, plugging in a real TickTick client makes the existing complete, add and restart routes live before steps 5, 6 and 8 are built or security-reviewed. Raised by one reviewer (`R-5`); it is the Major with the most direct safety consequence.
* **Action:** In step 3, make source resolution and config per provider. In step 1 or 4, say whether the write routes and buttons are removed until their steps or made to refuse.

### 🟡 M2. Move the shared POST checks to step 1 or 2 and make F5 complete
* **Scope:** Line 201; F5 (89); G1 (97); routes 140-141
* **Problem:** Line 201 says the shared POST checks are built in step 5. They already exist (`src/index.ts:34`), and step 2's connect and disconnect POSTs need them first. F5 lists three data-changing routes; section 3 has five. Line 144's "the three GET routes" ignores `/`, `/setup` and the callbacks.
* **Action:** Put the F5 tightening (reject a missing `Origin`, require a JSON body) in step 1 or 2. Say "every POST route" in F5. Restate why step 5 is security-related, or drop it from the list.

### 🟡 M3. Add a deploy-and-configure step and fix the committed config
* **Scope:** Lines 190-193, 209-213; `wrangler.jsonc`; `src/env.ts`
* **Problem:** Rows 210, 212 and 213 need "the deployed Worker", but no step covers the first deploy, the Access application, the secrets, the OAuth app registrations or moving the Google app to "In production". `workers_dev` is `false` with no route, so a deploy has no address. The KV binding has no `id`. `ACCESS_TEAM_DOMAIN: ""` is committed; one reviewer believes each deploy would blank the dashboard value (unverified; check `keep_vars` behaviour against Cloudflare's docs). Row 209 calls two settings unverified that `wrangler.jsonc` already sets.
* **Action:** Add the step, with the exact `wrangler.jsonc` and `src/env.ts` changes. Mark each task owner-manual or agent-run. Link `docs/setup-runbook.md` for the account steps instead of repeating them (`ZO-2-4`). Reword "(no real APIs)" to "tests use fakes; no TickTick or Google calls".

### 🟡 M4. Define what each Worker response means to the page, including an expired sign-in
* **Scope:** H1, H3, H4 (lines 112-115); F3 (87); section 3; step 9 (198)
* **Problem:** The doc names two failure classes (upstream down, provider token expired). It has none for the hub's own Access session ending, which happens about monthly on an always-open desk page. Every section would then blame TickTick or Google and "tap again" could never work. More generally, no table says which response means which page state.
* **Action:** Add one table to section 3 (`ZO-2-3`): hub auth failure → one page-level "Sign in again" that reloads; `not_connected` plus provider → "Reconnect"; `not_configured` → a fixed setup message; any other failure → "didn't answer" for reads, "didn't save" for writes. Build the page's fetch wrapper at step 1. Add a "To confirm" row: what a background request receives when the Access session has expired.

### 🟡 M5. Finish Restart's rules
* **Scope:** D1 (line 66); D3 (68); move fact (159)
* **Problem:** Only "add fails" is covered. Undefined: whole or partial move failure; subtasks; a failed pending completion (see D3). "Moves every unfinished Today task" contradicts "an existing Minimum task stays". Duplicate detection is by title, so changing the Minimum text adds a second one. The confirm text counts the page's list while the Worker re-reads Today, so "Move 3" can move 5.
* **Action:** State the target state once: "Today holds only the Minimum task; everything else unfinished is in Next". Report what is left on any partial failure. Write "every unfinished Today task except an existing Minimum task". Word the confirm without a count. Add "To confirm" rows for subtasks and for the move's partial-failure behaviour, or keep the skeleton's per-task move (see B1).

### 🟡 M6. "Nothing is done twice" is not true for Add to Next
* **Scope:** H3 (line 114); B1 (47)
* **Problem:** A dropped response after TickTick accepted the create looks like a failure; a second tap creates a duplicate in a list the hub never shows.
* **Action:** Reword H3 to "the hub never repeats a write on its own" and accept the duplicate risk in one sentence (`ZO-2-3`). The heavier alternative is to separate "failed" from "unknown" and say "may not have saved, check Next" (`C-3`).

### 🟡 M7. Correct the weekly-percentage claim
* **Scope:** C2, C3 (lines 56-57); section 4 item 4 (182)
* **Problem:** C3 says the number equals the full-week figure "by Sunday evening". A missed Sunday is never counted: the page shows 5 of 6 (83%) where the full week is 5 of 7 (71%). The Sunday Reset reads the higher number.
* **Action:** Delete the sentence and say the current day is left out until it is done (`ZO-2-8`). Or define when an unfinished day closes (`C-6`); Stage 8 rejects that as an added display state.

### 🟡 M8. Make the status line true and drop the markers
* **Scope:** Lines 3-5; every ✅; section 4 (177-184)
* **Problem:** "All decisions were settled" sits above C5 (habits may leave v1), G5 ("decide then"), G6b (PKCE unconfirmed) and fact rows marked "to confirm". Every row has a ✅, so it distinguishes nothing. Section 4 restates six decisions and has drifted from D2. Line 5 is stale after this review.
* **Action:** One status line: "settled, except the items under 'To confirm during the build'". Remove the ✅ marks, line 5, and section 4 (or reuse its slot, see M11).

### 🟡 M9. Make the "To confirm" table usable
* **Scope:** Lines 203-213; C1, C2, C6, E1, G6c, line 136
* **Problem:** No assumed answer, so "corrected if the answer differs" has nothing to differ from. Only the habit row has a fallback, and it does not say what is removed. Row 209 holds six settings. Rows 210 and 212 need a deliberate wrong-verifier switch in production login code and an exception to the logging rule; neither is described. Claims that drive decisions have no facts-table row: the habit list "can leave some out", check-in dates use the configured time zone, Google access tokens last about an hour.
* **Action:** Add "Assumed now" and "If it differs" columns. One row per setting. Describe each probe: where it lives, what it logs (names only, never values), when it is removed. Resolve the documentation lookups now: the Cloudflare settings and how a declined event appears (one reviewer recalls the `self` attendee with `responseStatus` "declined"; unverified). Add the new rows from D1, M4 and M5.

### 🟡 M10. Describe the routine the page sits on, in section 1
* **Scope:** Section 1 (lines 9-26); terms at 14, 20, 36-37, 48-49, 56, 66-67, 76-79
* **Problem:** "The system already works without it" has no referent. Next, Someday, the morning routine, the Sunday Reset, the limit of 3, the first-step format, the Minimum task, the Work Block and 10:30, the Akimart and the old Class Calendar are used as known. The Worker is used 19 lines before it is introduced, and "token" means the Access JWT in section F and the provider tokens in section G. Raised by Stages 6 and 7.
* **Action:** One block of about eight lines in section 1: the three projects and the limit, the morning routine, the Sunday Reset, the three habits, the Work Block, the first-step format, what the Minimum task is for, and one architecture sentence (browser page, one Worker, TickTick and Google behind it). Say "Access token" or "provider token" each time. Stage 8 advises against also adding a separate glossary and a separate architecture section.

### 🟡 M11. Record alternatives and trust limits
* **Scope:** Section 2; G2, G6c, F1, F3, A1, D2
* **Problem:** The feature-spec standard requires alternatives and risks. Rejections sit in table cells and several have no reason: "no Durable Object", the emailed one-time code, the smart Today filter, "no tidy option". KV as the token store has no alternative named. The doc never states its own limits: the encryption key and the ciphertext sit in the same Cloudflare account; the Cloudflare account and GitHub are the trust roots; a one-month session can write to TickTick; production is the only place the real login code runs.
* **Reviewers differ on size:** Stage 7 asks for two full tables (`C-10`, `C-11`). Stage 8 asks for the missing one-clause reasons inline and three sentences on trust limits (`ZO-2-4`).
* **Orchestrator's view:** The smaller version. The stated purpose is a portfolio project showing security work, so the trust-limit sentences are the part worth writing well.

### 🟡 M12. Make the mockup choice its own step
* **Scope:** Step 3 (line 192); steps 1, 2, 10; C5
* **Problem:** "Pick the mockup" is an unnumbered precondition inside step 3. No mockup files exist, and the doc does not say who picks or what a filled Target section contains. Steps 1 and 2 build pages before the look exists. Whether the habit section exists is decided at step 4, after the look is chosen.
* **Action:** A numbered step between 2 and 3 with a checkable output. Say what the step 1 page and `/setup` contain before then. Require the mockup to show a with-habits and a without-habits layout, or move the habit check ahead of the choice.

### 🟡 M13. Give steps 7, 9 and 10 clear edges, and every step a finish line
* **Scope:** Lines 190-199
* **Problem:** No step has an exit check, and section I's "hit the route locally" cannot apply to OAuth callbacks or the cron. Step 7 reads as fixed though step 4 can remove it. Step 9 bundles failure banners, page refresh and the hourly check, so steps 3-8 ship with undefined error behaviour; "refresh" means the token refresh in step 2 and the page reload in step 9. Step 10 has no checklist, and "Impeccable" is defined nowhere in the repo.
* **Action:** One exit check per step; for steps 2 and 4, split mock-verified from deploy-verified and say who does each. Write step 7 as conditional on the step 4 check. Say which failure messages ship with each feature. Rename to "token-refresh cron (G6c)" and "automatic page refresh (H1)". Bound step 10 with the measurable items in `DESIGN.md` (AA contrast, 44px tap targets, `prefers-reduced-motion`, no colour-only meaning, readable from 1 m) and say what "Impeccable" is.

### 🟡 M14. Fix wording that states more than the doc can support
* **Scope:** Lines 23, 36, 38, 85, 98, 104, 112, 136, 142, 146; lines 3, 22, 104-105, 152, 165, 173, 177
* **Problem and action:**
  - "Today" is the TickTick project in A1 and "midnight to midnight" on line 146. Reserve capitalised Today for the project; rewrite line 146 as "the current day".
  - The headline rule is quoted three ways; "stores no data" is false as written. Use "stores no task, event or habit data" everywhere.
  - "PKCE checked" (G6b, line 142) is stated as fact in a row that says it is unconfirmed. Write "PKCE verifier sent; provider enforcement unconfirmed".
  - F1's "the only way in" rests on unverified settings; state it as the intended configuration. Line 136's "can only complete tasks that are in Today" depends on undocumented TickTick behaviour; specify the membership check the skeleton already does.
  - "You", "your" and "I" refer to the owner, but `CLAUDE.md` addresses the building agent as "you". Use "the owner".
  - "Life Hub design notes", "the independent review", "the grill-me session" and "the draft" cannot be located. Link them or delete the references. Use one TickTick docs URL here and in `CLAUDE.md`.

### 🟡 M15. Say who builds, and stop duplicating `CLAUDE.md`
* **Scope:** Section G heading (line 93); G7 (106); section I (118-124); line 201
* **Problem:** "The top model" appears three times with no model or tier named, and nothing says an AI agent writes the code. Section I restates rules that live in `CLAUDE.md`, and the two copies already differ (line 201 drops "also" from the review rule). Section I promises osv-scanner on every pull request; the workflows under `.github/` run `npm audit` and gitleaks only (verified by a search of `.github/`; CodeQL may be enabled in the GitHub settings, not checked). CodeRabbit is stated as running while the runbook calls it optional.
* **Action:** One sentence pointing to `CLAUDE.md` for model tiers, review commands and "done means". Keep only the design-specific test decisions in section I. Add the scanner in step 1 or correct the claim. Say whether step 1's Access JWT check counts as top-model code.

## 5. Nits

| Id | Scope | Issue | Action |
|---|---|---|---|
| 🟢 N1 | A5, B2 (40, 48); G2 (98); G1 (97) | Three pieces of v1 scope built for a later need: configurable tag prefix and label; a key-version label when rotation means "reconnect"; Disconnect with provider-side revoke. | For each, keep it and say why (for example, the portfolio's security story), or simplify. |
| 🟢 N2 | Sections 6-7 (217-254) | About 40 lines of non-v1 material in the file the builder reads before every feature. | Move to a later-versions file; keep the four-line "v1 rules this would have to revisit" list. |
| 🟢 N3 | H1, H3 (112, 114) | "Show whatever loaded" does not say whether a section keeps its earlier content after a failed refresh. | Covered under D4. |
| 🟢 N4 | G6b (104) | KV has no atomic read-and-delete, so single-use `state` cannot be guaranteed; the doc does not say where the state is stored. | Name the store and accept the small replay window in one sentence. |
| 🟢 N5 | Sections 1, 2 (G, I), line 20 | Structure: section I has no item IDs; G6b and G6c sit under Logging; cells such as D1 hold six to ten sentences; section 1 has bold labels instead of sub-headings; no success criteria for the portfolio goal. | Stage 8 rejects most of these as churn. Revisit long cells after D1-D4 are decided. |
| 🟢 N6 | Throughout | Wording: "quiet" used five times undefined; "~70%" against "70%"; "a few seconds"; fragments ("Required."); term drift (sign-in/login/connect, unfinished/leftover/undone, refuses/dead/expired); filler ("just", "anyway", "for now"); "Few alerts, or they stop working" contradicts "No notifications"; GitHub 2FA stated as verified; steps 5-8 cite no decision numbers; "No other validation" conflicts with the empty-box rule; C5's "no personal API token" assumes the reader knows the alternative. | Fix in one pass. Per-line detail is in `critic_report.md` (C-32 to C-37) and `implementation_readiness_report.md` (R-16 to R-18). |
| 🟢 N7 | Step 1 (190) | The local Access skip needs both `DEV_SKIP_ACCESS=true` and `USE_FAKES=true`; the committed `USE_FAKES` is "false". | Confirm in step 1 that `npm run dev` works from a fresh clone using `.dev.vars.example`. |

## 6. Suggested order of work

1. Decide D1-D4. They remove or keep whole mechanisms, and most later edits depend on them.
2. Decide D5 and D6.
3. Write B1 (starting point), then M1-M3. These protect the real account and the first deploy.
4. Edit the feature spec: M4-M11, M14, M15.
5. Rewrite section 5: B2-B4, M9, M12, M13.
6. Nits last.

Whoever does the edits: the same review can be re-run on the edited doc, since this run did no second round.

## 7. Traceability matrix

Raw ids: `ZO-1`/`IC-1` are in `zoom_out_report.md`; `CO-1` in `comprehension_report.md`; `C-` in `critic_report.md` (which maps each to the raw `DC-1`, `ST-1`, `SY-1` reviewer ids); `ZO-2` in `intermediate_zoom_out_report.md`; `R-` in `implementation_readiness_report.md` (which maps each to the raw `IR-1`, `CD-1`, `SY9-1` ids).

| Action | Stage 5 | Stage 6 | Stage 7 | Stage 8 | Stage 9 |
|---|---|---|---|---|---|
| B1 | ZO-1-1 | (paraphrase note) | C-8 | ZO-2-6 | R-1 |
| B2 | | | | | R-2 |
| B3 | | | | ZO-2-13 | R-3 |
| B4 | | | C-19 (checklist) | | R-4 |
| D1 | ZO-1-4, IC-1-1 | | C-1 | ZO-2-1 | R-11 (cron) |
| D2 | ZO-1-3, IC-1-3 | CO-1-13 (H2) | C-19 (hourly read) | ZO-2-1 | R-11 (hourly) |
| D3 | ZO-1-5 | | C-2, C-17 (A3) | ZO-2-2 | R-3 (step 5) |
| D4 | ZO-1-8, IC-1-4 | CO-1-13 (H5) | C-19 | ZO-2-5 | |
| D5 | ZO-1-2, IC-1-6 | CO-1-5 | C-7 | ZO-2-9 | R-3, R-7 |
| D6 | | | C-5 | ZO-2-11 | R-9 |
| M1 | | | | | R-5 |
| M2 | | CO-1-11 | C-33 | | R-6 |
| M3 | | CO-1-4 | C-7 (secret count) | ZO-2-4 | R-7 |
| M4 | IC-1-2 | | C-22 | ZO-2-3 | R-3 (contracts) |
| M5 | IC-1-5 | CO-1-6 | C-4, C-24 | ZO-2-6, ZO-2-10 | R-3 (step 8) |
| M6 | | | C-3 | ZO-2-3 | |
| M7 | | | C-6 | ZO-2-8 | |
| M8 | ZO-1-11 | | C-9, C-30, C-31 | ZO-2-7 | |
| M9 | | | C-14 | ZO-2-11 | R-9 |
| M10 | | CO-1-1, CO-1-8, CO-1-9 | C-12, C-21 | ZO-2-4 | |
| M11 | | | C-10, C-11 | ZO-2-4 | |
| M12 | IC-1-7 | CO-1-3 | | | R-10 |
| M13 | | CO-1-12 | | | R-8, R-11, R-12, R-13 |
| M14 | | CO-1-7, CO-1-10 | C-13, C-15, C-16, C-17, C-18, C-20 | | |
| M15 | | CO-1-2 | C-27, C-37 (CodeRabbit) | ZO-2-12 | R-14, R-15, R-19 |
| N1 | ZO-1-6, ZO-1-7, ZO-1-9 | | | | R-1 (key-version row) |
| N2 | ZO-1-10 | | | | |
| N3 | IC-1-4 | | | | |
| N4 | | | C-23 | ZO-2-10 | |
| N5 | | | C-25, C-26, C-27, C-28, C-29 | ZO-2-4 | |
| N6 | | CO-1-13 (C5) | C-32, C-34, C-35, C-36, C-37 | | R-16, R-17, R-18 |
| N7 | | | | | R-20 |

Every merged finding from the five stage reports appears in at least one row. One raw claim is excluded as wrong: the second half of `CD-1-11` (see "Limits of this review").
