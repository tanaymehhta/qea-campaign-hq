# Inbound, restyled — a work order

**Scope:** `/inbound`, `/inbound/company/[id]`, `/inbound/person/[id]` · **Written:** 17 August 2026
· **Status:** not started

This is a **look** brief, not a behaviour brief. What each page says and computes was settled in
`INBOUND_UI_PLAN.md` and is already built; `INBOUND.md` records why. Nothing here changes a
number, a lane, a verdict or a query. If you find yourself editing `lib/inbound/queue.js` or
`lib/inbound/words.js` for anything other than a class name, stop — you have left this brief.

The reference is a separate prototype ("Insight Engine" / Dispatch, a Lovable + Vite +
Tailwind v4 + shadcn app). **You cannot copy its code.** This repo has no Tailwind, no
component library, no CSS-in-JS — `app/globals.css` and `app/inbound/inbound.css` are the
whole stylesheet, and `DESIGN.md` is the contract they answer to. Everything below is the
reference translated into that idiom.

---

## 1. The one fact that makes this cheap

**The palette you liked is already this dashboard's palette.** The reference's tokens carry
the source hexes in their own comments:

| Reference | Value | Already in `globals.css` as |
|---|---|---|
| `--background` | `#f9f9f7` | `--page` |
| `--card` | `#fcfcfb` | `--surface-1` |
| `--foreground` | `#0b0b0b` | `--ink-1` |
| `--muted-foreground` | `#52514e` | `--ink-2` |
| `--subtle` | `#898781` | `--ink-3` |
| `--border` | `#e1e0d9` | `--grid` |
| `--muted` | `#f1f0ec` | `--seg` |
| `--primary` | `#2a78d6` | `--s1` |
| `--accent` | `#eb6834` | `--s2` |
| `--good` | `#0ca30c` | `--good` |
| `--destructive` / `--stop` | `#d03b3b` | `--crit` |

So this is not a repaint. **Do not add a single new hex to `globals.css`.** The job is to use
what is already there the way the reference uses it: more air, one radius family, filled tone
backgrounds instead of hairline borders, and section rules instead of boxes inside boxes.

Three things in the reference are genuinely new and worth taking:

1. **Soft tints for each meaning colour.** The reference pairs every meaning colour with a
   ~95%-lightness wash (`--good-soft`, `--stop-soft`, `--warn-soft`, `--info-soft`) and uses
   the wash as a *background* with the strong colour as text. This repo has `--tint-1…5` and
   `--warn-soft` but no systematic pairing. Add the missing ones **as `color-mix` of existing
   tokens**, not as new hexes:

   ```css
   :root {
     --good-soft: color-mix(in srgb, var(--good) 12%, var(--page));
     --crit-soft: color-mix(in srgb, var(--crit) 12%, var(--page));
     --s1-soft:   color-mix(in srgb, var(--s1) 12%, var(--page));
   }
   [data-theme="dark"] {
     --good-soft: color-mix(in srgb, var(--good) 22%, var(--page));
     --crit-soft: color-mix(in srgb, var(--crit) 22%, var(--page));
     --s1-soft:   color-mix(in srgb, var(--s1) 22%, var(--page));
   }
   ```

   `color-mix` is already used in `globals.css` for the banded tables, so this is an existing
   technique, not a new one.

2. **`--warn` is too light to carry text.** The reference deepened `#fab219` to
   `oklch(0.63 0.14 78)` precisely because amber on off-white fails contrast. This repo has
   the same problem and already works around it with a separate `--warn-ink`. Keep using
   `--warn-ink` for text and `--warn` for fills only. Never put `--warn` on `--page`.

3. **A radius scale, not a radius.** The reference runs one variable and four derived steps.
   This repo hardcodes `10px`, `12px`, `14px` per component. Add the scale and migrate the
   inbound classes onto it:

   ```css
   :root { --r: 14px; --r-sm: 10px; --r-lg: 18px; --r-xl: 22px; --r-pill: 999px; }
   ```

