# Design system

What the dashboard looks like and why, so the next page added to it looks like the ones
already here. `app/globals.css` is the only stylesheet; there is no Tailwind, no CSS-in-JS,
no component library. Everything below is a class in that file.

`README.md` explains how the system works. `STATE.md` records what is true right now.
This file is the visual contract.

---

## The idea in one paragraph

A dense reporting surface that stays quiet. Warm off-white paper rather than blue-grey, one
family of rounded rectangles, and colour spent only where it changes a decision — a bounce
rate over the stop-threshold, a reply worth chasing, which of the two vendors a number came
from. Numbers are the loudest thing on any page. Everything else recedes.

---

## Tokens

Never hardcode a colour. Every value below is a CSS custom property, defined light on
`:root` and dark on `[data-theme="dark"]`, so one declaration covers both themes.

### Surfaces

| Token | Role |
|---|---|
| `--page` | The page behind everything |
| `--surface-1` | Cards, tiles, tables, anything raised off the page |
| `--seg` | The trough of a segmented control |
| `--wash` / `--wash-2` / `--wash-3` | Progressively stronger tints of the ink, for row hover, button hover, selected states |

### Ink

| Token | Role |
|---|---|
| `--ink-1` | Figures, headings, the answer to the question |
| `--ink-2` | Supporting prose, notes under a number |
| `--ink-3` | Labels, units, zero values, anything you read second |

Three levels, no more. If something needs a fourth, it wants a different size or weight
instead.

### Lines

| Token | Role |
|---|---|
| `--border` | The edge of a card — alpha, so it works on any surface |
| `--grid` | Row separators inside a table |
| `--axis` | Header underlines, chart baselines, the border of a hovered or selected card |

`--grid` is quieter than `--axis` on purpose: rows separate, headers divide.

### Meaning

| Token | Means |
|---|---|
| `--s1` | Instantly |
| `--s2` | lemlist |
| `--good` | Healthy — live, running, a reply rate at or above 3% |
| `--warn` / `--warn-ink` / `--warn-soft` | Needs a human: an unsettled conflict, a meeting with no name |
| `--serious` | Watch it — paused, a bounce rate of 2–5%, a daily cap under 10 |
| `--crit` | Stop — errored, a bounce rate over 5% |

`--s1` and `--s2` mean the two vendors **everywhere** — chart bars, group card bars, rep
avatars. Never reuse them as decoration.

`--warn` is amber and its ink (`--warn-ink`) is a darker amber, because amber text on a
light surface fails contrast. Use `--warn` for a fill and `--warn-ink` for type.

Every meaning colour has the same two companions, and the same rule applies to all of them:

| Token | Role |
|---|---|
| `--good` / `--crit` / `--s1` | The fill. A dot, a bar, a filled button. |
| `--good-soft` / `--crit-soft` / `--s1-soft` / `--warn-soft` | A ~12% wash of it over the page (22% in dark), for the background of a chip or a block that means something. |
| `--good-ink` / `--crit-ink` / `--warn-ink` | The same colour deep enough to be **type**. |

The soft tints and the ink twins are `color-mix()` of the tokens above them, so there is one
hex per meaning and no second definition to drift. `--good-ink` and `--crit-ink` mix toward
`--ink-1`, which is near-black on paper and white on the dark surface, so one declaration
covers both themes; `--good-fill` — a green dark enough to carry white 12.5px type — needs
its twin, because mixing toward a white `--ink-1` would lighten it.

**Never put a raw `--good` or `--crit` on a light surface as text.** Both are around 3.4:1
and 4.0:1 against `--page`, which passes for a 20px label and fails for everything smaller.
That is what the `-ink` twins are for.

### Elevation and tint

- `--lift`, `--lift-lg` — the only two shadows. `--lift` on hover, `--lift-lg` on a card
  that is expanded or being dragged toward.
- `--seg-on` — the 1px shadow that lifts the selected segment out of its trough.
- `--tint-1` … `--tint-5`, `--tint-n` — avatar backgrounds, handed out in group order so a
  rep keeps the same colour on every page. `--tint-n` is the neutral one, for "All reps".

