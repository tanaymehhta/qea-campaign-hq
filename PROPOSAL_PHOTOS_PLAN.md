# Proposal preview, photo check, zero-token photo edit, and every version kept

Written 24 Sep 2026 at the end of the design session. This file is the full brief for
building it. Read all of it before touching code. Where it says "verify", the fact was
not checked in the session and must be checked before it is relied on.

---

## 0. Why this exists

When the staff chat (`/chat`) finishes a proposal, the rep today gets one small button:
**Download QEA-Q-....docx**. The proposal has a building photo on it (page 2, "the
property page"), fetched automatically from satellite or Street View. That photo is often
the wrong building. Today there is no way to see it without downloading and opening Word,
and no way to fix it without regenerating the whole proposal through the model, which
costs tokens and time.

The goal, in Tanay's words: show the document in place so the rep can page through it;
show every photo outside the document, big, with its address; make the address a Google
Maps link so the rep can check it by eye; put an **Edit** button on the top-right of each
photo so a wrong one can be replaced in seconds by pasting a screenshot; never rebuild the
proposal to do it; keep every version; and store everything each person creates so they
can find it again, all linked together.

---

## 1. Decisions already made (do not reopen)

| Question | Decision |
|---|---|
| Which layout | **"Cards" — thread first, side panel on demand.** Mockup tab 1. Tabs 2–4 (Gallery, One sheet, Checklist) were rejected. The Review-window and All-in-thread layouts from the first round were also rejected. |
| PDF or Word | **Word.** The proposal service returns only a `.docx`; converting to PDF is not possible on its Vercel Python runtime (its own code says "no docx2pdf/subprocess"). Render the `.docx` in the browser instead. |
| How many photos | **1, 2 or more.** Build for N. Today the service only ever makes 1 (see §4.4). |
| Photo size | Big, but not so big the rep must scroll a lot. Three across, 16:10, under the page strip. The whole message fit in ~660px at 1280 wide in the mockup. |
| Clicking a photo | **Does nothing.** No lightbox, no zoom overlay — Tanay explicitly did not want an overlay you have to close. |
| Replace / Edit | **One "Edit" button, top-right corner, on the image itself.** No separate Replace button. |
| Moving between views | **Smooth.** Photos morph between the three-across grid and the compact rows (View Transitions API). |
| Getting back | A visible **"Back to full view"** button in the message *and* a labelled **"Close"** on the panel, plus Esc. (An icon-only ✕ was missed.) |
| Rebuild on edit | **Never.** An edit swaps the image inside the `.docx` zip on this app's server. No model call, no proposal-service call, zero tokens. |
| Versions | **Keep every version.** An edit writes a new file and a new row; nothing is overwritten. |
| Store everything per person | **Yes** — every proposal and brief each person makes, linked to its thread and its versions, browsable by that person. |

---

## 2. The chosen design, exactly

Reference mockup: `mockups/proposal-preview.html` (copied into this worktree). Open it in
a browser. **Only tab "1 · Cards (current)" is the design.** It is a standalone HTML file
with fake data; port the look and the interactions, not the code structure.

### 2.1 Default state — "full view", everything in the thread

Inside the assistant message that delivered the proposal, below the recap text:

1. **Header row** (`.carhead`): file name in bold 13.5px, then muted "4 pages · swipe, or
   click a page", then on the right a `.btn` **"Open in side panel"** with a split-pane icon.
2. **Page strip** (`.car`): every page of the document as a small rendered page, ~118px
   wide, horizontal scroll with scroll-snap, a caption under each ("1 · Cover" — use just
   the page number if there is no reliable name). Clicking a page opens the side panel
   scrolled to that page.
3. Label **"PHOTOS IN THIS PROPOSAL"** (`.lbl`: 11px, uppercase, letter-spaced, ink-3).
4. **Photo grid** (`.photos.grid`): `grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))`,
   gap 12px. Each photo is a card (`.bigphoto`):
   - image full card width, `aspect-ratio: 16/10`, `object-fit: cover`
   - **Edit** button absolutely positioned top-right (10px/10px): dark glass
     (`rgba(15,15,15,.62)` + `backdrop-filter: blur(6px)`), white 12.5px semibold,
     pencil icon + "Edit", 32px tall, radius 9px
   - under the image: the **address as a link** (pin icon in `--s1`, bold ink-1 text,
     underline + `--s1` on hover) → `https://www.google.com/maps/search/?api=1&query=<encoded address>`,
     `target="_blank" rel="noopener"`
   - muted line: source and page, e.g. "Satellite · page 2" / "Street View · page 2" /
     after an edit "Your screenshot · added <time>"
   - a status tag (pill): "Not checked" (wash), "Checked" (good-soft / good-ink),
     "New · not in PDF yet" is **not** needed any more (edits apply immediately, §5)
   - a **"Looks right"** `.btn.ok` toggle (check icon, good-ink text; on = good-soft fill)
   - a changed card gets `border-color: var(--s1)` briefly / until checked (optional)
5. The version line (new, not in mockup): muted, e.g. "v2 · Photo 1 replaced · 3 min ago ·
   Earlier versions ▾" — see §6.4.
6. The existing "Draft only… Nothing was sent." line and the existing **Mark this draft
   final** button stay exactly as they are now.

The message is allowed to be full thread width (`.turn.wide { max-width: 100% }`), unlike
normal turns (74ch).

### 2.2 Side-panel state

Triggered by "Open in side panel" or clicking a page.

- The chat area splits: thread on the left, panel on the right
  (`grid-template-columns: minmax(0,1fr) minmax(0,1.05fr)` in the mockup).
- **Panel** (`.panel`): background `--seg`, left border. Header (`.panel-h`, surface-1):
  file name (ellipsised), muted "N pages", a ghost download icon button, and a labelled
  `.btn` **"✕ Close"** (title "Close (Esc)"). Body: the full document pages stacked
  vertically, max 520px wide, centred, scrollable, page number caption under each.
- In the message: the header button becomes **"Back to full view"**; the page strip is
  hidden (the pages are in the panel).
- Photos fold to **compact rows** (`.bigphoto.mini`): 150px image on the left (Edit
  becomes icon-only, 28px, top-right 6px), and on the right the address link, source line,
  status tag and Looks right.
- **Hovering a photo row** outlines that photo on its page in the panel and scrolls that
  page into view. (In the mockup the outline was a 1cqw `--s1` outline on the page's
  figure. With docx-preview the equivalent is outlining the rendered `<img>` whose source
  is that photo — see §4.6.)
- Esc, Close, or Back to full view returns to §2.1.
- Under ~820px wide the panel stacks below instead of beside.

### 2.3 Motion

- Use `document.startViewTransition`. Give each photo card `view-transition-name: photo-<rel>`
  (unique per photo in the page) and the panel `view-transition-name: panel`.
- Group animation 0.42s `cubic-bezier(.22,.8,.3,1)`; panel enter = slide 40px from right +
  fade, exit = reverse at 0.32s.
- `@media (prefers-reduced-motion: reduce)` → no animation.
- Browsers without the API switch instantly (feature-detect).
- **React 18 detail:** the state change must be applied synchronously inside the
  transition callback, or the "after" snapshot is taken before React commits:
  `document.startViewTransition(() => flushSync(() => setSide(true)))` (`flushSync` from
  `react-dom`). Verify it morphs; if React batching still defeats it, fall back to a CSS
  grid-template-columns transition.

### 2.4 The Edit popover

Anchored under the clicked Edit button (flip above if no room), 320px, surface-1, axis
border, lift-lg shadow:

- title "Edit photo N" + close ✕
- the address as a Maps link (so the rep can open Maps, screenshot, come back)
- a dashed drop zone: "Paste a screenshot with ⌘V, or drop an image here" (highlights
  `--s1-soft` on dragover)
- hint: "Open the address in Maps, screenshot the building, paste."
- "Choose file" (`<input type=file accept="image/*" hidden>` inside a label) and Cancel
- while open, a document-level `paste` listener takes the first `image/*` clipboard item
- Esc or clicking outside closes it
- while uploading: the drop zone says "Saving…" and inputs are disabled; on error it shows
  the error text in `--crit` and stays open

### 2.5 Design system

`app/globals.css` is the only stylesheet — no Tailwind, no CSS-in-JS, no component
library. Read `DESIGN.md` first. Never hardcode a colour; use the tokens (`--page`,
`--surface-1`, `--seg`, `--ink-1/2/3`, `--border`, `--grid`, `--axis`, `--wash*`, `--s1`,
`--s1-soft`, `--good`, `--good-soft`, `--good-ink`, `--crit`, `--r`, `--r-sm`, `--r-lg`,
`--lift`, `--lift-lg`). Everything must work in both themes (light default, dark via
`[data-theme="dark"]` and `prefers-color-scheme`). The existing chat classes to reuse or
sit beside: `.turn`, `.say`, `.who`, `.filechip`, `.choice`, `.thinking`. No emojis
anywhere.

---

## 3. What already exists (state at hand-off)

### 3.1 Repos, trees, branches

- App repo: `/Users/tanaymehta/Desktop/QEA Tech/Growth and Marketing/qea-campaign-hq`
  (GitHub `tanaymehhta/qea-campaign-hq`, Next.js 14.2 App Router, React 18, deployed on
  Vercel from `main`).
- **Work in the worktree** `/Users/tanaymehta/Desktop/QEA Tech/Growth and Marketing/qea-files`,
  branch `proposal-files`. `node_modules` is a symlink to the main tree's. The **main tree
  has another agent's uncommitted work** (DESIGN.md, app/layout.jsx, components/nav.jsx,
  app/proposals, app/hubspot, …) — never edit, stage or commit there.
