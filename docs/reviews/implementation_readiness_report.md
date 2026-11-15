# Stage 9: Implementation Readiness Report

**Target:** `docs/design/v1.md` (DetailedRange, lines 188-214: "5. Build order" and "To confirm during the build")
**Standard:** `implementation-readiness-standard` for the readiness and codebase reviewers; none for style
**Reviewer context:** `DESIGN.md`, `CLAUDE.md`, `docs/setup-runbook.md`, `wrangler.jsonc`, `src/`. The codebase reviewer also read `public/`, `test/`, `package.json`, `vitest.config.ts`, `.github/workflows/ci.yml`, `.gitignore` and `README.md`.
**Round:** 1 of 1. The consolidated mode runs one audit round and applies no fixes.

## Verdict

**Not implementation-ready.** Section 5 is a sound ordering of ten features, but it is a list of titles, not a plan. It fails the standard's three requirement areas (file boundary, actionable steps, test plan) and its Zero-Decision Rule. The main cause is that the plan reads as a build from nothing, while the repo already holds a working starter that the plan never mentions and that disagrees with the spec in several places.

Counter-view to weigh: the standard assumes the plan is handed to an implementer who may make no decisions. `CLAUDE.md` says the building agent owns the design and reads this file before each feature, with test-first work per branch. Under that workflow, per-step file lists and named test cases could be written at the start of each branch instead of up front. That would answer R-2 and R-4 by policy. It does not answer R-1, R-3 or R-5, which are gaps regardless of who builds.

## Reviewer Status

| Reviewer | Status | Raw findings |
| --- | --- | --- |
| `egm-implementation-readiness` | completed | 4 Blocker, 7 Major, 2 Nit |
| `egm-codebase-details` | completed | 1 Blocker, 9 Major, 3 Nit |
| `egm-style` | completed | 0 Blocker, 8 Major, 7 Nit |

Finding ids are `<reviewer>-<round>-<n>`: `IR-1-n` (implementation readiness), `CD-1-n` (codebase details), `SY9-1-n` (style, this stage). Overlapping findings are merged below as `R-n`, with every source id listed. After merging: 4 Blockers, 9 Major, 7 Nit.

One reviewer claim was checked and is wrong; see "Contested" at the end.

## Prioritized Findings (Blockers -> Major -> Nits)

