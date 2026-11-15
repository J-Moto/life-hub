# Stage 8: Intermediate Zoom Out Report

**Target:** `docs/design/v1.md` (full file, lines 1-255)
**Standard:** `zoom-out-standard`
**Reviewer context:** `DESIGN.md`, `CLAUDE.md`, `docs/setup-runbook.md`, `wrangler.jsonc`, `src/`, plus the Stage 5, 6 and 7 reports
**Note:** The design doc was not edited between stages (consolidated mode applies no fixes). This pass therefore judges the additions that Stages 6 and 7 recommend, instead of re-checking applied edits.

## Reviewer Status

| Reviewer | Status | Findings |
| --- | --- | --- |
| `egm-zoom-out` | completed | 0 Blocker, 6 Major, 7 Nit |

Finding ids are `ZO-2-n`. Ids starting `ZO-1`/`IC-1` refer to `zoom_out_report.md`, `CO-1` to `comprehension_report.md`, and `C-` to `critic_report.md`.

## Summary

The core architecture holds: one Worker, Access plus the in-Worker JWT check, encrypted tokens in KV, live fetch with no cache. Rules pile up in three places: the cron refresh, the 5-second undo, and automatic retries. Stages 6 and 7 mostly propose more rules in those same places. The reviewer's position is that in each case the cheaper fix is to cut the mechanism. That is a recommendation for the owner to weigh, not a settled result: the undo and the cron were both deliberate decisions in the design session.

The reviewer had no web access, so provider facts are taken as the doc states them.

## Prioritized Findings (Blockers -> Major -> Nits)

No Blockers.

### ZO-2-1. v1 needs no cron at all; reject the C-1 marker - Severity: Major
* **Affected Scope:** F1 (line 85), G5 (102), G6c (105), H2 (113), build steps 2 and 9 (191, 198), "To confirm" cron row (209)
* **Concerns:** ZO-1-4/IC-1-1, ZO-1-3/IC-1-3, C-1, C-14, C-19, C-28, C-34, CO-1-12, CO-1-13
* **Discrepancy Description:** Stage 5 raised the two cron jobs separately. Together they show the cron has no job left in v1. C-1 asks for a "needs reconnect" marker or a record delete so the cron can signal the page; that adds a stored item and a cron-to-page channel to support a design whose premise (token rotation) the doc's own facts table does not support (line 172). IC-1-1 option 2 (two records per provider) is also more machinery than needed.
* **Rationale & Recommendation:**
  - Make `/setup` the only writer to KV.
  - Have the calendar request mint a Google access token from the stored refresh token and not store it.
  - Drop the hourly TickTick check until v1.1 gives it a consumer.
  - This removes the cron-versus-setup race, the "cron failed for an hour" banner, the `invalid_grant` re-read and the 20-minute cron check. `invalid_grant` then reaches the page directly as "Reconnect".
  - Cost: one extra Google call per calendar read. An in-memory memo like `jwksCache` in `src/auth/access.ts` can wait until needed.
  - Add one "To confirm" row at step 2: does Google ever return a new refresh token? If yes, reopen this.
  - v1.1 can add a cron trigger back with one config line.

### ZO-2-2. C-2 adds three more rules to the undo; cut it or use one blocking rule - Severity: Major
* **Affected Scope:** A3 (line 38), D1 (66), H1 (112), Section I (120)
* **Concerns:** ZO-1-5, C-2, C-17, IC-1-5, C-4
* **Discrepancy Description:** The undo already needs a per-task timer, a flush on hide or close, and a flush before Restart. C-2 adds merging refresh results with pending rows, Restart waiting for flushes and stopping on failure, and a stated page-close failure mode. All of it lives in the page, and Section I names a test approach only for the Worker.
* **Rationale & Recommendation:**
  - Preferred by the reviewer: send the completion at once. A mis-tap is fixed by un-checking in the TickTick app. C-2, C-17's A3 part and D1's "sent first" rule all disappear.
  - If the owner keeps the undo, replace C-2's three rules with one: while any completion is pending, page refreshes are skipped and Restart is disabled. Reword A3 as C-17 suggests.

