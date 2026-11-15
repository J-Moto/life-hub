# Life Hub: Design

Status: **look chosen by the owner on 2026-11-15** (see Target). The sections above Target are the constraints the look has to meet.

## Where it's seen
- PC browser at the desk, glanced at more than read.
- Phone browser after the work block.
- (The Akimart desk display can't load web pages. It gets a "Hub" calendar in v1.1.)

## Feel
- Calm, glanceable, quiet. The page should lower stress, not add it.
- No streaks, flames, badges or red warnings. Percentages with a 70% line.
- One clear primary action at a time.

## Must
- Readable from about 1 m away on the desk monitor: big time and section headings.
- Dark mode first, light mode supported.
- Works one-handed on a phone: tap targets at least 44px.
- Text contrast passes WCAG AA. Never use color alone to carry meaning.
- Motion is subtle and respects `prefers-reduced-motion`.

## Avoid (AI-slop tells)
- Purple/blue gradients, glassmorphism, emoji icons, generic SaaS hero layouts.
- Inter-everywhere with no type hierarchy.
- Cards inside cards inside cards.

## Target

**Chosen look: mockup C, "Glance board"**, with one change taken from mockup A: a "Done = …" line under each task.

### Layout
1. **"Up next" banner**, full width. Left: the next calendar event and a countdown to it. Right: a big clock and the date.
2. **Three cards side by side:** Today, Later today, This week (habits). The row auto-fits: each card is at least 320px wide (or the full width on a narrower screen), and cards stack on narrow screens. If habit % leaves v1 (`docs/design/v1.md`, C5), the same row holds two cards.
3. **Action bar**, full width: the Add-to-Next input, the JOB toggle, the Add button, the Restart button.

### Colors (dark mode)
| Role | Value |
|---|---|
| Page background | `#0B0C0E` |
| Card background | `#17191C` |
| Text | `#F2F2F0` |
| Muted text | `#B7B9BD` |
| Done / struck-through text | `#8E9196` |
| Borders | `#33363B` |
| Accent | `#FF8A3D` |
| Button text on accent | `#1A0E04` |

### Type
Manrope, weights 400, 500, 700 and 800. The font files are served from `public/fonts/`, so the page makes no request to Google Fonts and the Content-Security-Policy stays as it is.

| Element | Size / weight |
|---|---|
| Banner ("Up next") | 56px / 800 |
| Clock | 72px / 800 |
| Card titles | 22px / 800 |
| Tasks | 18px / 500 |
| "Done = …" line | 15px, muted |
| Habit % | 26px / 800 |

### Shape
- Card radius 20px. Inputs and buttons 14px.
- Checkboxes 24px. Every tap target is at least 48px, so a checkbox's row is the target, not the box alone.

### Tasks
- A **JOB** label in the accent color sits in front of job tasks. It is a word, so the meaning does not rest on color.
- Each task shows a "Done = …" line under its title.
- A task that has been checked off is struck through in the done color.

### Contrast check (WCAG 2.1 AA, done 2026-11-15)

Ratios were calculated with the WCAG relative-luminance formula. AA needs 4.5:1 for text, 3:1 for large text (24px and up, or 18.66px and up in bold), and 3:1 for the outline of a control and for focus marks.

**Text. Every pair in use passes, at the 4.5:1 level.**

| Text color | On page `#0B0C0E` | On card `#17191C` | Result |
|---|---|---|---|
| Text `#F2F2F0` | 17.46 | 15.71 | Pass |
| Muted `#B7B9BD` | 9.96 | 8.96 | Pass |
| Done `#8E9196` | 6.19 | 5.57 | Pass |
| Accent `#FF8A3D` (the JOB label) | 8.34 | 7.51 | Pass |
| Button text `#1A0E04` on accent `#FF8A3D` | 8.08 | | Pass |

**Outlines and marks (need 3:1).**

| Color | On page `#0B0C0E` | On card `#17191C` | Result |
|---|---|---|---|
| Accent `#FF8A3D` (Add button, focus mark) | 8.34 | 7.51 | Pass |
| Done `#8E9196` used as an outline | 6.19 | 5.57 | Pass |
| Muted `#B7B9BD` used as an outline | 9.96 | 8.96 | Pass |
| Border `#33363B` | 1.61 | 1.45 | **Fail** as the outline of a control |

**What follows from the one failure:** `#33363B` is used only for card edges and dividers, which carry no meaning. The outlines of the checkboxes, the Add-to-Next input, the JOB toggle and the Restart button use `#8E9196`. This is a proposal that keeps to the chosen palette; the owner has not confirmed it yet.

**Card against page** is 1.11:1. That is not an AA requirement, because a card edge is decoration, but it means the cards are told apart mainly by spacing and their titles.

**Pairs that fail and must not be used together:**

| Pair | Ratio |
|---|---|
| Text `#F2F2F0` on accent `#FF8A3D` | 2.09 |
| Muted `#B7B9BD` on accent | 1.19 |
| Done `#8E9196` on accent | 1.35 |
| Button text `#1A0E04` on page or card | 1.03, 1.08 |
| Border `#33363B` as text on page or card | 1.61, 1.45 |
| Muted on text, done on text, done on muted | 1.75, 2.82, 1.61 |
| Border `#33363B` with button text `#1A0E04` | 1.56 |

The remaining pairs pass but are not used: border on text 10.82, border on muted 6.17, border on done 3.84, border on accent 5.17, button text on text 16.90, on muted 9.64, on done 5.99.

### Not chosen yet
- **Light mode.** "Must" says light mode is supported; only the dark colors are chosen.
- **Spacing** (gaps and padding).
- **Reference screenshots.** The mockups are not in the repo.
- **Smaller parts:** the colors of the habit bar and its 70% line, how the Work Block is marked, and the look of the focus mark.

### Points where the chosen look and `docs/design/v1.md` need to agree before the build
- **"Done = …" line.** v1.md has no rule for it. Assumed here: it is the `(done = …)` part of the task's title, and a task without one shows no second line. Needs a row in v1.md section A before step 4.
- **Struck-through tasks.** v1.md A1 shows unfinished tasks only, so a checked-off task is on screen only during the 5-second undo (A3). Keeping finished tasks listed for the day would be a change to v1.md.
- **Calendar.** v1.md E2 describes one time list with a "now" line and dimmed past events. This look has an "Up next" banner with a countdown and a "Later today" card. E2 needs updating before step 3b to say what happens to past events and the "now" line, and what the banner shows when nothing is left that day.
- **Restart** is a secondary action in v1.md D5, so only the Add button uses the accent fill.