### R-1. The plan treats existing code as not yet built, and no step owns the places where that code contradicts the spec - Severity: Blocker
* **Reviewer Lens:** `egm-codebase-details` (CD-1-1, CD-1-3), `egm-implementation-readiness` (IR-1-2)
* **Affected Scope:** Section 5, lines 190-199 (all ten steps)
* **Discrepancy Description:** Every step is phrased as new work. Much of it exists with passing tests:

  | Plan step | Already in the repo |
  |---|---|
  | 1. Skeleton, Access check, lockdown headers, tests | `src/index.ts:7-21` (CSP and headers), `src/auth/access.ts:44-77`, `test/access.test.ts`, `test/worker.test.ts`, `public/index.html`, `public/app.js` |
  | 2. Token storage module | `src/crypto/tokens.ts` (AES-GCM, fresh IV, provider bound in, `TokenStore`), `test/tokens.test.ts`. Not yet wired into any route. |
  | 4. Today list (read) | `src/api.ts:82-112`, `src/sources/types.ts:31-38`, `src/sources/fakes.ts` |
  | 5. Complete | `src/api.ts:114-121`, `src/index.ts:52-54`, `public/app.js:36-46` (no undo) |
  | 6. Add to Next | `src/api.ts:123-130`, `src/domain/input.ts`, `public/app.js:60-70` |
  | 7. Habit % | `src/domain/week.ts:46-56`, `public/app.js:50-56` |
  | 8. Restart | `src/api.ts:136-157`, `public/app.js:72-81` |

  The code disagrees with the spec in these places. Several are pinned by passing tests, so test-first work starts green on the wrong behaviour:

  | Spec | Code today | Pinned by |
  |---|---|---|
  | C3: divide by finished days, plus today only if done; "—" on Monday with no check-in | `src/domain/week.ts:48-54` always divides by `weekdayIndex + 1`, so Wednesday with one Monday check-in is 33% (spec: 50%) and an empty Monday is 0% | `test/api.test.ts:45` |
  | C3: a day is done when `value` reaches `goal` | `HabitCheckin` has no `value` or `goal` (`src/sources/types.ts:16-20`); any check-in counts | none |
  | C1: names from config, one request | `src/api.ts:90` calls `listHabits`; `src/env.ts` has no habit-name setting | none |
  | F5: a missing `Origin` is rejected | `src/auth/origin.ts:8-10` accepts a missing `Origin` when `Sec-Fetch-Site` is `same-origin` | `test/domain.test.ts:80-83` |
  | F5: the body must be JSON | complete and restart never read the body (`src/index.ts:51,54`) | none |
  | A5/B2: prefix and label from config | hardcoded `JOB:` in `src/api.ts:103` and `src/domain/input.ts:14-17`, "JOB" in `public/index.html:24` | `test/domain.test.ts:59-63` |
  | B1/B2: text as typed, trimmed, no other validation | `src/domain/input.ts:9-10` collapses inner spaces, strips control characters and rejects over 300 characters | `test/api.test.ts:77-79`, `test/domain.test.ts:52-57` |
  | B1/B2: button disabled while sending, toggle off after add, placeholder | none of the three in `public/app.js:60-70` or `public/index.html:23` | none |
  | D1: named message if the add fails | a failed add throws and becomes a generic 500 (`src/api.ts:151`, `src/index.ts:66-69`) | none |
  | D1 / API facts line 159: one move call with an array | one call per task (`src/api.ts:143-150`, `src/sources/types.ts:35`) | `test/api.test.ts:107-116` |
  | D3: confirm in the page, with the count | browser `confirm()` with fixed text (`public/app.js:73`) | none |
  | D5: button says "Restart" | "Restart the day" (`public/index.html:27`) | none |
  | D2: text from config, not hardcoded | hardcoded fallback with different wording (`src/api.ts:20`) | none |
  | Section 3: `/api/calendar`, `/api/tasks`, `/api/habits` | one combined `/api/today` (`src/index.ts:49`, `public/app.js:20`) | `test/api.test.ts:37-59`, `test/worker.test.ts:15-27` |
  | G2: each record carries a key-version label | Envelope has a format version `v1` (`src/crypto/tokens.ts`); unclear if these are the same thing | none |
  | Section 3 config list | `src/env.ts` and `readConfig` have no calendar IDs, Work Block title, tag prefix/label or habit names | none |

