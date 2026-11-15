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
1. **"Up next" banner**, full width. Left: the next calendar event and a countdown to it. With nothing left that day it says "Nothing else today". Right: a big clock and the date.
2. **Three cards side by side:** Today, Later today, This week (habits). The row auto-fits: each card is at least 320px wide (or the full width on a narrower screen), and cards stack on narrow screens. If habit % leaves v1 (`docs/design/v1.md`, C5), the same row holds two cards.
   - **Later today** lists the rest of the day's events after the one in the banner. Past events are hidden (`docs/design/v1.md`, E2).
3. **Action bar**, full width: the Add-to-Next input, the JOB toggle, the Add button, the Restart button. Only the Add button has the accent fill. Restart is a secondary action (`docs/design/v1.md`, D5): an outlined button with no fill.

### Colors

The page has a dark and a light look with the same layout. It follows the device's light or dark setting automatically (`prefers-color-scheme`). There is no toggle in v1.

| Role | Dark | Light |
|---|---|---|
| Page background | `#0B0C0E` | `#F4F2EE` |
| Card background | `#17191C` | `#FFFFFF` |
| Text | `#F2F2F0` | `#17191C` |
| Muted text | `#B7B9BD` | `#55585E` |
| Done / struck-through text | `#8E9196` | `#6A6D73` |
| Control outlines (checkboxes, input, JOB toggle, Restart) | `#8E9196` | `#6A6D73` |
| Card edges and dividers | `#33363B` | `#DDD9D2` |
| Accent | `#FF8A3D` | `#B84A00` |
| Button text on accent | `#1A0E04` | `#FFFFFF` |

The dark colors are the owner's. The light colors are a proposal made to pass the contrast check below; the owner has not confirmed them yet. The light accent is the same orange hue as the dark one (24°), made darker: the dark-mode orange `#FF8A3D` is too pale to read on a light background.

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
- A task whose title has a `(done = …)` part shows a "Done = …" line under it. A task without one shows no second line (`docs/design/v1.md`, A7).
- A checked-off task is struck through in the done color only during the 5-second undo. After that it disappears (`docs/design/v1.md`, A1 and A3).

### Contrast check (WCAG 2.1 AA, done 2026-11-15)

Ratios were calculated with the WCAG relative-luminance formula. AA needs 4.5:1 for text, 3:1 for large text (24px and up, or 18.66px and up in bold), and 3:1 for the outline of a control and for focus marks. Card edges, dividers and the difference between a card and the page are decoration, which AA does not cover.

#### Dark

**Text. Every pair in use passes, at the 4.5:1 level.**

| Text color | On page `#0B0C0E` | On card `#17191C` | Result |
|---|---|---|---|
| Text `#F2F2F0` | 17.46 | 15.71 | Pass |
| Muted `#B7B9BD` | 9.96 | 8.96 | Pass |
| Done `#8E9196` | 6.19 | 5.57 | Pass |
| Accent `#FF8A3D` (the JOB label) | 8.34 | 7.51 | Pass |
| Button text `#1A0E04` on accent `#FF8A3D` | 8.08 | | Pass |

**Outlines and marks (need 3:1). Every pair in use passes.**

| Color | On page `#0B0C0E` | On card `#17191C` | Result |
|---|---|---|---|
| Control outlines `#8E9196` | 6.19 | 5.57 | Pass |
| Accent `#FF8A3D` (Add button, focus mark) | 8.34 | 7.51 | Pass |

**Decoration (no AA requirement).** Card edge `#33363B`: 1.61 on the page, 1.45 on a card. Card against page: 1.11. Because these are low, `#33363B` is never the outline of a control, and the cards are told apart mainly by spacing and their titles.

**Pairs that fail and must not be used together:**

| Pair | Ratio |
|---|---|
| Text `#F2F2F0` on accent `#FF8A3D` | 2.09 |
| Muted `#B7B9BD` on accent | 1.19 |
| Done `#8E9196` on accent | 1.35 |
| Button text `#1A0E04` on page or card | 1.03, 1.08 |
| Card edge `#33363B` as text or as a control outline, on page or card | 1.61, 1.45 |
| Muted on text, done on text, done on muted | 1.75, 2.82, 1.61 |
| Card edge `#33363B` with button text `#1A0E04` | 1.56 |

The remaining pairs pass but are not used: card edge on text 10.82, on muted 6.17, on done 3.84, on accent 5.17; button text on text 16.90, on muted 9.64, on done 5.99.

#### Light

**Text. Every pair in use passes, at the 4.5:1 level.**

| Text color | On page `#F4F2EE` | On card `#FFFFFF` | Result |
|---|---|---|---|
| Text `#17191C` | 15.75 | 17.61 | Pass |
| Muted `#55585E` | 6.38 | 7.13 | Pass |
| Done `#6A6D73` | 4.64 | 5.19 | Pass |
| Accent `#B84A00` (the JOB label) | 4.67 | 5.23 | Pass |
| Button text `#FFFFFF` on accent `#B84A00` | 5.23 | | Pass |

**Outlines and marks (need 3:1). Every pair in use passes.**

| Color | On page `#F4F2EE` | On card `#FFFFFF` | Result |
|---|---|---|---|
| Control outlines `#6A6D73` | 4.64 | 5.19 | Pass |
| Accent `#B84A00` (Add button, focus mark) | 4.67 | 5.23 | Pass |

**Decoration (no AA requirement).** Card edge `#DDD9D2`: 1.26 on the page, 1.41 on a card. Card against page: 1.12. As in the dark look, `#DDD9D2` is never the outline of a control.

**Pairs that fail and must not be used together:**

| Pair | Ratio |
|---|---|
| Text `#17191C` on accent `#B84A00` | 3.37 |
| Muted `#55585E` on accent | 1.36 |
| Done `#6A6D73` on accent | 1.01 |
| Button text `#FFFFFF` on page or card | 1.12, 1.00 |
| Card edge `#DDD9D2` as text or as a control outline, on page or card | 1.26, 1.41 |
| Muted on text, done on text, done on muted | 2.47, 3.40, 1.38 |
| Card edge `#DDD9D2` with button text `#FFFFFF` | 1.41 |

The remaining pairs pass but are not used: card edge on text 12.52, on muted 5.07, on done 3.69, on accent 3.72; button text on text 17.61, on muted 7.13, on done 5.19.

Two light pairs pass with little room: done text on the page (4.64) and the accent on the page (4.67). Neither color can be made lighter without failing.

### Not chosen yet
- **Spacing** (gaps and padding).
- **Reference screenshots.** The mockups are not in the repo.
- **Smaller parts:** the colors of the habit bar and its 70% line, how the Work Block is marked, and the look of the focus mark.