---

## 2. Deleted, do not bring back

The company-type filter chips (`automotive`, `business consulting and services`,
`construction`, …) are **gone as of 17 August 2026** — removed from `app/inbound/page.jsx`,
`lib/inbound/queue.js` and `inbound.css`, along with the `industry` column read and the
`?trade=` parameter. They were a wall of low-value labels above the real content.

Do not re-add them, do not re-add a compact version, and do not replace them with a dropdown.
If company type is ever wanted again it waits on the backend's `what_they_do` field (§9 item 6
of `INBOUND.md`) and gets designed then.

---

## 3. Typography

The reference uses the **system UI stack at two weights only — 400 and 600** — with `body` at
15px/1.55, and every number in `font-variant-numeric: tabular-nums`. This repo already ships
tabular-nums on figures; the rest is a tightening.

Add these to `inbound.css` and use nothing else for text on the three inbound pages:

```css
/* The whole type scale for /inbound. Two weights, five sizes, one exception
   (the ready toggle, which is a 20px control). Anything not on this list is a
   size somebody invented in a hurry. */
.i-h1    { font-size: 26px; font-weight: 600; letter-spacing: -.02em; line-height: 1.2; }
.i-sub   { font-size: 14px; color: var(--ink-2); max-width: 78ch; line-height: 1.55; }
.i-h2    { font-size: 12px; font-weight: 600; text-transform: uppercase;
           letter-spacing: .1em; color: var(--ink-3); }
.i-label { font-size: 11px; font-weight: 400; text-transform: uppercase;
           letter-spacing: .06em; color: var(--ink-3); }
.i-num   { font-size: 24px; font-weight: 600; letter-spacing: -.02em; line-height: 1.05;
           font-variant-numeric: tabular-nums; }
.i-body  { font-size: 12.5px; line-height: 1.55; }
.i-note  { font-size: 12px; color: var(--ink-3); }
```

**Weight 500 and 700 do not exist here.** The current inbound CSS is littered with `560`,
`620`, `640` — collapse every one of them to `400` or `600` as you touch it. The reference
looks calmer than this page largely because of that single rule.

`--font-sans` is not needed: `globals.css` already sets the system stack on `body`.

---

## 4. Shape

The reference's signature is **large radii and generous padding, with no inner borders**.
A card is `rounded-3xl` (≈24px) with 20px padding, and the things inside it are separated by
hairline rules, never by nested boxes.

| Element | Radius | Padding |
|---|---|---|
| Content card (`.lab-box`) | `--r-xl` (22px) | 20px |
| Stat card | `--r-lg` (18px) | 16px |
| Inline tone block (a failure reason, a gate line) | `--r` (14px) | 12px |
| Chip, pill, segmented control, button | `--r-pill` | see §5 |

Two rules that do most of the work:

- **No box inside a box.** Today the company page nests `.lab-box` inside `.lab-two` inside
  cards. Inside a card, separate rows with `border-bottom: 1px solid var(--grid)` and
  `:last-child { border-bottom: none }` — the reference's `Fact` row, and it is what makes
  its panels read as one surface.
- **Hairline everywhere, shadow almost nowhere.** `--lift` is for hover on an interactive card
  and nothing else.

---

## 5. Buttons — the part to get right

The reference has exactly **five** button treatments. Build these five in `inbound.css` and
use no others anywhere on the three pages.

### 5.1 State toggle — the label *is* the state

The one you singled out. Full-width, filled, large, and it changes colour and wording
together. Already correct in behaviour (`ReadyToggle` in `app/inbound/controls.jsx`) — it is
the size and fill that change.

```css
.i-state {
  display: block; width: 100%; text-align: left; cursor: pointer;
  border: none; border-radius: var(--r-xl); padding: 18px 22px;
  font-size: 20px; font-weight: 600; letter-spacing: -.02em;
  transition: filter .15s, transform .08s;
}
.i-state:active { transform: scale(.99); }
.i-state .hint { display: block; margin-top: 4px; font-size: 12.5px; font-weight: 400; opacity: .9; }
.i-state.on  { background: var(--good); color: #fff; }
.i-state.off { background: var(--crit); color: #fff; }
```

