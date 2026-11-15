**What this proposes**

Life Hub v1 is one private web page, served by a single Cloudflare Worker, that shows five things. These are today's Google Calendar events, the tasks in a TickTick project called "Today" with checkboxes, a box that adds a task to a TickTick project called "Next", weekly percentages for three habits, and a Restart button. Restart moves leftover Today tasks back to Next and adds one fixed "Minimum task". The hub reads everything live and stores only encrypted OAuth tokens and a short-lived login state. Only the owner can open it: Cloudflare Access with GitHub sign-in sits in front, and the Worker re-checks the Access token on every request. It is built in ten branches, four of them treated as security-related, and five facts are left to confirm during the build.

**How the existing system works, per this document**

This paraphrase is largely inferred, because the document never describes the existing system directly (see finding CO-1-1). There appears to be no existing hub software. The "system" is the owner's personal routine, kept in TickTick and Google Calendar. TickTick has projects named Today (limit of three tasks), Next and Someday. Today is picked in a morning routine, and a weekly "Sunday Reset" reviews things. Three habits are tracked in TickTick, and the calendar has a "Work Block" at about 10:30 after a phone-free morning. The document says this system "already works without" the hub, and that the hub is a portfolio project.

---

# Stage 6: Comprehension Test Report

**Target:** `docs/design/v1.md` (FeatureRange lines 1-187, DetailedRange lines 188-214)
**Reviewer context:** none. The reviewer read the design document alone.

## Reviewer Status

| Reviewer | Status | Findings |
| --- | --- | --- |
| `egm-comprehension` | completed | 0 Blocker, 5 Major, 8 Nit |

Author check: compare the two paraphrases above with your intent. A wrong paraphrase is itself a finding. One point to check: the reviewer inferred that "there appears to be no existing hub software", while the repo already has a working skeleton in `src/` (see `ZO-1-1` in `zoom_out_report.md`). The document gave the reader no way to know that.

Finding ids are `CO-1-n`.

## Findings

### CO-1-1. The owner's existing routine is never described - Severity: Major
* **Affected Scope:** Section 1 (lines 9-26), plus terms used in A2, B2, B3, C2, D1, D2, D5, E2, E4
* **Gap:** Line 20 says "The system already works without it" and D1 shows "The system is back on", but no section says what the system is. These terms are used as known:
  - "Next" (line 14): not called a TickTick project until line 47.
  - "Someday" (line 49): never defined.
  - "the morning routine" (line 49) and "the Sunday Reset" (lines 56, 70): never defined.
  - "limit 3" (lines 36-37): the rule is only stated in section 7 (lines 239, 248), which is out of v1 scope.
  - "the first-step format" (line 48): only inferable from the placeholder text.
  - "Minimum task" (lines 66-67): the text is given, but not its purpose.
  - "Work Block" and "the 10:30 time" (lines 77, 79, 183): nothing says why 10:30 matters, or why hiding the dashboard before it was considered.
* **Rationale & Recommendation:** Half of this test is whether a reader can say how the existing system works, and the reviewer had to assemble it from fragments. Add a short "The system this page sits on" block to section 1, of five to eight lines: the three projects and the limit of three, the morning routine, the Sunday Reset, the three habits, the Work Block and 10:30, the "(done = …)" first-step format, and what the Minimum task is for.

### CO-1-2. Who builds this, and with what tooling, is assumed - Severity: Major
* **Affected Scope:** Section G heading (line 93), G7 (106), section I (120-124), build order (199, 201)
* **Gap:** "The top model" appears three times with no statement of which model, or that an AI agent writes the code at all. Line 106 says "Claude is blocked from reading it" and line 99 names CLAUDE.md, both without introduction. Undefined and unlinked: "TDD skill", `/code-review medium`, `/code-review high`, `/security-review`, "Impeccable" (line 199).
* **Rationale & Recommendation:** A fresh reader cannot tell who performs each build step or what the review gates run. Add two or three sentences before section I or section 5: the build is done by Claude, which model tier "top model" means, which tier does the rest, and what each named command and "Impeccable" is, with a link.

### CO-1-3. Step 3 depends on artifacts the document never introduces - Severity: Major
* **Affected Scope:** Build order steps 3 and 10 (lines 192, 199)
* **Gap:** "Pick the mockup and fill in the Target section of `DESIGN.md`" is the only mention of mockups or of `DESIGN.md`. The document does not say where the mockups are, how many exist, who picks, or what the Target section must contain.
* **Rationale & Recommendation:** This is a gating prerequisite for step 3 that a reader cannot act on. Link `DESIGN.md` and the mockups, and state in one line what "Target section filled in" means.