- Pushing: `git fetch && git rebase origin/main` in the worktree, then
  `git push origin proposal-files:main`. Never `git push origin main` from the main tree —
  it would publish the other agent's commits.
- Proposal service: `/Users/tanaymehta/Desktop/QEA Tech/Code/proposal_service`. **Not a git
  repo.** Python, deployed on Vercel (`vercel.json` → `api/agent.py`, maxDuration 60).
  The app reaches it at `process.env.PROPOSAL_SERVICE_URL` + `/api/agent`.

### 3.2 Already shipped this session (commit `196c081` on main)

Table `public.staff_files` (migration
`supabase/migrations/20260924160000_every_file_a_person_makes_is_kept.sql`, already
applied to the live project `yfnqszwlyoyfhuwfmcyl`):

```
id         uuid primary key          -- = the storage object id, {email}/{id}.docx
email      text not null → app_users(email)
thread_id  uuid → hq_threads(id) on delete set null
kind       text not null check in ('proposal','brief')
filename   text not null
root_id    uuid not null → staff_files(id)   -- first version; groups all versions
parent_id  uuid → staff_files(id)            -- the version this one replaced; null for v1
change     text not null default 'Generated' -- e.g. 'Photo 2 replaced'
created_at timestamptz not null default now()
check ((parent_id is null) = (root_id = id))
indexes: (email, created_at desc), (root_id, created_at)
RLS on, no policy (service role only), like hq_threads.
```