The second line is an instruction and the first is a state — *"Ready to email"* over
*"Press again to hold it back"*. Both come from the existing `ready` boolean.

### 5.2 Action — restart, and anything that changes the world

Pill, filled with the meaning colour, and it reports back in place rather than opening a
dialog: `Restart` → `Restarting — check back in a minute`.

```css
.i-act {
  border: none; border-radius: var(--r-pill); cursor: pointer;
  padding: 8px 16px; font-size: 13.5px; font-weight: 600;
  background: var(--crit); color: #fff;
  transition: filter .15s, transform .08s;
}
.i-act:hover  { filter: brightness(1.1); }
.i-act:active { transform: scale(.97); }
.i-act.small  { padding: 6px 12px; font-size: 12.5px; }
.i-act.done   { background: var(--good-soft); color: var(--good); }
```

**Restart is still blocked on the backend** (`inbound_request_rerun` does not exist — §9 item 5
of `INBOUND.md`). Build the button and render it `disabled` with a `title` naming what is
missing. Do not fake the queued state.

### 5.3 Quiet action — copy, open in mail

Pill, filled with `--seg`, no border.

```css
.i-quiet {
  border: none; border-radius: var(--r-pill); cursor: pointer;
  padding: 8px 16px; font-size: 12.5px; font-weight: 600;
  background: var(--seg); color: var(--ink-1);
}
.i-quiet:hover { background: var(--grid); }
```

### 5.4 Commit — the one dark button per screen

Ink-filled, right-aligned, one per page maximum. "Mark as sent" on the person page.

```css
.i-commit {
  border: none; border-radius: var(--r-pill); cursor: pointer;
  padding: 8px 16px; font-size: 12.5px; font-weight: 600;
  background: var(--ink-1); color: var(--page);
}
.i-commit:hover { opacity: .9; }
```

### 5.5 Sideways link — no arrows, ever

The `Queue · Website · LinkedIn · Move to not relevant` row. Underlined in `--grid`, the
underline darkening on hover; the destructive one turns `--crit` on hover only.

```css
.i-links { display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
           font-size: 13.5px; color: var(--ink-2); }
.i-links a, .i-links button {
  background: none; border: none; padding: 0; cursor: pointer; font: inherit; color: inherit;
  text-decoration: underline; text-decoration-color: var(--grid); text-underline-offset: 4px;
  transition: color .15s, text-decoration-color .15s;
}
.i-links a:hover, .i-links button:hover { color: var(--ink-1); text-decoration-color: currentColor; }
.i-links .danger:hover { color: var(--crit); }
.i-links .sep { color: var(--grid); }
```

Arrows were removed from these rows on 17 August; keep them out. An arrow promises the next
step in a sequence, and these are sideways moves.

---

## 6. Chips — colour, shape *and* word, never colour alone

The reference's best detail: a research chip carries a **round** dot when good and a
**square** one when failed, so it survives greyscale, projection and colour blindness.

```css
.i-chip { display: inline-flex; align-items: center; gap: 6px;
          border-radius: var(--r-pill); padding: 4px 10px;
          font-size: 12.5px; font-weight: 600; }
.i-chip .mark { width: 8px; height: 8px; }
.i-chip.done   { background: var(--good-soft); color: var(--good); }
.i-chip.done .mark   { border-radius: 50%; background: var(--good); }
.i-chip.failed { background: var(--crit-soft); color: var(--crit); }
.i-chip.failed .mark { border-radius: 2px; background: var(--crit); }   /* square: not a dot */
.i-chip.none   { background: var(--seg); color: var(--ink-3); }
.i-chip.none .mark   { border-radius: 50%; border: 1px solid var(--ink-3); background: none; }
```

The three states already come from `researchChip()` in `lib/inbound/words.js` — read
`.state` and `.label` off it, do not re-derive.