---

## Dark mode

Light is the default. Dark is opt-in, and there are exactly three moving parts:

1. `[data-theme="dark"]` on `<html>` redefines every token.
2. The nav's toggle (`components/nav.jsx`) sets that attribute and writes
   `localStorage["qea-hq-theme"]`.
3. An inline script in `<head>` (`THEME_BOOT` in `app/layout.jsx`) reads it back before
   first paint, so a dark-theme visitor never sees a white flash.

Until someone touches the toggle the attribute is absent and
`@media (prefers-color-scheme: dark)` supplies the same values, scoped
`:root:not([data-theme="light"])` so an explicit choice of light always wins.

Dark is not an inversion. The surfaces stay warm (`#1a1a19`, not `#111827`), borders become
white alpha rather than black, and the shadows get much deeper because a dark page needs
more separation to read as layered.

---

## Type

One system font stack, `15px/1.55` body. Four sizes carry almost everything:

| Size | Where |
|---|---|
| `26px / 600 / -.02em` | `h1` — one per page |
| `44px / 600 / -.03em` | A hero figure (`.tile.hero .val`) |
| `30px` · `24px` · `19px` | Secondary figures — group detail tiles, overview tiles, group card stats |
| `13.5px` | Table body, metadata values |
| `12px / .10em / uppercase` | `h2` — a section rule, not a title |
| `11px / .06em / uppercase` | Column headers, tile labels, metadata keys |

Rules that hold everywhere:

- **Negative tracking on large type, positive on small.** Big figures tighten
  (`-.02em` to `-.03em`); uppercase labels open up (`.06em` to `.10em`).
- **`font-variant-numeric: tabular-nums` on every figure.** Columns of numbers must align,
  and a count that animates must not reflow while it does.
- **`h2` is a label, not a heading.** 12px uppercase `--ink-3`. If a section needs a real
  heading, it needs its own page.
- **Prose caps at `78ch`** (`.sub`), body copy inside a card at `74ch`.

---

## Shape and motion

Radii step with size, and the steps are tokens:

| Token | Value | Where |
|---|---|---|
| `--r-sm` | `10px` | An inline control — a rank arrow, a small input |
| `--r` | `14px` | A card, a tone block, a hero tile |
| `--r-lg` | `18px` | A stat card, a textarea, a banded table |
| `--r-xl` | `22px` | A content card with 20px of padding inside it |
| `--r-pill` | `999px` | A chip, a segmented control, a button |

Older components still hardcode `8–9px` for controls and `12px` for a nested box; migrate one
onto the scale when you are in it anyway, not as a sweep. A circle is a circle.

Five keyframes, and nothing else animates:

| Animation | Used for |
|---|---|
| `fadeUp` | Anything entering — tiles, cards, table rows, with a stagger of `0.03–0.05s` per item |
| `growBar` | Chart bars, scaling from the baseline up |
| `growWide` | Progress bars, scaling from the left |
| `breathe` | The sync dot, so "live" is visible without reading |
| `slideDown` | A `<details>` body opening, and warning banners arriving |

Easing is `cubic-bezier(.22,.8,.3,1)` for movement and a plain `.16s`–`.22s` ease for
colour. Hover lifts by `-3px` on a tile, `-4px` on a rep chip, `-1px` on a small button.

The count-up on figures (`components/tween.jsx`) is decoration: the server already rendered
the final number, and the tween respects `prefers-reduced-motion`.

---

## Components

### `.tile` — a figure

```jsx
<Tile hero label="Emails sent" value={num(sent)} raw={sent}
      note="1,608 Instantly · 1,133 lemlist" href={drill("sent")} />
```

Three variants by weight: `.tile.hero` (44px, the four figures that matter most),
`.tile.plus` (30px, a detail page), plain `.tile` (24px, a secondary row). Pass `raw` to
opt into the count-up. Pass `href` and it grows a `see who →` and becomes the way into the
people behind the number — **the rule for the whole dashboard: no figure is a dead end.**