Backfilled with the 9 files that existed (all proposals, 2 people, all with a thread).

`lib/staff-files.js` → `saveStaffFile({ email, bytes, filename, threadId, kind, parent, change })`
uploads `{email}/{id}.docx` to the private `staff-files` bucket and inserts the row. With
`parent` (a full staff_files row) it writes a new version: `root_id = parent.root_id`,
`parent_id = parent.id`, thread and kind inherited. Callers updated: `lib/proposal.js`
(`kind: "proposal"`) and the brief tool in `lib/hq-tools.js` (`kind: "brief"`).
`readStaffFile(email, id)` downloads by path, so another email's id simply misses.

**Not yet confirmed live:** that a new proposal made through the deployed app writes its
row. Check with `select * from staff_files order by created_at desc limit 3` after the
next proposal. If the insert fails, `saveStaffFile` throws and the proposal errors in chat
instead of arriving silently unrecorded.

### 3.3 The chat, as it is now

- `app/chat/page.jsx` — server component; thread from `?t=<thread id>`; renders
  `<ChatBox thread messages accepted>` inside `main.chatmode` (a 3-row grid: head,
  thread, composer — see `.chatmode` in globals.css ~line 1019).
- `app/chat/chat.jsx` — client component. `MessageText` scans message text for
  `[file:<uuid>:<filename>]` and `[draft-proposal]` markers; a file marker becomes the
  `.filechip` download link to `/api/chat/file/<id>?name=<filename>`; the draft marker
  shows "Mark this draft final" (POST `/api/chat/accept`). `Written` renders fenced
  blocks as `<pre>`; `Bold` renders `**x**`.
- `lib/hq-reply.js` `assistantText()` appends `[file:id:filename]` (+ `[draft-proposal]`)
  to the stored assistant message. **The marker always carries the v1 id** — the message
  is never rewritten. Resolve the latest version at render time (§6.4).
- `lib/proposal.js` `draftProposal()` calls the service, saves the docx via
  `saveStaffFile`, returns the service's recap text (`data.output`) + "Draft only…".
