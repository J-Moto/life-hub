# Life Hub: after v1

Moved out of [`v1.md`](v1.md) on 2026-11-15 so the v1 design holds only what is being built now.
Nothing in this file is part of v1. Decision IDs such as A4 or D1 refer to `v1.md`.

---

## 1. After v1 (not now)

- **Domain move:** once josephmoto.com is in the Cloudflare account, serve the hub at `hub.josephmoto.com`. That changes the Access application's host and both OAuth redirect URIs, so each provider needs the new callback address registered.
- **v1.1:** a "Hub" Google calendar the Worker writes to (top Today task, "Hub needs attention"), so the Akimart shows it. Needs a second, narrow write scope. A scheduled health check of the TickTick and Google tokens can come back with it; v1 has no cron because nothing would read the result (H2).
- **v1.2:** the weekly security scout (scheduled task) once the repo is live.
- **Later, one at a time, each after a month of daily use:** edit task text on the hub, links to my Claude projects, scrap pad, flowchart map, project planner, smart devices, n8n on a home server, finances last.
- **Later still:** a built-in chat panel using the Claude API. It needs its own design pass first: a new secret (the API key) and a decision on what hub data, if any, the chat can see.
- **Later, possibly:** a phone app that reuses the same `/api/*` routes.
- **Later, possibly:** Bitwarden for passkeys and, if a home server is built, possibly Bitwarden Secrets Manager.
- **Later still:** the smart layer (section 2).

---

## 2. Smart layer (LATER, not v1, don't build now)

Built later with the Claude API and a scheduled agent, after v1 is used daily. Nothing in this section is part of v1.

- **Auto labels:** tags each task (JOB, CLASS, WORK, HOME, etc.) automatically.
- **Priority and due dates:** not every task needs one, but the smart layer may add them. There are two kinds of date. **Hard** dates (exams, meetings, anything clearly fixed) never move. **Soft** dates are flexible and can be set and adjusted automatically. Soft dates and priorities apply automatically and get reviewed in a batch at the Sunday Reset, not with one tap per task (to avoid accept-fatigue). No infinite to-do list.
- **Importance:** judged from context (what the task is, how I talk about it, what else is going on), not only from what I mark.
- **Objectives:** a word dump becomes one objective with steps inside it. Only its next step goes to Next. The hub gets an Objectives view I can click into.
- **Stuck tasks:** notices tasks sitting untouched. Based on its importance judgment it can shrink, re-rank or move low-importance ones automatically, and it suggests changes for important ones.
- **No pile-ups:** Today stays at 3. When Next gets crowded, low-importance items go back to Someday automatically.
- **Breakdowns:** splits big tasks into small first steps sized to the task. If there's a due date, steps are planned backward from it so the work fits before it's due, when possible.
- **ADHD strategies per task:** tiny first step, music during the task, body doubling, timers, "just start for a few minutes", environment setup. Usually avoid suggesting fun-before-boring or rewards-after-completion (they tend not to work for me), but this is not a strict ban.
- **Due-date awareness:** shows what's due soon. Restart flags due-soon tasks instead of quietly moving them. Helps decide skip or make-up when I fall behind.
- **Sunday Reset help:** reviews Someday, Scrap and stuck tasks, re-ranks priorities over time, and batch-reviews the auto-set dates.
- **Progress at four zoom levels:** today, this week (or rolling 7 days), this month and this year, for habits and possibly other goals. Why it works for me: Apple Health shows daily steps with weekly and yearly averages, so a low day just means a bigger day tomorrow, never a reason to quit.
- **Judgment on what counts as progress:** decides on its own whether a task is (a) a plain one-off, (b) one of several tasks toward a bigger progress goal, or (c) something to break into progress steps.
- **Time-window budgets:** shows "time left in this window", like Claude's usage reset countdown, which makes me want to use the current window well. The judgment layer decides which goals get a window, how long it is and when it resets. The Work Block countdown in v1's "Up next" banner is a small first version of this.
- **Tone:** no guilt, ever.

**Open questions (decide when this is designed):**
- **Scrap area:** likely a separate Scrap spot on the hub for dumps that get turned into objectives, instead of filling Someday.
- **Calendar:** Today's max of 3 is for tasks only; calendar events are separate. Decide later whether task steps get placed on the calendar.

**v1 rules this would have to revisit (noted now so they aren't changed by accident):**
- "Stores none of your tasks, events or habit data": objectives, scrap dumps and importance judgments need a home, either inside TickTick or in hub storage.
- Task text would be sent to the Claude API, which is a new place the data goes.
- A4 says v1 only reads and completes; the smart layer edits, re-ranks and moves tasks on its own.
- D1 says Restart moves everything; the smart layer makes it flag due-soon tasks.