* **Rationale & Recommendation:** An implementer must choose between rebuilding, keeping and modifying for each step. One who finds passing tests for step 7 may conclude it is done when its logic is wrong. Add a "starting point" paragraph. For each step, state what is reused as is, what is changed (including the tests to rewrite) and what is new. Say in which step `/api/today` is split and removed. State that no new dependency is needed: `jose` is already in `package.json` and WebCrypto covers PKCE. (Same root issue as `ZO-1-1` and `C-8`. Stage 8's `ZO-2-6` adds that the skeleton should win on some rows, such as the per-task move and the membership check.)

### R-2. No file list, no Create / Modify / Delete marks, no branch names - Severity: Blocker
* **Reviewer Lens:** `egm-implementation-readiness` (IR-1-1, IR-1-13), `egm-codebase-details` (CD-1-2), `egm-style` (SY9-1-14)
* **Affected Scope:** Lines 188-199. The only path named in the range is `DESIGN.md` (line 192).
* **Discrepancy Description:** The standard requires exact repository-relative paths per step, precise enough to enforce a write allowlist. The plan gives none. "(each one a branch)" gives no names, while `CLAUDE.md` requires `feat/<name>` and says "one feature per branch"; steps 2 and 9 each hold several features.
* **Rationale & Recommendation:** Give each step a created / modified / deleted list and a branch name. Write the heading as "Build order (one branch per step)".

### R-3. Each step is a title, so the implementer must make the design decisions - Severity: Blocker
* **Reviewer Lens:** `egm-implementation-readiness` (IR-1-3), `egm-codebase-details` (CD-1-6)
* **Affected Scope:** Lines 190-199
* **Discrepancy Description:** Section 2 settles behaviour, but the plan does not turn it into concrete steps. Left open:
  - **API contracts (steps 3-8):** no request or response shape, status code or error code for any route. The page cannot tell "token expired" (Reconnect banner) from "provider down" (retry) without defined codes. F5 requires a JSON body, but `POST /api/tasks/:id/complete` and `POST /api/restart` have no body defined.
  - **Config (steps 1-8):** "`wrangler.jsonc` vars or KV" is not chosen. No variable names or formats for calendar IDs, habit names, Work Block title or tag prefix and label.
  - **Step 2:**
    - Routing: any non-API GET goes to static assets and any non-API POST returns 405 (`src/index.ts:58-59`). The plan does not say whether `/setup` is a static file or Worker-rendered, or where the five new routes go.
    - Connect response: the CSP has `connect-src 'self'` and `form-action 'self'`, and F5 requires a JSON body, so a plain form post that redirects to the provider is ruled out. The route most likely has to return the provider URL for the page to navigate to.
    - Login state: KV key and record layout, cookie name, where the PKCE verifier is kept, and how "single-use" holds on an eventually consistent store.
    - Settings: `Env` has no OAuth client IDs or secrets and nothing for the fixed `redirect_uri` or the hub's own address.
    - Cron write: `TokenStore.put` overwrites the whole record, so the cron must carry the refresh token forward when Google returns none.
    - Google access token: where it is stored and how a page request treats an expired one.
    - Disconnect: what happens if the provider's revoke call fails.
    - Dependency: hand-written OAuth or a library.
  - **Step 3:** the key used to spot one event in two calendars, the Work Block match rule (exact or case-insensitive), and what shows if one of several calendars fails.
  - **Step 5:** how a pending completion is sent when the page is hidden or closed, while still carrying `Origin` and a JSON body.
  - **Step 8:** one batch move or one call per task, what happens when some moves fail, and how the page flushes pending completions first.
  - **Step 9:** the retry gaps, the 429 back-off, and which TickTick read the hourly check uses.
* **Rationale & Recommendation:** For each step, write the route contract, the config names, the interface changes, and the logic per file. (Stage 8's `ZO-2-3` proposes a four-row response table that would settle the API-contract part. Its `ZO-2-1`, `ZO-2-2` and `ZO-2-5` would remove several of these questions by cutting the cron, the undo and the retries.)

### R-4. No test plan, and the shared test files cannot support the spec - Severity: Blocker
* **Reviewer Lens:** `egm-implementation-readiness` (IR-1-4), `egm-codebase-details` (CD-1-10)
* **Affected Scope:** Lines 190-199; line 201
* **Discrepancy Description:** The only mention of tests is "+ tests (no real APIs)" on step 1. The standard requires named test cases per step. Testable edges that no step lists include: Monday with no check-in shows "—"; Restart pressed twice changes nothing; a used or expired `state` is rejected; a TickTick record cannot be read as the Google record; a missing `Origin` is rejected; `invalid_grant` triggers one re-read of KV; an event in two calendars shows once; the count line appears only above 3 tasks. Test infrastructure gaps: no helper for mocking outbound provider calls (G7 requires login tests "with mocked providers"); `src/sources/fakes.ts` cannot simulate value/goal check-ins, a batch move, or events from several calendars; `vitest.config.ts:10-15` supplies no `TOKEN_ENC_KEY` or client IDs; `test/env.d.ts` declares only `TOKENS` and `ASSETS`.
* **Rationale & Recommendation:** Add a test list to each step, naming the test file and the cases, plus the changes to the shared test files. Write out the "short manual checklist run after each deploy" from section I; it does not exist yet.

### R-5. Steps 3 and 4 do not leave the deployed Worker in a stable state - Severity: Major
* **Reviewer Lens:** `egm-codebase-details` (CD-1-4)
* **Affected Scope:** Lines 192-193; `src/index.ts:38-55`, `src/api.ts:22-48`
* **Discrepancy Description:**
  - **Step 3 (calendar):** every `/api/*` request calls `resolveSources`, which throws "TickTick not connected" whenever fake data is off (`src/api.ts:42-48`). `readConfig` also returns "not configured" without the TickTick project IDs. The calendar would answer 503 on the deployed Worker until step 4.
  - **Step 4 (Today read):** `TaskSource` requires all six methods, and the complete, add and restart routes and buttons already exist. Once a real TickTick client is plugged in, those write paths are live against the real account before steps 5, 6 and 8 are built or security-reviewed, and without the undo or the in-page confirm.
* **Rationale & Recommendation:** State in step 3 that source resolution and config become per provider. State in step 1 or 4 whether the write routes and buttons are removed until their steps, or made to refuse. Of the Major findings, this one has the most direct safety consequence: unreviewed write code reaching a real account.

### R-6. "The shared POST checks are built there" (step 5) is wrong on two counts - Severity: Major
* **Reviewer Lens:** all three (IR-1-5, CD-1-5, SY9-1-2)
* **Affected Scope:** Line 201; lines 191, 194; `src/index.ts:34`, `src/auth/origin.ts`
* **Discrepancy Description:** The same-origin check already exists and runs on every non-GET request. Step 2 also needs it first, because G1 makes `/setup/connect/:provider` and `/setup/disconnect/:provider` POSTs "with the same checks as F5".
* **Rationale & Recommendation:** Move the F5 tightening (reject a missing `Origin`, require a JSON body) into step 1 or 2. Correct the reason step 5 is security-related, or decide whether it still is.

### R-7. Account setup and deploy work is missing, and the committed config disagrees with the spec - Severity: Major
* **Reviewer Lens:** all three (IR-1-6, CD-1-7, SY9-1-7)
* **Affected Scope:** Lines 190-193, 209-213; `wrangler.jsonc`, `src/env.ts`
* **Discrepancy Description:** Rows 210, 212 and 213 need "the deployed Worker", yet no step covers the first deploy, the Access application and GitHub sign-in, setting the secrets and uncommitted vars, registering the Google and TickTick OAuth apps with their callback addresses, or moving the Google app to "In production" (G4b). Step 1 says "(no real APIs)", which reads as the opposite. Config gaps:
  - `wrangler.jsonc:10` has `"workers_dev": false` and no route, so a deploy has no public address. F2 says the hub lives on workers.dev.
  - `wrangler.jsonc:18` has a KV binding with no `id`. The plan does not say how the namespace is created, or whether that ID may sit in a public repo.
  - `wrangler.jsonc:22` commits `ACCESS_TEAM_DOMAIN: ""`. The codebase reviewer's understanding is that `keep_vars` protects only variables the file does not define, so each deploy would likely blank it and the Worker would refuse everything. This is unverified; check it at step 1.
  - `wrangler.jsonc:2-3` and `src/env.ts:10-13` treat `ACCESS_AUD` and `ALLOWED_EMAIL` as secrets, making seven. G3 says exactly five.
  - Line 209 calls "running Worker code first" and "preview URLs off" unverified, but `wrangler.jsonc:11,16` already set both.
* **Rationale & Recommendation:** Add an explicit deploy-and-configure step with the exact `wrangler.jsonc` and `src/env.ts` changes and variable names. Mark each task as owner-manual or agent-run, since `CLAUDE.md` forbids deploying or setting secrets without asking. Reword line 209 to "verify the existing values". Reword "(no real APIs)" to "tests use fakes; no TickTick or Google calls". (Stage 8's `ZO-2-4` says the account steps belong in `docs/setup-runbook.md` with one link from here; the config changes still need a step.)

### R-8. No step has its own finish line, and the global one cannot apply to steps 2 and 4 - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness` (IR-1-7)
* **Affected Scope:** Lines 190-199
* **Discrepancy Description:** The only "done" rule is in section I: tests, typecheck, and hitting the changed route locally. G7 says real logins work only on the deployed Worker, so the OAuth callbacks and the cron cannot meet that rule.
* **Rationale & Recommendation:** Give each step an exit check. For steps 2 and 4, say what is verified with mocks, what is verified after deploy, and who does it.

### R-9. The "To confirm" checks have no expected answer, no outcome and no way to be run - Severity: Major
* **Reviewer Lens:** all three (IR-1-8, CD-1-9, CD-1-13, SY9-1-5, SY9-1-6, SY9-1-11)
* **Affected Scope:** Lines 193, 205-213
* **Discrepancy Description:**
  - The intro promises a correction "if the answer differs", but there is no column for the assumed answer. Three rows are open-ended, so there is nothing to differ from.
  - Only the habit check has a fallback, and even there the plan does not say what is removed (step 7, `/api/habits`, the habit code in `week.ts`, `types.ts`, `fakes.ts`, the page section).
  - Line 209 holds six Cloudflare settings across two steps in one row. These are documentation lookups that can be resolved before the build.
  - Lines 210 and 212: G7 keeps real tokens off the laptop, so each check runs inside the deployed Worker, where no code path exists for it. Sending a wrong PKCE verifier needs a deliberate switch in production login code. Recording token-response field names is an exception to G6's "status codes and timings only", and the row drops G5's "names only, never values" caveat.
  - Line 212: if TickTick returns a refresh token or expiry, G5 says "decide then", a design decision postponed into the build.
  - Line 211 (how a declined event appears) is a documentation lookup, not a live test. The reviewer's recollection is that it is the attendee entry marked `self` with `responseStatus` "declined". That is from memory and needs checking against the events reference.
  - The habit check comes at step 4, but `/api/habits` arrives at step 7.
* **Rationale & Recommendation:** Resolve lines 209 and 211 from the docs now. For each other row, add "Assumed now" and "If it differs" columns citing the decision that changes, say whether the build pauses for the owner, and specify the probe: where it lives, what it logs and when it is removed. Use one row per setting.

### R-10. The mockup gate blocks steps 3-10 and conflicts with steps 1-2 - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness` (IR-1-9), `egm-style` (SY9-1-4), `egm-codebase-details` (CD-1-12)
* **Affected Scope:** Line 192; lines 190, 191, 199
* **Discrepancy Description:** Picking a mockup is an unnumbered precondition inside step 3. The plan does not say who picks, from which candidates, or where the mockups come from; no mockup files exist in the repo. The Target section of `DESIGN.md` exists but is empty. The stated goal is "each section is built once in the final look", yet step 1 builds the page and step 2 builds `/setup` before the look exists. F7's self-hosted fonts also depend on this choice.
* **Rationale & Recommendation:** Make the mockup choice its own numbered step with a checkable output (Target section filled in: name, palette, type, spacing, reference screenshots; font files and their paths). Say what the step 1 page and the step 2 `/setup` page contain before then, and which later step restyles them.

### R-11. Step 9 bundles three unrelated things, and the hourly check has no mechanism - Severity: Major
* **Reviewer Lens:** all three (IR-1-10, CD-1-8, SY9-1-1)
* **Affected Scope:** Line 198; lines 191, 193-197, 209; `wrangler.jsonc:19`, `src/index.ts:73-77`
* **Discrepancy Description:** Failure banners, automatic refresh and the hourly TickTick check share one branch. The committed schedule is `7 * * * *` (hourly) and the handler is a placeholder log. The plan gives no cron expression and does not say how a 20-minute schedule runs the TickTick check only once an hour. "Refresh" names the Google token refresh on line 191 and the page data reload on line 198, so step 9 can be read as token refresh, which step 2 already built. Failure behaviour is split unclearly: the "didn't save" notes and the "Reconnect TickTick" banner belong to features in steps 4-6, but step 9 owns "failure banners", so steps 3-8 ship with undefined error behaviour.
* **Rationale & Recommendation:** State which failure messages ship with each feature step and which wait for step 9. Name the cron expression and the hourly mechanism. Write "token-refresh cron (G6c)" in step 2 and "automatic page refresh (H1)" in step 9. (If the owner accepts Stage 8's `ZO-2-1`, the cron parts of this finding go away.)

### R-12. Step 10 is unbounded, and "Impeccable" is undefined - Severity: Major
* **Reviewer Lens:** all three (IR-1-11, SY9-1-3, CD-1-12)
* **Affected Scope:** Line 199
* **Discrepancy Description:** "Design polish (Impeccable) + accessibility pass" has no file list, no checklist and no finish condition. "Impeccable" appears once in the repo and is defined nowhere; `.claude/skills/` holds only `grill-me`, `grilling` and `test-driven-development`. Read as an adjective it is a subjective quality claim; read as a tool name it has no introduction.
* **Rationale & Recommendation:** If it is a tool, name it as one with a link and say how it is installed. Replace "accessibility pass" with the measurable items in `DESIGN.md`: WCAG AA contrast, 44px tap targets, `prefers-reduced-motion`, no colour-only meaning, readable from 1 m. Name the files in scope and how each check is verified.

### R-13. Step 7 is listed unconditionally, though step 4 can remove it - Severity: Major
* **Reviewer Lens:** `egm-style` (SY9-1-8)
* **Affected Scope:** Lines 193, 196, 213
* **Discrepancy Description:** The habit check is stated in step 4 and again in row 213. The consequence, that habit % leaves v1, appears in neither place.
* **Rationale & Recommendation:** Write step 7 as "Habit % (only if the step 4 check passes; otherwise dropped, see C5)". Keep the check in the table only.

### Nits

| Id | Source | Scope | Issue | Recommendation |
|---|---|---|---|---|
| R-14 | IR-1-12, SY9-1-9 | Line 201 | "The top model" names no model. "Token and login code in steps 2 and 4" has no file list, and `CLAUDE.md` says "Token/auth code", which would include step 1's Access JWT check. | Name the tier once. Once files are listed, mark which ones the top model writes, and say whether step 1's check is included. |
| R-15 | SY9-1-10 | Line 201 | The review rule repeats line 122 and drops "also", so it reads as replacing `/code-review medium`. | Keep the rule in one place and point to it. |
| R-16 | SY9-1-12 | Line 191 | "Without it the calendar stops working an hour after connecting" describes a feature built in step 3. | Write "without it the Google access token expires about an hour after connecting". |
| R-17 | SY9-1-13 | Lines 190-199 | Steps mix noun fragments, a bold imperative and a question, and chain deliverables with "+". Steps 5-8 cite no decision numbers. | One form per step: deliverable, then decision references (A3 for step 5, B1-B2 for 6, C1-C4 for 7, D1-D5 for 8, H1-H4 for 9). |
| R-18 | SY9-1-15 | Lines 193, 199, 205 | "First check with the real token" is ambiguous; "(polish only; …)" repeats line 192; "the design session" is "the grill-me session" on line 3. | State the order of the step 4 checks; cut the repeat; use one name. |
| R-19 | CD-1-12 | Section I (line 123) | Section I promises osv-scanner on every pull request. The workflows under `.github/` run `npm audit` and gitleaks, and no step adds the scanner. Verified by the orchestrator with a search of `.github/`. CodeQL is also not in a workflow file; it may be switched on in the GitHub repo settings, which was not checked. | Add the scanner in step 1 or correct section I. |
| R-20 | CD-1-11 | Line 190; `src/auth/access.ts:30`, `wrangler.jsonc:23` | The local Access skip needs both `DEV_SKIP_ACCESS=true` and `USE_FAKES=true`, and the committed value of `USE_FAKES` is "false". No one could check whether a local `.dev.vars` sets them, since that file is off limits. | Confirm in step 1 that `npm run dev` works from a fresh clone using `.dev.vars.example`. |

## Contested

* **CD-1-11, second half ("`.dev.vars.example` is not in the repo"): wrong.** `git ls-files` shows `.dev.vars.example` is tracked, and `.gitignore` has `!.dev.vars.example`. The reviewer could not see it because access rules hide `.dev.vars*` paths from reviewers. The first half of the finding (the two settings the local skip needs) stands as R-20.

## Not verified

* No reviewer had web access. Statements about Cloudflare's `keep_vars` behaviour (R-7) and Google's declined-event format (R-9) are the reviewers' recollection.
* No reviewer ran the tests or `wrangler dev`. Claims that tests are passing come from reading the test files, not from a run.