- `app/api/chat/file/[id]/route.js` — GET, `currentUser()` must have `rep_name`, reads
  `{user.email}/{id}.docx`, returns it as an attachment.
- Auth: `lib/auth.js` `currentUser()` / `requireUser()`. Every new route must check the
  session user and only ever use `user.email` (never an email from the request).
- DB: `lib/staff-db.js` `staffDb()` = service-role client; needs
  `SUPABASE_SERVICE_ROLE_KEY`, which exists **only in Vercel env**, not on disk.

### 3.4 How the photo gets into the .docx (proposal service)

- `qea_proposal/tools.py` `_get_building_photo(address, ctx)`: calls the QEA Measure MCP
  `get_building_photo`, downloads the image to `/tmp/*.jpg`, reads the `x-photo-source`
  response header ('streetview' | 'satellite' | 'none' | 'unknown'), stores
  `ctx["last_photo_path"]`, `ctx["last_photo_source"]`.
- `_build_proposal(config, filename, ctx)`: copies `last_photo_path` into
  `config.property.photo` if empty, then `fill_proposal.build(config, out_path)`.
- `qea_proposal/scripts/fill_proposal.py` (~lines 202–228): opens the photo with PIL,
  converts to RGB, saves it as `word/media/property_photo.png` (**always PNG**), sets
  `cx = 5486400` EMU (6.0 in), `cy = cx * h / w`, clamps `cy ≤ 6858000` (7.5 in; if
  clamped, `cx = 6858000 * w / h`), then for the `w:drawing` whose `a:blip r:embed ==
  "rIdProp"` sets `cx`/`cy` on every `wp:extent` and every `a:ext`.
- Template `qea_proposal/template/`:
  - `word/_rels/document.xml.rels` line 32: `Id="rIdProp" … Target="media/property_photo.png"`
  - `word/document.xml` ~line 3495: `{{PROPERTY_ADDRESS}}` paragraph; ~3517
    `{{PROPERTY_LABEL}}`; ~3546–3575: the `<w:drawing><wp:inline>` with
    `<wp:extent cx="5486400" cy="3657600"/>`,
    `<wp:docPr id="475271138" name="Picture 2" descr="An aerial view of a building and parking lot  AI-generated content may be incorrect.">`
    and `<a:blip r:embed="rIdProp"/>`.
  - **Just before the drawing (~line 3540) there is a red-outlined rectangle** (VML
    `v:rect` "Rectangle 13", `strokecolor #c00000`, absolute position ~193pt/53pt, ~52×50pt)
    — a highlight box drawn over the photo. It is positioned in points, not relative to the
    image content, so it will not follow the building when the photo changes. Decide with
    Tanay (§8) whether to leave it, or remove it on edit.
- `api/agent.py` response: `output`, `conversation`, `tool_calls`, `docx_base64`,
  `docx_filename`, metrics. No photo metadata today.
- A real sample output exists: `Code/proposal_service/test_output.docx` (has
  `word/media/property_photo.png`, 4.5KB — a placeholder-sized image). Use it to test.

---

## 4. Build plan

Five steps. **Stop after each one, tell Tanay what to click to see it, and wait.** Commit
each step separately. Smallest diff that works; no "while I'm here" cleanups.

### Step 1 — Render the .docx in the chat, with the side panel

1. Run `npm i docx-preview jszip` **inside the worktree**. Its `node_modules` is a
   symlink to the main tree's, so the package lands in the shared `node_modules` (harmless
   to the main tree) while only the **worktree's** `package.json` and lockfile change.
   Confirm with `git status` in both trees that the main tree's `package.json` did not
   change. docx-preview is v0.4.x and depends only on `jszip` (already present,
   transitively). **Verify its API in
   `node_modules/docx-preview/README.md`** — expected: `renderAsync(data, bodyContainer,
   styleContainer?, options?)` where `data` is a Blob/ArrayBuffer, options include
   `className`, `inWrapper`, `ignoreWidth`, `ignoreHeight`, `breakPages`,
   `renderHeaders`, `renderFooters`, `experimental`.
2. New client component `app/chat/proposal-file.jsx` (or inside chat.jsx if it stays
   small). `MessageText` renders it instead of the `.filechip` **for proposals** (briefs
   can keep the chip, or get the same preview — ask; default: same component, it is
   generic). Props: file id (the marker's), filename.
3. It fetches the latest version's bytes (Step 1 may use the marker id directly; Step 4
   switches it to "latest"). New route not needed for bytes — reuse
   `GET /api/chat/file/[id]`; add `?inline=1` to return `content-disposition: inline` or
   just fetch it as a blob (a fetch ignores `attachment`).