Apply the same shape rule to the **timeline dots**: green is a circle with a tick, red is a
rounded square with a cross, unreached is a dashed outline circle. Both glyphs are 4-line
inline SVGs; the reference's are in its `Timeline.tsx` and are worth copying verbatim as
paths.

---

## 7. Page furniture

### 7.1 Section heading with a rule

Every group on all three pages gets one. This replaces the current `<h3>` inside a card.

```css
.i-sec { display: flex; align-items: center; gap: 12px; margin: 0 0 12px; }
.i-sec .line { flex: 1; height: 1px; background: var(--grid); }
```

```jsx
<div className="i-sec"><h2 className="i-h2">The account</h2><span className="line" /></div>
```

### 7.2 Fact row

Label left in `--ink-3`, value right in `--ink-1`, tabular, hairline between.

```css
.i-facts > div { display: flex; align-items: baseline; justify-content: space-between;
                 gap: 16px; padding: 9px 0; border-bottom: 1px solid var(--grid); }
.i-facts > div:last-child { border-bottom: none; }
.i-facts .k { font-size: 12.5px; color: var(--ink-3); }
.i-facts .v { font-size: 12.5px; color: var(--ink-1); text-align: right;
              font-variant-numeric: tabular-nums; }
```

This replaces the current `.meta` grid on both detail pages. The grid puts labels above values
in columns and reads as a form; the reference's list reads as a record.

### 7.3 Stat card

Number **first**, label under it, note under that — the reverse of today's order, and the
reason the reference's header scans faster. Whole card is the click target, and the active one
takes a `--s1` border with a `--s1-soft` fill.

```css
.i-stat { display: block; text-align: left; cursor: pointer; text-decoration: none;
          border: 1px solid var(--grid); border-radius: var(--r-lg);
          background: var(--surface-1); padding: 16px; transition: border-color .15s, transform .08s; }
.i-stat:hover  { border-color: var(--axis); }
.i-stat:active { transform: scale(.99); }
.i-stat.on     { border-color: var(--s1); background: var(--s1-soft); }
.i-stat .num.good { color: var(--good); }
.i-stat .num.bad  { color: var(--crit); }
```

Keep the existing `Tile` in `components/ui.jsx` for the rest of the dashboard — it is used by
six other pages. Either add an inbound-only variant or extend `Tile` with an opt-in prop.
**Do not restyle `Tile` globally.**

### 7.4 Layout

- `max-width: 1100px`, centred, `padding: 32px 16px`.
- Vertical rhythm between sections: **32px**. The current page uses 14–24px and feels crowded.
- Two-column detail pages stay as they are (`.lab-two`), but at `1fr 1.15fr` on the person page
  so the draft — the thing being read — gets the wider half.

---

## 8. What each page becomes

Behaviour is unchanged throughout. Only the listed visual work is in scope.

### Queue — `app/inbound/page.jsx`

1. `h1` to `.i-h1`, intro line to `.i-sub`.
2. Both stat rows to `.i-stat`, number-first, six across on desktop → three on tablet → two on
   phone. Keep the caption line ("Counting every rep · seen in the last 7 days") — it is what
   makes the scoped numbers checkable.
3. Rep chips: circular tinted initial + name in a pill; active gets `--s1` border and
   `--s1-soft` fill. The rep tints already exist in `lib/inbound/routing.js`.
4. Range and Cards/Table become one pill-trough segmented control each — `--seg` trough,
   `--surface-1` thumb, weight 600 on the active label.
5. Lane headings to `.i-sec` with the rule and the count inline.
6. Company card: name at 18px/600, domain and fit at `.i-body`, research chip top-right,
   findings as `--seg` pills, then a hairline and a four-up label/value strip (Visited from,
   Rep, Visits, Cost). A failed card gets a `--crit-soft` block holding the reason and the
   (disabled) Restart, and a `--crit` 50% border.