### ZO-2-3. The Worker-to-page response contract is missing, and four recommendations depend on it - Severity: Major
* **Affected Scope:** H3, H4 (lines 114-115), Section 3 (128-144), build step 9 (198)
* **Concerns:** IC-1-2/C-22, C-1, C-3. Not raised by Stages 5-7.
* **Discrepancy Description:** The doc describes banners per feature but never says which response from the Worker means which page state. The skeleton already has the start of this: `not_connected` with a provider, and `not_configured` (`src/index.ts` lines 43-47).
* **Rationale & Recommendation:** Add one four-row table to Section 3 instead of per-feature prose.

  | Page receives | Page shows |
  |---|---|
  | Auth failure from the hub itself | One page-level "Sign in again" link that reloads; no "didn't save" |
  | `not_connected` plus provider | "Reconnect" banner for that provider |
  | `not_configured` | A fixed setup message |
  | Any other failure or timeout | "didn't answer" for reads, "didn't save" for writes |

  - Build the page's one fetch wrapper at step 1, not step 9.
  - This shrinks IC-1-2 to one row. Keep its "To confirm" row on what an expired Access session returns to a background request.
  - Reject C-3's split into "definitely failed" and "unknown". Accept the duplicate-add risk in one sentence and adopt C-3's rewording of H3.

### ZO-2-4. Stage 6 and 7 additions would grow the file the builder reads before every feature - Severity: Major
* **Affected Scope:** Whole file; Sections 1, 3, 4, 5 and I
* **Concerns:** Conflicts with ZO-1-10 and ZO-1-11
* **Discrepancy Description:** The two stages propose about nine new blocks or tables. Several restate content that already lives in `CLAUDE.md`, `DESIGN.md` or `docs/setup-runbook.md`. C-30 already shows what happens to restated lists: Section 4 drifted from D2.
* **Rationale & Recommendation:**

  | Id | Verdict | What to do instead |
  |---|---|---|
  | CO-1-1, C-21, CO-1-8, CO-1-9 | Needed, merge | One block of about eight lines in Section 1 covering the routine, the terms and one architecture sentence. Not a block plus a glossary. |
  | C-12 | Shrink | The architecture sentence above is enough for a one-Worker system. Re-heading config and API facts is fine; add no flow diagrams. |
  | CO-1-2 | Shrink | One sentence pointing to `CLAUDE.md`, which already defines the model tiers and review commands. |
  | CO-1-3 | Shrink | A link. `DESIGN.md` already says what the Target section holds. |
  | CO-1-4 | Reject in this doc | Account setup, first deploy and ID lookup belong in the runbook. Add one link. |
  | C-10 | Shrink | Add the missing one-clause reason inline (KV as store, emailed code, smart filter). If a home is required, reuse the Section 4 slot for at most five architecture-level lines. |
  | C-11 | Shrink | Three sentences on trust limits: the Cloudflare account and GitHub are the trust roots; KV encryption does not protect against account compromise; a one-month session can write to TickTick. Reject mirroring the "To confirm" table and the plan-limits analysis. |
  | C-25 | Reject | Section 1's five items and Section I's gates already define done. |
  | C-26 | Reject | Section 1 is 18 clear lines; new sub-headings add nothing. |
  | C-28 | Reject | Renumbering is churn. ZO-2-1 removes G6c and the split with it. |
  | C-29 | Shrink | Cut rules first (ZO-2-1, ZO-2-2, ZO-2-5), then see which cells are still long. |
  | C-13 | Shrink | Delete references to sources not in the repo; do not invent links. Fix the TickTick URL and remove line 5. |

### ZO-2-5. C-19 asks for implementation numbers; most of it dissolves by cutting - Severity: Major
* **Affected Scope:** H3 (line 114), H5 (116), F7 (91), B1 (47), H2 (113)
* **Concerns:** C-19, ZO-1-8
* **Discrepancy Description:** C-19 wants retry intervals, a backoff ceiling, a minimum refresh interval, a named endpoint and the full policy string. That is the drop into implementation detail the standard warns against. It also conflicts with ZO-1-8, which says to cut the retries.
* **Rationale & Recommendation:**
  - Cut automatic read retries. A failed section shows its banner and waits for the next regular refresh, so a 429 needs no separate rule and H5 can be deleted.
  - "One small TickTick read" goes with ZO-2-1.
  - For the Content-Security-Policy, point to the existing header in `src/index.ts`.
  - Keep three cheap edits from C-19: define "quiet" once, fix "~70%" against "70%", and name where the manual checklist lives.

### ZO-2-6. C-8's "the doc wins where the skeleton differs" would discard tested behaviour that is safer or simpler - Severity: Major
* **Affected Scope:** Header (lines 1-5), route table (136), F4 (88), F5 (89), D1 (66), move fact (159)
* **Concerns:** C-8, ZO-1-1, C-14, C-4, IC-1-5
* **Discrepancy Description:** C-8 itself says to adopt the skeleton's stricter dev skip, and C-14 says to specify the skeleton's membership check. A blanket "doc wins" rule contradicts both. The reviewer also disagrees with ZO-1-1's suggestion to confirm that TickTick rejects a mismatched project ID.
* **Rationale & Recommendation:** In the "Starting point" note, name a winner per row.
  - **Skeleton wins:** the Today membership check before completing (`src/api.ts` lines 116-118), which costs one read and needs no undocumented TickTick behaviour; the stricter dev skip; Restart's per-task move with one count message (`src/api.ts` lines 143-155), which gives defined partial-failure behaviour and makes C-4's whole and partial failure specs unnecessary.
  - **Doc wins:** reject a missing `Origin`, three read routes, the "today counts once done" habit rule.
  - **Restart:** state the target state once, as IC-1-5 proposed. Leave the subtask question as one "To confirm" row, not a new rule.