4. `import("docx-preview")` inside `useEffect` (browser-only; never at module top level —
   the chat page is server-rendered). Render once into a hidden container, then:
   - **Pages:** docx-preview emits one `section.docx` (class name = `className` option)
     per page **only where the document has explicit page/section breaks**
     (`breakPages: true`); it does not paginate by overflow like Word does. **Verify on a
     real proposal** how many sections come out and whether they correspond to Word's
     pages. If they do not, show the sections as "pages" anyway and say so to Tanay.
   - The **strip** shows each section scaled down (CSS `zoom` or `transform: scale()` on a
     fixed-width wrapper — `zoom` also avoids Chrome's minimum-font inflation, which bit
     the mockup at tiny sizes).
   - The **panel** shows the same sections at readable width.
   - Render into two containers (strip + panel) or clone the nodes; simplest: render once
     per container when it mounts.
5. Side-panel layout: the chat is `main.chatmode` (grid rows: head / thread / composer).
   Add a state `side` on `ChatBox` (only one proposal can be open in the panel at a time)
   and a class on `main` or the thread wrapper that switches to two columns; the panel is
   a sibling of `.thread` spanning the thread + composer rows, or `position: sticky` on
   the right. Keep the composer usable while the panel is open.
6. Motion per §2.3. Esc closes.
7. Keep a small **Download** (icon) in the header row and the panel header — the
   `.filechip` link, restyled, so nothing is lost.
8. Check: `node --test lib/*.test.js` still passes (26 tests at hand-off). Run the app
   (see §7) and look at a real proposal thread.

End of step: rep sees the pages in the message and can open/close the side panel smoothly.
Photos are not listed yet.

### Step 2 — List the photos with address and Maps link

**2a. Pure docx helpers** — new `lib/docx-photos.js`, server-only, uses `jszip`
(add `jszip` to `package.json` dependencies explicitly — it is only present today as a
transitive dependency of `docx`):

```js
/** Every building photo in the document, in document order. */
export async function listPhotos(docxBytes)
// → [{ rel: "rIdProp", target: "word/media/property_photo.png",
//      address: "100 South Campus Dr, Allston, MA 02134" | null,
//      source: "satellite" | "streetview" | "screenshot" | null,
//      cx, cy }]

/** A new .docx with that one image replaced and its box resized. Nothing else changes. */
export async function replacePhoto(docxBytes, rel, pngBytes, { width, height })
// → Uint8Array
```

Rules for `listPhotos`:
- A **building photo** is any `w:drawing` whose `a:blip` `r:embed` starts with `rIdProp`
  (`rIdProp`, `rIdProp2`, `rIdProp3`, …). Logos and every other image are ignored.
- Resolve `rel` → `Target` through `word/_rels/document.xml.rels` (never assume the
  filename).
- **Address**, in order: (1) the drawing's `wp:docPr/@descr` **if it is not the template's
  stock text** (starts with "An aerial view of a building"); (2) fallback for files made
  before the service change: the text of the nearest non-empty `w:p` *before* the
  drawing's paragraph — in the template that is the `{{PROPERTY_ADDRESS}}` paragraph, but
  `{{PROPERTY_LABEL}}` also sits between them, so **verify on `test_output.docx`** which
  paragraph holds the address and pick deterministically (e.g. the paragraph that was
  `{{PROPERTY_ADDRESS}}` — find it by position relative to the drawing); (3) `null` →
  UI shows "Address not recorded" with no Maps link.
- **Source**: `wp:docPr/@title` if it looks like `source:<x>` (set by the service change,
  §4.4) else `null` → UI omits it.
- Parse XML with a real parser, not regex, if one is available in node_modules
  (`@xmldom/xmldom`? verify); regex over `document.xml` is acceptable **only** if scoped
  to one `<w:drawing>…</w:drawing>` at a time and covered by the test below. Namespace
  prefixes in this template are `w:`, `wp:`, `a:`, `pic:`, `r:`.

Rules for `replacePhoto` (this is the zero-token edit):
- Load the zip; find the rel's target; `zip.file(target, pngBytes)`.
- If the target's extension is not `.png`, write the PNG to a new name
  `word/media/<rel>_<n>.png`, update the rel's `Target`, and make sure
  `[Content_Types].xml` has `<Default Extension="png" ContentType="image/png"/>` (the
  template already has it — verify). Simplest correct path: always keep `.png` targets
  (the service always writes PNG) and assert it.