`tone="muted"` for a structural zero, `tone="bad"` for a number that means stop.

### `.seg` — a segmented control

Ranges, page sizes, sorts, tab strips. Children are links, so every state is a real URL and
the back button works. Wrap it in `.segrow` to sit it beside a `.note`.

`.range` is the other thing: a loose row of ghost buttons, for back links and pagination.
Not a segmented control, and it should not look like one.

### `.reps` — the rep picker

An avatar, a first name, a subtitle. `.reps.big` on the Meetings page. Reps are derived from
`campaign_groups.owner`; the avatar colour comes from `--tint-*` by group order.

### `.gcard` — a campaign group

A `<details>` element. The `<summary>` holds the name, status pill, byline, six stats, the
delivered/bounced bar and the actions; the body holds the description, metadata and the
sub-campaign table. Native disclosure means it works with JavaScript off, and
`details[open] > summary .chev` rotates the chevron with no state to manage.

### `.mrow` — a meeting

The same `<details>` pattern, one row per meeting. `.mrow.hasgap` borders it amber when the
record is incomplete.

### `.card` and tables

`.card` is the default container: `--surface-1`, `--border`, `14px`, `18px 22px`. Add `.tw`
for horizontal scroll — a wide table scrolls inside its card, the page never does.

Table conventions:

- **Numbers right, text left.** `th:first-child` and `td:first-child` flip to the left
  automatically; anything else needs `style={{ textAlign: "left" }}`.
- **`td.name`** for the first column: it un-nowraps and gets a `200px` minimum.
- **`tr.tot`** for a totals row — top rule, bold, no hover.
- **Zero is `--ink-3`.** `<Num>` and `<DrillCell>` do this for you. A dimmed zero says
  "nothing here"; a black zero says "look at me" and it never means that.
- Bounce rates go through `<BounceCell>` so the 2% / 5% thresholds are applied in one place.

### `.pill` — a status

`<Pill status={x} />` renders `.pill.p-<status>`. Add new statuses to the colour list in
`globals.css`, grouped by meaning rather than by name: solid border for a real state, dashed
for a provisional one (draft, prospect, unclassified).

### `.gapform` — an inline form

The one form treatment: a flex row of inputs with `.choice` buttons, used for
conflict resolution and for logging calls. `select` elements inside it share the
input styling — added token-based when the Calls workspace needed an outcome
picker, no new class.

### `.fb` — the feedback box

A `<details>` at the foot of every page, rendered from `app/layout.jsx`. Closed, it is
`--page` with a `--border` and `--ink-3` type: quieter than a card, because a thing that is
on every page must not compete with the numbers above it. Open, it becomes `--surface-1`
with an `--axis` border like any other raised surface, and the body slides down on
`slideDown` like every other disclosure here.

`.fbform` stacks a textarea, a file input and the submit; `.shot` is the screenshot on
`/feedback`, capped at `340px` so a tall grab cannot own the row.

No client component. The page it was sent from comes from the `Referer` header on the POST,
not from JavaScript reading the URL — which is why the box can live in a layout that cannot
read query params.

### `.warnbox` — something needs attention

Left rule in `--crit`, or `.warnbox.w` in `--warn` for the softer case. `.warnbox.plain`
sits inside a card rather than on the page. The first sentence is bold and states the
problem; the rest says what the runbook wants done.

---

## Rules that are not negotiable

1. **Every figure links to the people behind it.** A number you cannot open is a number you
   cannot act on.
2. **A structural zero says so.** Where a vendor cannot record something, the note explains
   why rather than showing a bare `0` that reads as failure.
3. **Colour means a decision.** If a colour is not tied to a threshold or a vendor, it is
   decoration and it does not ship.
4. **Tokens, not values.** A hex code in a component is a bug in both themes.
5. **State lives in the URL.** Ranges, sorts, reps, page sizes are all query params, so any
   view can be linked and any page can render on the server.
6. **Native before JavaScript.** `<details>` over a state hook, a link over an onClick, CSS
   over an effect. The only client components are the nav, the theme boot and the count-up.
