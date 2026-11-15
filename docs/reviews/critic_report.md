# Stage 7: Critic Review Report

**Target:** `docs/design/v1.md` (FeatureRange, lines 1-187)
**Standard:** `feature-spec-standard` for the design and structural reviewers; none for style
**Reviewer context:** `DESIGN.md`, `CLAUDE.md`, `docs/setup-runbook.md`, `wrangler.jsonc`, `src/`
**Round:** 1 of 1. The consolidated mode runs one audit round and applies no fixes, so nothing here has been changed in the design doc.

## Reviewer Status

| Reviewer | Status | Raw findings |
| --- | --- | --- |
| `egm-design` | completed | 0 Blocker, 8 Major, 10 Nit |
| `egm-structural` | completed | 0 Blocker, 5 Major, 7 Nit |
| `egm-style` | completed | 0 Blocker, 13 Major, 10 Nit |

Finding ids are `<reviewer>-<round>-<n>`: `DC-1-n` (design critic), `ST-1-n` (structural), `SY-1-n` (style; its Nits are `SY-1-N1` to `SY-1-N10`). Overlapping findings are merged below, with every source id listed. After merging: 0 Blockers, 21 Major, 16 Nit.

No reviewer had web access. The TickTick, Google and Cloudflare facts in the doc were taken as written and not verified.

## Prioritized Findings (Blockers -> Major -> Nits)

No Blockers.

### Design gaps (behaviour that is wrong or undefined)

#### C-1. The page cannot learn that the Google refresh token is dead, and the cron is not the only writer - Severity: Major
* **Reviewer Lens:** `egm-design` (DC-1-3), `egm-style` (SY-1-N5)
* **Affected Scope:** G6c (line 105), H2 (113), H4 (115), G1 (97)
* **Discrepancy Description:** G6c says to re-read KV once on `invalid_grant` "before showing Reconnect". Only the cron refreshes, and H2 sends cron results to logs only. The page sees an expired access token and cannot tell "cron failed, wait" from "reconnect needed". The sentence names no actor: the cron shows nothing. Also, "one place only" is not one writer. `/setup` connect and disconnect write the same record, so a cron run that read the old record can write it back after a reconnect or disconnect, losing the new refresh token or bringing back a revoked one.
* **Rationale & Recommendation:** Define the signal (for example the cron deletes the record or writes a "needs reconnect" marker) and say which banner follows. Then either state the cron-versus-setup race as accepted, or close it.

#### C-2. Pending completions are not reconciled with page refreshes or Restart - Severity: Major
* **Reviewer Lens:** `egm-design` (DC-1-4)
* **Affected Scope:** A3 (line 38), D1 (66), H1 (112)
* **Discrepancy Description:** The 5-second undo lives only in the page. Undefined: a refresh during the window re-fetches a list that still contains the task; hiding the tab sends the completion and returning triggers a read that can race it; a send on page close cannot report failure, so "didn't save" never appears. D1's "sent first" is a page-side step the Worker cannot enforce, and nothing says whether Restart waits for those responses or what happens if one fails. As written, the task is then moved to Next, not completed.
* **Rationale & Recommendation:** Specify that refresh results are merged with pending rows, and that Restart waits for the flushes and stops if one fails. State the page-close failure mode (the task reappears on next load).

#### C-3. "Nothing is done twice" is not true for Add to Next - Severity: Major
* **Reviewer Lens:** `egm-design` (DC-1-5), `egm-style` (SY-1-6)
* **Affected Scope:** H3 (line 114), B1 (47)
* **Discrepancy Description:** A timeout or dropped response after TickTick accepted the create looks like a failure. B1 keeps the text and invites a second tap, which creates a duplicate in a list the hub never shows. Complete and Restart are safe to repeat; create is not.
* **Rationale & Recommendation:** Separate "definitely failed" from "unknown" (timeout or 5xx) and word the unknown case as "may not have saved, check Next", or state the duplicate risk as accepted. Reword H3 to "the hub never repeats a write on its own".