- Recompute the size exactly like `fill_proposal.py`:
  `cx = 5486400; cy = round(cx * height / width); if (cy > 6858000) { cy = 6858000; cx = round(6858000 * width / height) }`.
  Set `cx`/`cy` on the drawing's `wp:extent` and on `pic:spPr/a:xfrm/a:ext`. (The
  service sets it on every `a:ext` in the drawing, including the `a:extLst/a:ext` inside
  `docPr` — harmless; matching only `wp:extent` + `a:xfrm/a:ext` is the correct minimum.
  Also update `wp:docPr/a:extLst/a:ext` cx/cy if present, to match the service.)
- Set `wp:docPr/@title` to `source:screenshot`. Keep `descr` (the address).
- Only this drawing's XML changes. Every other byte of every other part is copied as-is.
  Write `[Content_Types].xml` first when repacking (the service does; Word is tolerant,
  but keep it).
- Return `await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" })`.

**2b. Test** — `lib/docx-photos.test.js` with `node:test` + `node:assert/strict` (the
repo's style — see `lib/hq-tools.test.js`). Build a tiny fixture `.docx` in the test with
jszip (a `document.xml` holding two `rIdProp*` drawings and one logo drawing, the rels
file, content types) so no binary fixture is committed. Assert: `listPhotos` returns 2 in
order with addresses; the logo is excluded; `replacePhoto` changes only the target image
bytes and that drawing's cx/cy (portrait input hits the 7.5 in clamp); other parts are
byte-identical. Also run both functions once against the real
`Code/proposal_service/test_output.docx` in a throwaway script (not committed), open the
result in Word/Pages, and confirm it opens and the photo changed with correct proportions.

**2c. Route** — `GET /api/chat/file/[id]/photos` → owner check via
`readStaffFile(user.email, id)` → `listPhotos` → JSON (no image bytes). Images for the
cards: `GET /api/chat/file/[id]/photo?rel=rIdProp` streams that image out of the zip
(`image/png`, `cache-control: private, max-age=31536000, immutable` is safe because a
version id never changes content). Both routes: `runtime = "nodejs"`,
`dynamic = "force-dynamic"`, 401 without `rep_name`, 404 when the file is not theirs.

**2d. UI** — the photo grid / rows from §2.1–2.2, fed by the photos route. Looks right is
client state for now (see §8 on persisting it).

**2e. Hover-to-outline in the panel**: docx-preview renders images as `<img src="blob:…">`
or data URLs; match by order (the Nth `rIdProp*` drawing is the Nth rendered image inside
a drawing that is not a logo) — **verify** how docx-preview marks images; if matching is
unreliable, scroll the panel to the page that contains the photo and skip the outline.

### Step 3 — The proposal service writes the address (and source) into the photo

Small change in `Code/proposal_service`, so new proposals carry exact addresses instead of
the paragraph fallback. **Back up the folder first** (`cp -R proposal_service
proposal_service.bak-20260924` or a tarball) because it is not in git; tell Tanay; ask
before deploying.

- `fill_proposal.py`, in the photo block, for the drawing with `rIdProp`: set
  `docPr.set("descr", prop.get("address",""))` and `docPr.set("title", f"source:{prop.get('photo_source','')}")`.
  `docPr` is `dr.find(f".//{{{WPD}}}docPr")`.
- `tools.py` `_build_proposal`: alongside copying `last_photo_path`, set
  `prop.setdefault("photo_source", ctx.get("last_photo_source", ""))`.
- Multi-building (`fill_proposal_multi.py`, referenced by the skill doc at
  `qea_proposal/skill/qea-proposal.md` ~line 237, **does not exist**): do not build it.
  Record the contract instead, in a comment in `fill_proposal.py` and in the skill doc: a
  multi-building proposal must give each building photo relationship id `rIdProp`,
  `rIdProp2`, `rIdProp3`… and set each drawing's `descr` to that building's address. The
  chat already handles N.
- Deploy: find how it is deployed (Vercel project linked in that folder? `vercel ls`,
  `.vercel/project.json`; verify). Deploy only with Tanay's OK.
- Verify: make one proposal, then `listPhotos` on its stored file shows the address from
  `descr` and a source.

### Step 4 — Edit: new version, zero tokens

**Route** `POST /api/chat/file/[id]/photo`:
- Body: `multipart/form-data` with `rel` (string, must match `^rIdProp\d*$`), `image`
  (PNG blob), `width`, `height` (integers, 1..10000). Or JSON with base64 — multipart is
  simpler for size.
- Auth: session user with `rep_name`. Load the **row** `staff_files where id = :id and
  email = user.email` (404 if missing). The id may be any version; edits apply to the
  **latest** version of that root (load `root_id`, then the newest row of that root) so
  two tabs do not fork history silently. (Alternative: reject with 409 if `:id` is not
  the latest. Pick one; latest-wins is friendlier.)
- Validate the image: check PNG magic bytes (`89 50 4E 47 0D 0A 1A 0A`), size ≤ 4 MB
  (Vercel's request body limit is 4.5 MB), and that width/height match the PNG IHDR
  (read from bytes 16–23) — trust the file, not the client's numbers.
- `bytes = readStaffFile(email, latest.id)` → `replacePhoto(bytes, rel, png, dims)` →
  `saveStaffFile({ email, bytes: next, filename: latest.filename, parent: latest,
  change: "Photo N replaced" })` (N = 1-based index of `rel` in `listPhotos` order).
- Return `{ id: newId, version: n, change, created_at }`.
- No model call, no proposal-service call. Never overwrite an object.

**Client** (the Edit popover, §2.4):
- On paste / drop / choose: `createImageBitmap(file)` → draw onto a canvas scaled so the
  longest side ≤ 2000 px → `canvas.toBlob(..., "image/png")`. This converts JPEG/HEIC/
  WebP to real PNG (the `.docx` part is named `.png`) and keeps the upload under the
  limit. If a 2000px PNG is still > 4 MB (photographic screenshots can be), step down
  to 1600px and retry.
- POST, then swap the card to the new version: refetch photos + re-render the pages from
  the new id. The version line updates to "v2 · Photo 1 replaced · just now".
- Status tag resets to "Not checked" for the replaced photo.
- Optional, not required: an "Undo" that simply points the UI back at the parent version
  (history is kept either way; undo does not delete anything).

### Step 5 — "My files": everything each person made, linked

- **Versions route** `GET /api/chat/file/[id]/versions` → all rows with the same `root_id`
  as `:id`, owner-checked, oldest → newest: `{ id, change, created_at, filename }`.
- **In the chat card**: the version line from §2.1 with a small menu listing every
  version (v1 Generated, v2 Photo 1 replaced, …), each with a download link. The card
  always opens on the latest.
- **Page `/files`** (server component, `requireUser()`, same `.card`/table styles as the
  rest of HQ):
  - one row per **root** (per document), newest activity first: kind (Proposal / Brief),
    filename, versions count, last change + time, a link **"Open the chat"** →
    `/chat?t=<thread_id>` (hidden if `thread_id` is null), and Download (latest).
  - expanding a row (a `<details>`) lists its versions with download links.
  - query: `staff_files where email = user.email order by created_at desc`, group by
    `root_id` in JS (tens of rows per person; no need for SQL grouping).
- **Nav link**: `components/nav.jsx` has **uncommitted edits by another agent in the main
  tree**. Add the "Files" link in the worktree's copy only, keep the diff to one line, and
  mention the likely merge conflict to Tanay. If the nav in `origin/main` has changed by
  then, rebase first.
- (Later, not now: Tanay may want to see other people's files — admins. Build it
  per-person only; do not add sharing.)

---

## 5. Why the edit is safe and cheap (the mental model)

A `.docx` is a zip. The photo is one PNG file inside it, reached through one relationship
id; the page only references that id and a display size. Replacing the PNG and the size
numbers is a complete, local edit: the text, prices, terms, styles and every other image
are copied byte-for-byte. That is why no rebuild is needed and why it costs nothing.
Word re-flows the page from the new size when it opens the file. The only thing that does
not re-flow is anything absolutely positioned over the photo — today, the red rectangle
(§3.4).

Every edit is a new object and a new `staff_files` row pointing at its parent, so nothing
is ever lost: v1 is the file the model made, v2.. are hand fixes, and any version can be
downloaded forever. The chat message keeps pointing at v1; the UI asks "what is the
latest version of this root" when it renders.

---

## 6. End state (what is true when this is done)

1. A proposal in `/chat` arrives as: recap text → file name + "Open in side panel" →
   a swipeable strip of the actual rendered pages → "PHOTOS IN THIS PROPOSAL" → one big
   16:10 card per building photo (1, 2 or more) → version line → the existing draft line
   and "Mark this draft final". No bare download chip any more (download is an icon in
   the header and panel).
2. Each photo card shows the image, **Edit** on its top-right corner, the building's
   **address as a Google Maps link**, the imagery source, a status tag, and "Looks right".
   Clicking the image does nothing.
3. "Open in side panel" or clicking a page slides the full document in on the right;
   the photos morph into compact rows on the left; hovering a row outlines/scrolls to it
   in the document. "Back to full view", "Close" or Esc morphs back. Reduced-motion users
   get instant switches.
4. Edit → paste/drop/choose a screenshot → about a second later the photo, the pages and
   the version line all show the new version. No model tokens, no proposal-service call.
   The image is resized to the document's 6-inch box with correct proportions.
5. Every file anyone makes (proposals and briefs), and every edited version of it, is a
   row in `staff_files` and an immutable object in the `staff-files` bucket, linked to the
   person, the thread, its root and its parent. Nothing is overwritten.
6. `/files` lists everything the signed-in person has made, newest first, each with its
   versions, a download for each version, and a link back to the chat it came from.
   Nobody can see or fetch another person's files (every route checks the session email).
7. New proposals carry each photo's exact address and source in the image's alt text
   (`descr` / `title`); older ones fall back to the address paragraph above the photo.
8. The proposal service has a documented contract for multi-building proposals
   (`rIdProp`, `rIdProp2`, … + address in `descr`), even though multi-building itself is
   not built.
9. Tests: `lib/docx-photos.test.js` covers list/replace on a synthetic multi-photo docx;
   all existing tests still pass.
10. All of it is on `main` as a handful of small commits pushed from the worktree, none
    of the other agent's work included.

---

## 7. Running and verifying

- **Do not run `next build`** while a dev server is up (it wipes `.next` and 500s the
  running app). Find running servers with `ps aux | grep "[n]ext dev"`. The main tree's
  dev server is on **3005** (port 3000 is another project). Run the worktree's own dev
  server on a spare port (e.g. `npx next dev -p 3121`).
- **Blocker to know up front:** the chat's routes need `SUPABASE_SERVICE_ROLE_KEY`, which
  is not on disk (`.env.local` has only `GITHUB_DISPATCH_TOKEN`). Options, in order:
  (a) `vercel env pull` in the worktree if the project is linked (verify; do not commit
  the result); (b) verify the pure helpers with node tests and the UI against the
  deployed preview; (c) ask Tanay. Do not guess.
- DB reads/writes from the agent: Supabase MCP `execute_sql` / `apply_migration` on
  project `yfnqszwlyoyfhuwfmcyl` (the only write path from this machine).
- Tests: `node --test lib/*.test.js`.
- Visual check: headless Chrome screenshots work well
  (`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless
  --disable-gpu --window-size=1280,1000 --screenshot=out.png <url>`), but the chat needs
  a signed-in session — screenshots of real chat pages need Tanay's browser or the
  deployed site.
- When handing something to Tanay to check: **one URL and a short numbered list of
  clicks, each with what he should see.** No test matrices.

---

## 8. Open questions to ask Tanay (only when you reach them)

1. The red highlight rectangle over the photo: keep it, or remove it from an edited
   version (it will not line up with a new screenshot)? Default if no answer: remove it
   on edit, keep it on v1.
2. Should "Looks right" be saved (so it survives a reload and shows on `/files`)?
   Default: client-only first; saving it is one nullable `checked` jsonb on `staff_files`
   later.
3. Briefs: same preview component, or keep the plain download chip? Default: same
   component, no photo section (briefs have no `rIdProp` images).
4. Crop before upload? Default: no; the rep screenshots just the building. Add a simple
   crop box later if raw Maps screenshots (with Maps UI) keep showing up.

---

## 9. House rules (from Tanay's global instructions)

- Terse replies. No preamble, no trailing summaries. No emojis.
- Smallest change that addresses the step; no bundled cleanups; pause after each step
  for him to verify.
- When he asks "is this right?", verify against files or the running system.
- Say explicitly when unsure.
- Commit messages: a sentence-style subject describing the behaviour ("Every file a
  person makes is kept, and knows where it came from."), a prose body explaining why, and
  end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Match the surrounding code: plain JS (no TypeScript), comment density like
  `lib/hq-chat.js` — a one-line doc comment per exported function saying what it
  guarantees.