7. Delete `.lab-cardacts` as a floating strip — "Move to not relevant" belongs in the links row.

### Company — `app/inbound/company/[id]/page.jsx`

1. Timeline into its own card at the top: `--r-xl`, 24px padding, dots per §6, connector line
   `--grid`, and **vertical on phone** — the current horizontal row is unreadable under 480px.
   A red dot opens its reason inline in a `--crit-soft` block; the raw provider error stays in
   the `<details>` beneath.
2. The account box to `.i-facts`. Cost stays a `<details>` but its summary becomes the
   underlined number and the breakdown a hairline table.
3. "What kind of company they are" bullets become left-border cards: `border-left: 2px solid
   var(--s1)` on `--surface-1`, one per bullet. The 402 case keeps its single `--crit-soft`
   line — never a bulleted stack trace.
4. Empty People panel: `Nobody found` in `--crit` at 600, the measured reason under it in
   `--ink-2`, disabled Restart beneath.
5. Person rows in the people list: name, title, `visited`/`found by lookup`, email; rank
   arrows and the state toggle (§5.1, pill size) on the right; draft behind a "Show the draft"
   text toggle.

### Person — `app/inbound/person/[id]/page.jsx`

1. The ready toggle becomes the **full-width `.i-state` block at the top of the left column** —
   the reference's strongest move, and the answer to "can I write to this person" before
   anything else is read.
2. "Who they are" to `.i-facts`.
3. Draft card: `Subject` and `Body` as `.i-label` over their content, the textarea at
   `--r-lg`, `--page` background, `--s1` border on focus. Buttons underneath: `Copy email` and
   `Open in mail` as `.i-quiet`, `Mark as sent` as `.i-commit`, pushed right.
4. The gate line keeps its one plain sentence in a `--crit-soft` block with the `why` toggle;
   the draft stays readable and copyable in every state.
5. "The opening line is built on this" (today's `.lab-receipt`) becomes a left-border card in
   `--good` — it is evidence, and evidence reads as confirmation.

---

## 9. Rules

- **No new dependency.** No Tailwind, no shadcn, no `class-variance-authority`, no icon
  package. Both SVG glyphs are inline.
- **No new hex.** Everything is an existing token or a `color-mix` of one. `DESIGN.md` §Tokens
  is binding.
- **Both themes, every time.** Anything added to `:root` gets its `[data-theme="dark"]` twin in
  the same commit. Check both before calling it done.
- **Server components stay server components.** The only client component in this section is
  `draft.jsx`. Everything here is CSS and markup; if you reach for `useState`, you are
  probably rebuilding something a `<details>` already does.
- **`.lab-*` is the prefix for existing classes, `.i-*` for the ones this brief adds.** Do not
  rename the old ones wholesale — the drafts page and `/pipeline` share some of them. Migrate
  a class only when the page you are on is the only caller; check with
  `grep -rn "lab-classname" app/`.
- **Contrast.** Every text/background pair must clear 4.5:1. The three that historically fail:
  `--warn` as text (use `--warn-ink`), `--ink-3` on `--seg`, and white on `--good` in dark
  mode. Check those three specifically.
- **The regression suite must still pass**: `node scripts/test-routing.mjs`. It tests pure
  functions, so a styling change that breaks it means logic was touched.

---

## 10. Order

1. Tokens and type scale — §1, §3. Nothing visible changes; everything after depends on it.
2. Buttons and chips — §5, §6. Self-contained, and they are what you said you liked.
3. Person page — §8. One page end to end proves the vocabulary before it is spent on three.
4. Company page, then the queue.
5. Update `DESIGN.md` with anything that graduates to dashboard-wide use — the radius scale
   and the soft tints probably should; the `.i-*` classes should not.

The reference prototype is at `~/Downloads/__Insight Engine__.zip`. Read
`src/styles.css`, `src/components/dispatch/Pieces.tsx` and `src/components/dispatch/Timeline.tsx`
first — those three files hold everything worth taking. Its data is fabricated; ignore every
number in it.