### ZO-2-7. C-9 and C-30 conflict on markers - Severity: Nit
* **Affected Scope:** Lines 3-5, all decision rows. Concerns C-9, C-30, ZO-1-11.
* **Rationale & Recommendation:** C-9 adds a second marker type and C-30 removes markers. Drop all checkmarks and keep one status line: "settled, except the items under 'To confirm during the build'".

### ZO-2-8. C-6: fix the sentence, add no behaviour - Severity: Nit
* **Affected Scope:** C3 (line 57). Concerns C-6.
* **Rationale & Recommendation:** Reject "show last week's final figure on Monday": it adds a display state and a second week of reads. Delete "By Sunday evening this equals the full-week number" and say the current day is left out until it is done.

### ZO-2-9. C-7's four-column config table is more than the decision needs - Severity: Nit
* **Affected Scope:** Lines 148-150, G3 (99), F4 (88). Concerns C-7, CO-1-5, ZO-1-2.
* **Rationale & Recommendation:** One rule covers every row: only `TIME_ZONE` and `USE_FAKES` are committed, and everything else is set on the deployed Worker. Drop the KV option and the word "exactly" in G3.

### ZO-2-10. C-23 and C-24: take the option that adds nothing - Severity: Nit
* **Affected Scope:** G6b (line 104), D3 (68). Concerns C-23, C-24.
* **Rationale & Recommendation:** C-23: reject "use a consistent store"; name the KV store and accept the small replay window in one sentence. C-24: word the confirm without a count; the result message already carries the real number.

### ZO-2-11. C-5 and C-14: one sentence and two rows - Severity: Nit
* **Affected Scope:** G5 (line 102), facts tables (152-173). Concerns C-5, C-14.
* **Rationale & Recommendation:** C-5: one sentence in G5 is enough. If the response includes a refresh token, refresh on demand as for Google. If not, and the token lasts less than the Access session, stop and re-scope. C-14: keep only the check-in time zone row and the habit-list row; the others fall away under ZO-2-1 and ZO-2-6, or are asides to delete.

### ZO-2-12. Section I duplicates `CLAUDE.md` - Severity: Nit
* **Affected Scope:** Section I (lines 118-124), line 93, line 201. Concerns CO-1-2, C-27, C-37. Not raised by Stages 5-7.
* **Rationale & Recommendation:** Test-first, review gates and "done means" are stated in both files, so they can drift apart. Keep only the design-specific test decisions here (mocked providers, no live test, manual checklist) and link to `CLAUDE.md` for the rest. That makes C-27's row ids unnecessary.

### ZO-2-13. Two unstated build choices - Severity: Nit
* **Affected Scope:** G1, G6b (lines 97, 104), F1 (85), Section I (120). Not raised by Stages 5-7.
* **Rationale & Recommendation:**
  - The doc does not say whether the OAuth client code is hand-written or uses a library. The repo already depends on `jose`, and `CLAUDE.md` says "prefer none" for new dependencies. State the choice in one clause so both providers are built the same way.
  - The doc does not say what the page is built with or how page logic is tested. If ZO-2-2 and ZO-2-5 are accepted, the page is thin enough that one line will do.

## Checked and found fine as proposed

C-15, C-16, C-18, C-20, C-22 (as shrunk in ZO-2-3), C-31 to C-37, CO-1-6, CO-1-7 and CO-1-11 are cheap wording fixes with no added scope. C-20 is rated Major in Stage 7 but the reviewer rates it a Nit.

## Open disagreements between stages

| Topic | One side | Other side |
|---|---|---|
| The 5-second undo | Cut it (ZO-1-5, ZO-2-2) | Keep it and specify the edge cases (C-2); judged a balanced answer to a real API limit (IC-1 "examined and found balanced") |
| The refresh cron | Remove it and refresh on demand (ZO-1-4, ZO-2-1) | Keep it and add a cron-to-page signal (C-1); or split the token records (IC-1-1) |
| Automatic read retries | Cut them (ZO-1-8, ZO-2-5) | Keep them and give intervals (C-19) |
| Alternatives and risks sections | A few inline clauses and three sentences (ZO-2-4) | Full tables, as the feature-spec standard requires (C-10, C-11) |
| Mismatch between doc and skeleton | Name a winner per row (ZO-2-6) | The doc wins (C-8) |