### CO-1-4. The build order omits the account and setup work it depends on - Severity: Major
* **Affected Scope:** Section 5 (lines 188-214), relying on F3, G1-G4b and the config line (87, 97-101, 148)
* **Gap:** The steps are code branches only. No step covers:
  - creating the Cloudflare Access application and the GitHub OAuth app (F3);
  - registering the TickTick and Google OAuth apps with their redirect URIs, and setting the Google app to "In production" (G4b);
  - creating the KV namespace and setting the five secrets (G3);
  - the first deploy, which G7 and the confirm table need because real logins only work on the deployed Worker;
  - finding the project, habit and calendar IDs for config. The hub never lists calendars (line 100) and the habit list API "can leave some out" (line 55), so the lookup is not obvious.

  The "short manual checklist" run after each deploy (line 120) is also not defined or linked.
* **Rationale & Recommendation:** The reader is told what to build but not what must exist first, or who does it. Add a "Before step N" setup list or a setup row per step, mark each item as owner or builder, and say how the IDs are obtained. (Note from the orchestrator: `docs/setup-runbook.md` exists in the repo and likely covers part of this, but the design doc does not link it.)

### CO-1-5. Where config lives is stated three inconsistent ways - Severity: Major
* **Affected Scope:** Lines 148 and 150, with F4 (line 88) and the hard rule on line 23
* **Gap:** Line 148 says config is "in `wrangler.jsonc` vars or KV". Line 150 says to keep the IDs out of the repo, in "Worker vars that aren't committed, or in KV". Line 88 says "uncommitted Worker vars". The reader cannot tell whether `wrangler.jsonc` is committed, which values go where, or whether "or" is an open choice in a document that says all decisions are settled. If KV is used, line 23's "the only things kept are encrypted tokens and a 10-minute login state" is no longer accurate, since config includes habit display names.
* **Rationale & Recommendation:** Pick one location per config item and state it once. If KV holds config, add it to the line 23 list.

### CO-1-6. Restart: "every" task against "it stays" - Severity: Nit
* **Affected Scope:** D1 and D3 (lines 66, 68)
* **Gap:** Step (1) "moves every unfinished Today task", but later in the same cell an existing Minimum task "stays". D3's confirm text does not cover Today holding only the Minimum task, or say whether "Move 3 tasks" counts it.
* **Recommendation:** Write "every unfinished Today task except an existing Minimum task", and say what the count includes.

### CO-1-7. "Today" has two meanings - Severity: Nit
* **Affected Scope:** Line 146 against A1 (line 36)
* **Gap:** Line 146 says "'Today' everywhere means midnight to midnight", but A1 defines Today as a TickTick project and explicitly not a date filter. Line 134, "Today's unfinished tasks", could be read either way.
* **Recommendation:** Limit line 146 to the calendar and habit sections.

### CO-1-8. The Worker and "token" are used before they are introduced - Severity: Nit
* **Affected Scope:** D1 (line 66), F1 (85), sections F and G
* **Gap:** "The Worker re-reads Today" appears 19 lines before F1 introduces the Worker. F1's "the token check" points forward to F4. "Token" means the Access JWT in section F and the provider OAuth tokens in section G.
* **Recommendation:** Add one architecture sentence to section 1 (browser page, one Worker, TickTick and Google behind it), and say "Access token" or "provider token" each time.

### CO-1-9. Undefined proper nouns - Severity: Nit
* **Affected Scope:** E3 (line 78), E1 (76), line 220
* **Gap:** "The Akimart" and "the old Class Calendar" are never explained.
* **Recommendation:** Add a few words for each, for example what kind of device the Akimart is.

### CO-1-10. Unlinked sources and process terms - Severity: Nit
* **Affected Scope:** Lines 3-5, 22, 104-105, 177
* **Gap:** "Grill-me session", "EGM review", "Life Hub design notes", "the independent review" and "the draft" are cited without a link or a one-line description.
* **Recommendation:** Link each, or describe it in a clause.

### CO-1-11. F5's list of data-changing routes is shorter than the API sketch - Severity: Nit
* **Affected Scope:** F5 (line 89) against lines 140-141 and G1 (97)
* **Gap:** F5 names three POST routes: complete, add, restart. Section 3 has five. G1 applies the F5 checks to connect, but nothing says so for disconnect.
* **Recommendation:** List all five in F5, or say "every POST route".

### CO-1-12. "Refresh" has three meanings - Severity: Nit
* **Affected Scope:** G5, G6c, H1, step 9 (lines 102, 105, 112, 198)
* **Gap:** It means the Google token refresh, the page data refresh, and the refresh button. "Automatic refresh" in step 9 is ambiguous next to "the refresh cron" in step 2.
* **Recommendation:** Call step 9's item "automatic page refresh (H1)".

### CO-1-13. Three thin explanations - Severity: Nit
* **Affected Scope:** H2 (line 113), H5 (116), C5 (59)
* **Gap:**
  - H2: the hourly TickTick check writes only to logs and the page ignores it, so its purpose is unstated.
  - H5: "One request per upstream call needed (one per listed calendar) per refresh" is hard to parse.
  - C5: "No personal API token" assumes the reader knows TickTick offers one as an alternative.
* **Recommendation:** Add one clause of explanation to each.