#### C-4. Restart's failure and edge cases are only half specified - Severity: Major
* **Reviewer Lens:** `egm-design` (DC-1-6)
* **Affected Scope:** D1 (line 66), "Restart's move" fact (159)
* **Discrepancy Description:** Only "add fails" is covered. Undefined: the batch move fails entirely or partly (the endpoint's partial-failure behaviour is not in the facts table); and whether subtasks are moved, follow their parent, or stay in Today. "Moves every unfinished Today task" also contradicts the same row's rule that an existing Minimum task stays.
* **Rationale & Recommendation:** Specify the message and resulting state for whole and partial move failure, define the subtask rule, fix the "every" wording, and add the move behaviour to the build-time checks.

#### C-5. TickTick token lifetime is unknown, with no decision rule - Severity: Major
* **Reviewer Lens:** `egm-design` (DC-1-7)
* **Affected Scope:** G5 (line 102), Tokens fact (162)
* **Discrepancy Description:** Four of the five features depend on a token whose lifetime and refresh support are undocumented. The plan is "decide then". C5 has an explicit exit ("habit % leaves v1"); this larger dependency has none.
* **Rationale & Recommendation:** Write the rule now: the lifetime below which manual reconnect is unacceptable, and what happens then (add refresh to the cron if a refresh token exists, otherwise re-scope).

#### C-6. The weekly percentage is wrong when the last day is missed - Severity: Major
* **Reviewer Lens:** `egm-design` (DC-1-8), `egm-style` (SY-1-6)
* **Affected Scope:** C2 (line 56), C3 (57), section 4 item 4 (182)
* **Discrepancy Description:** C3 says the number equals the full-week figure "by Sunday evening". That holds only if Sunday is done. A missed Sunday is never counted: the page shows 5 of 6 (83%) until the week rolls over, while the true figure is 5 of 7 (71%). The Sunday Reset reads an inflated number, and C3's reason for dropping the full-week figure fails.
* **Rationale & Recommendation:** State the bias as accepted, or define when an unfinished day closes (for example, show last week's final figure on Monday).

#### C-7. Where config lives is contradictory, and "exactly five secrets" does not match - Severity: Major
* **Reviewer Lens:** `egm-style` (SY-1-3, SY-1-4), `egm-design` (DC-1-9), `egm-structural` (ST-1-12)
* **Affected Scope:** Lines 148-150; line 23; F4 (88); G3 (99)
* **Discrepancy Description:** Line 148 allows `wrangler.jsonc` vars, a committed file whose own line 1 says "no personal IDs here"; line 150 says keep the IDs out of the repo. "Or in KV" is an open choice, and it would add a third stored thing to the rule that only tokens and login state are kept. Line 148's list omits the three Access settings F4 places in uncommitted vars. G3 says "exactly five Worker secrets", while `wrangler.jsonc` lists seven (including `ACCESS_AUD` and `ALLOWED_EMAIL`) and `src/env.ts` groups those two under "Secrets". The doc uses "Worker secret", "Worker vars that aren't committed" and "uncommitted Worker vars" without saying how they differ.
* **Rationale & Recommendation:** Define config once, before section 2, with one location. Use one table: setting, where it lives, whether it is committed, whether it is a secret. Drop "exactly" or correct the count.

#### C-8. The doc never says how it relates to the existing skeleton - Severity: Major
* **Reviewer Lens:** `egm-style` (SY-1-7), `egm-design` (DC-1-18), `egm-structural` (routed note)
* **Affected Scope:** Header (lines 1-5); F1, F2, F4, F5, G3, A5, C1, C3; section 3 (132-144)
* **Discrepancy Description:** Present-tense statements read as current behaviour, but the repo differs:

  | Doc says | Skeleton has | Location |
  |---|---|---|
  | Three separate GET routes | One combined `/api/today` | `src/index.ts` line 49 |
  | Cron every 20 minutes | Hourly cron | `wrangler.jsonc` line 19 |
  | workers.dev address (F2) | `workers_dev: false` | `wrangler.jsonc` line 10 |
  | Exactly five secrets (G3) | Seven listed | `wrangler.jsonc` lines 2-3 |
  | Missing `Origin` is rejected (F5) | Accepted when `Sec-Fetch-Site` is same-origin | `src/auth/origin.ts` lines 8-10 |
  | Tag prefix from config (A5) | `JOB:` hardcoded | `src/domain/input.ts` lines 14-17 |
  | Today counts only once done (C3) | Today always counted | `src/domain/week.ts` line 48 |
  | Habit names from config (C1) | Names fetched from the API | `src/api.ts` line 90 |

  The skeleton's local-dev skip (`src/auth/access.ts` lines 29-34) is stricter than F4's "request is to localhost"; the doc should adopt the stricter rule.
* **Rationale & Recommendation:** Add one sentence to the header saying the doc describes target behaviour and wins where the skeleton differs, with a list of what changes. (Same root issue as `ZO-1-1` in Stage 5.)

### Spec completeness (required content that is missing or scattered)

#### C-9. The status says everything is settled while the range holds open items - Severity: Major
* **Reviewer Lens:** `egm-structural` (ST-1-4), `egm-style` (SY-1-1)
* **Affected Scope:** Lines 3-5; line 177; against C5 (59), G5 (102), G6b (104), fact rows (161, 162, 173)
* **Discrepancy Description:** Line 3 says "All decisions were settled" and every row has a ✅. Unresolved in range: whether habits can be read at all (C5), "decide then" for TickTick refresh (G5), "Neither provider's docs confirmed PKCE" (G6b), and fact rows marked "to confirm". A reader who trusts the "Open questions" section concludes nothing is open.
* **Rationale & Recommendation:** Narrow the status to "settled, except the items listed under 'To confirm during the build'". Mark C5, G5 and G6b as "settled, pending verification" with a distinct marker.

#### C-10. No place where alternatives are evaluated - Severity: Major
* **Reviewer Lens:** `egm-design` (DC-1-1), `egm-structural` (ST-1-1)
* **Affected Scope:** Section 2 (lines 30-124), section 4 (177-184)
* **Discrepancy Description:** The standard's Alternatives Rule is mandatory. Rejections sit inside table cells and coverage is uneven. Rejected with no reason: "no Durable Object" (G6c), "no tidy option and no choice" (D2), the emailed one-time code (F3), the smart Today filter (A1). No alternative named at all: Workers KV as the token store (G2), Cloudflare and Access as host and gate (F1, F3). Section 4 records six outcomes as "Settled" with no reasoning.
* **Rationale & Recommendation:** Add an "Alternatives considered" table with one concrete trade-off per rejected option: hosting, access gate, token storage, refresh coordination, caching, habit credential, Today source.

#### C-11. No Risks and limits statement - Severity: Major
* **Reviewer Lens:** `egm-design` (DC-1-2), `egm-structural` (ST-1-2)
* **Affected Scope:** Whole range; risk statements at lines 59, 88, 102, 104-105, 113-116, 161-163, 171-173
* **Discrepancy Description:** Mitigations are scattered and the doc never states its own limits. Missing: what the KV encryption defends against, given the key and the ciphertext sit in the same Cloudflare account; the single trust roots (the Cloudflare account, and GitHub as the only sign-in); the exposure of a one-month session on a page that can write to TickTick; which Workers plan is assumed and whether its CPU, subrequest, KV-write and cron limits fit; that production is the only place the real login code ever runs (G7). The only consolidated list of unverified items (lines 203-213) is outside the feature range.
* **Rationale & Recommendation:** Add a "Risks and limits" section with columns for risk, impact, mitigation or "accepted", and owning decision ID. Mirror the "To confirm" table into it and add one line on scale limits.

#### C-12. Architecture has no home, and "3. API sketch" holds five unrelated kinds of content - Severity: Major
* **Reviewer Lens:** `egm-structural` (ST-1-3)
* **Affected Scope:** Section 3 (lines 128-173); sections F, G, H (81-116)
* **Discrepancy Description:** Component layout and data flows must be assembled from F1, F3, F4, G2, G6c, H1, H2 and the route table. "API sketch" contains the route table, a rationale sentence, a glossary definition (line 146), the config inventory, and two tables of third-party API facts.
* **Rationale & Recommendation:** Add a "Proposed architecture" section with a short component list and the three flows (page read, page write, cron refresh). Keep only the route table and its rationale in "API sketch". Promote "Configuration" and "External API facts" to their own sections or an appendix.

#### C-13. Provenance references do not resolve - Severity: Major
* **Reviewer Lens:** `egm-structural` (ST-1-5), `egm-style` (SY-1-N2, SY-1-N9)
* **Affected Scope:** Lines 3, 5, 22, 104, 105, 152, 165, 173, 177
* **Discrepancy Description:** The range contains no hyperlinks. "Life Hub design notes" (no such file in the repo), "the independent review", "the grill-me session" and "the draft" cannot be located. The Google source has no URL. The TickTick source is `developer.ticktick.com/docs/openapi.md` here and `https://developer.ticktick.com/docs#/openapi` in `CLAUDE.md`. Line 173 says "the part of the … page that could be read in full" without saying what was not read. Line 5 ("Next: the EGM review runs on this file") goes stale after this review.
* **Rationale & Recommendation:** Make each a real link (commit, PR, file path, full URL) or add a one-line description. Use one TickTick docs URL in both files. Reword line 173 to "the page was only partly retrieved; PKCE support is unverified". Remove line 5.

#### C-14. API-behaviour claims that drive decisions have no entry in the facts tables - Severity: Major
* **Reviewer Lens:** `egm-style` (SY-1-13), `egm-design` (DC-1-11, DC-1-16)
* **Affected Scope:** C1 (line 55), C2 (56), C6 (60), E1 (76), G6c (105), route table (136)
* **Discrepancy Description:** Stated as fact with no row at lines 152-173: "the API habit list can leave some out"; "The API documents no way to undo a check-in"; "Google's access tokens last about an hour"; that TickTick check-in dates use the configured time zone; and that completing with the Today project ID "can only complete tasks that are in Today", which depends on TickTick rejecting a mismatched project and task. E1's "shows once" names no dedupe key.
* **Rationale & Recommendation:** Add a facts-table row for each with its source and check date, or mark it to confirm during the build. For line 136, specify the membership check the skeleton already does (`src/api.ts` lines 116-118).

### Wording and precision

#### C-15. "Today" has two definitions - Severity: Major
* **Reviewer Lens:** `egm-style` (SY-1-2), `egm-structural` (ST-1-12)
* **Affected Scope:** A1 (line 36); line 146; route table (133-134)
* **Discrepancy Description:** A1 defines "Today" as the TickTick project. Line 146 says "Today" everywhere means midnight to midnight. Lines 133-134 use "Today's" in both senses in adjacent rows.
* **Rationale & Recommendation:** Reserve capitalised **Today** for the project. Rewrite line 146 as "The current day means midnight to midnight in the configured time zone".

#### C-16. The headline rule is quoted three ways, each with an absolute - Severity: Major
* **Reviewer Lens:** `egm-style` (SY-1-5)
* **Affected Scope:** Line 23; G2 (98); H1 (112)
* **Discrepancy Description:** Line 23 says "Stores none of your tasks, events or habit data". G2 and H1 quote it as "stores no data", which is false as written: tokens, OAuth state and status logs are stored. "If the hub is deleted, nothing is lost" omits the tokens and config, which must be re-created.
* **Rationale & Recommendation:** Use one wording everywhere: "stores no task, event or habit data". Replace "nothing is lost" with "no task, event or habit data is lost; both services must be reconnected".

#### C-17. Absolute guarantees contradicted by their own row or lacking evidence - Severity: Major
* **Reviewer Lens:** `egm-style` (SY-1-6)
* **Affected Scope:** A3 (line 38); F1 (85)
* **Discrepancy Description:** A3's "a mis-tap costs nothing" is contradicted in the same cell: a hidden or closed page sends the completion at once and TickTick cannot un-complete. F1's "the one protected workers.dev address is the only way in" rests on Cloudflare settings that line 209 lists as unverified, while `wrangler.jsonc` has `"workers_dev": false`. (The H3, C3 and line 136 parts of this finding are covered in C-3, C-6 and C-14.)
* **Rationale & Recommendation:** Write "a mis-tap can be undone while the page stays open". State F1 as the intended configuration.

#### C-18. "PKCE checked" is stated as fact where the same row says it is unconfirmed - Severity: Major
* **Reviewer Lens:** `egm-style` (SY-1-12)
* **Affected Scope:** G6b (line 104); callback row (142)
* **Discrepancy Description:** "Fixed `redirect_uri`, PKCE checked" and "Finish OAuth (state + PKCE checked)" assert a check. G6b then says neither provider's docs confirmed PKCE. The phrase also hides the actor: the provider verifies PKCE, not the callback route.
* **Rationale & Recommendation:** Reword to "state verified by the Worker; PKCE verifier sent (provider enforcement unconfirmed, see section 5)". Drop "Where a provider ignores it, this doc says so plainly".

#### C-19. Behaviour is specified in terms an implementer cannot test - Severity: Major
* **Reviewer Lens:** `egm-style` (SY-1-10, SY-1-11), `egm-design` (DC-1-14)
* **Affected Scope:** Lines 24, 38, 40, 47, 58, 70, 91, 112-114, 116, 120
* **Discrepancy Description:** "quiet" is used five times without a definition; "a few seconds" (47) has no number; "three times with growing gaps" (114) and "Back off on a 429" (116) have no intervals, ceiling or owner, and the Worker keeps no state to remember a backoff; the tab-visible refresh has no minimum interval; "one small TickTick read" names no endpoint; "A strict Content-Security-Policy" states no policy; "a short manual checklist" has no location; "~70%" (24) differs from "70%" (58). H5 is circular ("one request per upstream call needed") and names no limit.
* **Rationale & Recommendation:** Give the numbers and names. Define "quiet" once, as A2 does. Rewrite H5 as: "Each refresh makes N TickTick requests and one Google request per listed calendar. Neither provider's limit is documented here. On a 429 the section waits X before retrying."

#### C-20. "You", "your" and "I" are ambiguous - Severity: Major
* **Reviewer Lens:** `egm-style` (SY-1-8)
* **Affected Scope:** Lines 23, 39, 76, 87, 88, 101, 114; line 3 uses "the owner"
* **Discrepancy Description:** Three forms for one person. `CLAUDE.md` addresses the building agent as "You are the owner", so "you" in this file can be read as the agent.
* **Rationale & Recommendation:** Use "the owner" throughout the specification text.

#### C-21. Owner-context terms are used without definition - Severity: Major
* **Reviewer Lens:** `egm-style` (SY-1-9), `egm-design` (DC-1-10)
* **Affected Scope:** Lines 14, 20, 48, 49, 56, 66, 70, 76-79, 93
* **Discrepancy Description:** "the system", Next, Someday, morning routine, "from chat", first-step format, Sunday Reset, home reset, Work Block, 10:30, Akimart, old Class Calendar, Minimum task, phone-free morning and "top model" are not defined. "Akimart" is explained only in `DESIGN.md`.
* **Rationale & Recommendation:** Add a short glossary after section 1, one line per term. (Same root issue as `CO-1-1` in Stage 6.)

### Nits

| Id | Source | Scope | Issue | Recommendation |
|---|---|---|---|---|
| C-22 | DC-1-13 | F3 (87), H3-H4 (114-115) | After one month, API calls on an always-open page fail as redirects to the login, and the banners blame TickTick or Google. | Define a "sign in again" state. (Rated Major by the Stage 5 inventive catalyst as `IC-1-2`.) |
| C-23 | DC-1-12 | G6b (104) | KV has no atomic read-and-delete, so single-use `state` cannot be guaranteed. The doc does not say where the state is stored. | Name the store and note the residual risk, or use a consistent store. |
| C-24 | DC-1-15 | D3 (68), D1 (66) | The confirm text uses the page's list while the Worker re-reads Today. The owner can approve "Move 3" and have 5 moved. | Refresh before confirming, or word the confirm without a count. |
| C-25 | DC-1-17 | Line 20 | The goal is a portfolio piece, but nothing says what must be demonstrable for v1 to count as done. | Add a short list of what v1 must be able to show. |
| C-26 | ST-1-6 | Section 1 (9-26) | Problem statement, goals and non-goals exist only as bold run-in labels, with the motivation after the scope. The hard rules mix constraints with a behaviour statement. | Use sub-headings "Problem statement", "Goals", "Non-goals", "Constraints", problem first. |
| C-27 | ST-1-7, SY-1-N8 | Section I (118-124) | A bullet list with no IDs, unlike A to H, so its gates cannot be cited. | Convert to the same table form with I1 to I5. |
| C-28 | ST-1-8, SY-1-N8 | G4b, G6b, G6c (100-105) | G6b and G6c are suffixed under G6 (Logging) but are unrelated to it; the refresh topic is split in two. | Reorder so related rows sit together. If IDs change, update G5, H2 and `CLAUDE.md`. |
| C-29 | ST-1-9, SY-1-N8 | A3, D1, F3, F4, G2, G5, G6b, G6c | Cells hold six to ten sentences and several independent, testable rules. Bold appears in almost every row. | Keep the one-line decision in the table; move rules to a bullet list keyed by ID (D1.a, D1.b). Limit bold. |
| C-30 | ST-1-10, SY-1-N1 | Line 4; all rows; section 4 (177-185) | Every row has a ✅, so it distinguishes nothing. Section 4 restates six decisions and has drifted: item 2 says "One fixed JOB line" where D2 and A5 make the prefix configurable. | Drop the markers or keep them only where status differs. Replace section 4 with a one-line pointer. |
| C-31 | ST-1-11 | Lines 3-5 | Three lines with no break render as one paragraph. | Use a short list or table (Status, Date, Source). |
| C-32 | SY-1-N3 | Lines 20, 25, 26 | "real" is filler; "Few alerts, or they stop working" contradicts "No notifications" in the same bullet; "Nothing carries over as debt" is a metaphor. | Drop or rewrite: "Unfinished Today tasks do not accumulate." |
| C-33 | SY-1-N4 | F5 (89), line 144 | F5 lists three data-changing routes and omits connect and disconnect. "The three GET routes" ignores `/`, `/setup` and the callbacks. | Complete the F5 list. Write "the three `/api` GET routes". |
| C-34 | SY-1-N5 | Lines 91, 98, 104, 105, 115 | Sentence fragments; "Required." does not answer "Two refreshes at once?"; "its banner" does not say which banner. | Name the actor and the banner; answer each question directly. |
| C-35 | SY-1-N6 | Throughout | Term drift: "sign-in" vs "login" vs "connect"; "the hub" means the page, the deployment and the Worker; token state is "refuses", "dead", "expired"; task state is "unfinished", "leftover", "undone". | Use "sign-in" for Access and "connection" for providers; pick one word for each state. |
| C-36 | SY-1-N7 | Lines 66, 86, 104, 112, 113, 150, 179 | Filler: "just", "plainly", "anyway", "for now", "so a stale page is obvious". | Delete; replace line 112 with "so the data's age is visible". |
| C-37 | SY-1-N10 | F3 (87), section I (123), D2 (67), B2 (48) | GitHub 2FA is presented as verified; CodeRabbit is stated as running on every pull request while the runbook calls it "Optional, can wait"; "no tidy option" refers to an alternative the reader never saw; "No other validation" conflicts with B1's empty-box rule. | State 2FA as a requirement; write "if installed"; drop "no tidy option"; write "No format validation". |

## Notes for the author

- The three reviewers agree on the two structural gaps the standard treats as mandatory: alternatives (C-10) and risks (C-11).
- C-7, C-8 and C-21 repeat issues already raised in Stages 5 and 6. They are kept here because each stage reached them independently.
- Counter-view to weigh: several style Majors (C-19, C-20) ask for precision that a one-owner project may judge not worth the edit. The design-gap group (C-1 to C-6) is where an implementer would otherwise have to guess.
