# Authentication — build plan

Sign in with a QEA office email; see the parts of HQ that belong to you.

Nothing here is built yet. This document is written so someone who has never
seen this repo can execute it. Read all of section 1 before touching anything —
several obvious-looking moves break things in ways that only surface later.

Owner: Tanay. Decisions in section 3 are settled; do not reopen them.

---

## 1. Read this first — five verified facts

These were checked against the running system on 2026-08-17, not assumed.

**1.1 — The database is wide open.** All 35 tables in `public` have RLS enabled
and each carries exactly one policy: `public read`, `for select to anon,
authenticated using (true)`. All 12 write functions grant `execute` to `anon`.
The anon key is hardcoded at `lib/db.js:9` and committed to git. Anyone with
that key — or with this repo — can read every table and call every write.

**1.2 — But no browser code touches Supabase.** All four `"use client"` files
(`app/inbound/draft.jsx`, `components/nav.jsx`, `components/tween.jsx`,
`components/mesh-footer.jsx`) import only React and a shader library. Every read
is a server component; every write is a server action. The `NEXT_PUBLIC_` prefix
on the Supabase env vars is a misnomer — the key was never needed in the bundle.

This is the fact that makes the job small: the database only has to be reachable
by our server, so the gate can live in one place instead of in 35 policies.

**1.3 — Nothing external reads on the anon key.** Verified from 24h of Supabase
gateway logs, grouped by `request.sb.jwt.apikey.payload.role`:

| Client | Key role | What it is |
|---|---|---|
| `supabase-js-node/2.45.4` | **anon** | this Next app |
| `supabase-py` (Linux/azure) | service_role | inbound pipeline in GitHub Actions |
| `supabase-py` (Darwin 25.5.0) | service_role | inbound pipeline run locally |
| `supabase-js-deno` | service_role | the sync edge function |

Revoking anon will not break the pipeline. Caveat: 24h window, so anything that
runs less often than daily would not have appeared — `scripts/import_call_list.mjs`
is exactly that case and is handled in step 8.

**1.4 — Identity in the data is a free-text name.** There is no user table. A
person is `campaign_groups.owner`, `call_campaigns.owner`, `phone_calls.rep`,
`meetings.logged_by`. Current values: `Tanay`, `Justin`, `Mark Vasu`,
`Mark Dolan` — plus nulls (1 campaign group, 3 meetings, 3 phone calls). Commit
c041c0d already had to settle on one spelling of Mark. Email becomes the key;
the name stays a display label that can drift.

**1.5 — Attribution is on the honour system.** Seven of the twelve write
functions take the actor as a caller-supplied argument:

```
log_call(p_contact, p_rep text, ...)          set_contact_dnc(p_contact, p_rep text, ...)
edit_call(p_call, p_rep text, ...)            update_contact_detail(p_contact, p_rep text, ...)
log_meeting(..., p_logged_by text)            set_callback(p_contact, p_rep text, ...)
                                              restore_contact(p_contact, p_rep text)
```

`app/calls/actions.js:59` fills `p_rep` from `formData.get("rep")` — a hidden
form field decides who made the call. Fixing this is worth more than the login
page: it is the difference between the per-rep numbers being true and being a
claim the page made.

---

## 2. Goal

Three separate jobs, often conflated under one word:

1. **Who are you?** — Microsoft Entra ID proves the person is `x@qeatech.com`.
2. **Are you allowed in?** — the `app_users` table says they are on the team.
3. **What can you do?** — `rep` or `admin`, enforced in the app.

Plus two things that are not login but belong in the same change: fixing
attribution (1.5) and closing the anon back door (1.1), without which a login
page changes nothing.

---

## 3. Decisions — settled, do not reopen

**Service: Supabase Auth with the Azure (Entra ID) provider.** The allowlist has
to live in Postgres next to `campaign_groups.owner` whatever we pick, so identity
belongs in the same database as the thing it scopes. No new vendor, no new bill,
and it leaves RLS available if the policy below ever changes. Auth.js would need
the same table and the same middleware while permanently closing the RLS door.
Clerk/Auth0 sell org management that four people do not need.

**Policy: reads open, writes owned, machinery admin.** Four colleagues in one
company who discuss these numbers out loud. Hiding Justin's reply rate from Mark
is costume. The real risks are wrong attribution, an accidental sync re-trigger,
and twelve nav items for someone who runs one phone list.

| Page | Read | Write |
|---|---|---|
| Overview, Campaigns, Leads, Replies, Pipeline, Person, List, Timeline | signed in | — |
| Meetings | signed in | logged as you; the rep dropdown goes away |
| Calls | signed in | own campaigns only; **admin can log anywhere** |
| Inbound | signed in | unchanged — everyone, exactly as today |
| Feedback | signed in submits | admin sets status |
| Health, Inboxes, Conflicts, `/inbound/system` | **admin only** | admin only |

**Inbound stays as it is.** No inbound table has an owner column, and
`lib/inbound/routing.js:5` explains why: territory is derived in the frontend
from whatever the row carries, and `hq_country` is null on 41 of 51 companies.
Gating writes on a guess would leave every unassigned company unactionable. It
gets the login gate and nothing else. If it ever needs ownership, that starts
with a real `inbound_companies.owner` filled by stage 1 — a separate change.

**Two roles only.** `rep` and `admin`. Not a matrix. A permission system for
four people is a thing to maintain, not a safeguard.

---

## 4. The people

Exactly four rows. `rep_name` must match the existing owner strings in 1.4
**character for character** — a mismatch means the person signs in fine and sees
zero campaigns as theirs, which reads as a bug rather than a typo.

| email | display_name | rep_name | role |
|---|---|---|---|
| `tanay@qeatech.com` | Tanay | `Tanay` | **admin** |
| `justin@qeatech.com` | Justin | `Justin` | rep |
| `mark@qeatech.com` | Mark Dolan | `Mark Dolan` | rep |
| `mark.vasu@qeatech.com` | Mark Vasu | `Mark Vasu` | rep |

Note the two Marks: `mark@` is **Dolan**, `mark.vasu@` is **Vasu**. Easy to swap
by accident; swapping them silently reassigns 16 logged calls' worth of scope.

Tanay is the only admin.

---

## 5. Prerequisites

### 5a. Entra app registration — blocked on IT

Tanay cannot register the app; someone with directory admin rights must. The
request has been sent. What it asks for:

- Name: QEA Campaign HQ
- Supported account types: **Accounts in this organizational directory only**
- Platform **Web**, redirect URI
  `https://yfnqszwlyoyfhuwfmcyl.supabase.co/auth/v1/callback`
- Delegated Microsoft Graph `openid`, `email`, `profile`, with admin consent
- Enterprise application → Properties → **User assignment required: No**

That last setting is the important one. With it off, anyone with a QEA account
can complete the Microsoft sign-in and the `app_users` table decides the rest —
so Tanay adds and removes people without filing a ticket. With it on, IT must
assign every person in Azure.

Returns: Application (client) ID, Directory (tenant) ID, a client secret, **and
the secret's expiry date**. Secrets expire at 6/12/24 months; an expired one
locks everyone out with no warning. Record the date somewhere it will be seen.

**Steps 6 through 13 do not depend on this.** Build against a stub that treats a
fixed email as signed-in, and swap the provider in at step 7 when the values
arrive.

### 5b. Supabase dashboard — Tanay, once the values arrive

Authentication → Providers → Azure. Client ID, secret, tenant ID (Azure URL
field takes `https://login.microsoftonline.com/<tenant-id>`).

Authentication → URL Configuration: Site URL = the production URL. Redirect
allowlist must include `http://localhost:3117/**` — **3117, not 3000**; see 12.1.

---

## 6. `app_users`

New migration, `supabase/migrations/<timestamp>_app_users.sql`:

```sql
create table app_users (
  email        text primary key,
  display_name text not null,
  rep_name     text,
  role         text not null default 'rep' check (role in ('rep','admin')),
  created_at   timestamptz not null default now()
);

alter table app_users enable row level security;
-- No anon policy. The server reads this on the service role, which bypasses RLS.
-- Deliberately no policy at all: nothing else should ever read this table.

insert into app_users (email, display_name, rep_name, role) values
  ('tanay@qeatech.com',      'Tanay',      'Tanay',      'admin'),
  ('justin@qeatech.com',     'Justin',     'Justin',     'rep'),
  ('mark@qeatech.com',       'Mark Dolan', 'Mark Dolan', 'rep'),
  ('mark.vasu@qeatech.com',  'Mark Vasu',  'Mark Vasu',  'rep');
```

Emails are stored lowercase and must be compared lowercase — Entra can return
mixed case in the `email` claim.

**Adding a person later** is one row in the Supabase Table Editor: email, name,
`rep_name` matching an owner string, role. No deploy. **Removing** is deleting
the row; it takes effect on their next page load even if they are signed in.

---

## 7. Two clients, and why

This is the part that is easy to get wrong. There are **two** Supabase clients
and they must not be merged.

**`lib/db.js` — the data client.** Service role key. Used by every page and
server action, exactly as today. It bypasses RLS entirely, which is the point:
enforcement lives in the app, not in policies.

**`lib/auth.js` — the session client.** Anon (publishable) key, created
per-request via `@supabase/ssr`'s `createServerClient` with the cookie adapter.
Used **only** to read and refresh the session. Never for data.

Revoking anon's table grants in step 9 does not break the session client:
GoTrue (`/auth/v1/*`) is a separate service from PostgREST and does not consult
`public` schema privileges.

Install: `npm i @supabase/ssr`.

Env vars — **none of them `NEXT_PUBLIC_`**, because the whole flow is
server-side:

```
SUPABASE_URL=https://yfnqszwlyoyfhuwfmcyl.supabase.co
SUPABASE_ANON_KEY=...        # for /auth/v1 only
SUPABASE_SERVICE_ROLE_KEY=...
```

Set these in `.env.local` and in Vercel for Production and Preview.

`lib/auth.js` exports three things:

- `currentUser()` — resolves the session email, looks up the `app_users` row,
  returns it or null. Wrap in React `cache()` so the lookup happens once per
  request, not once per call site.
- `requireUser()` — that row, or `redirect("/login")`.
- `requireAdmin()` — that row if `role === 'admin'`, else `notFound()`. A 404
  rather than a "forbidden" page: a rep who mistypes a URL learns nothing about
  what exists.

---

## 8. Login flow — server-side only

Keep the property from 1.2 that no browser code touches Supabase.

- `app/login/page.jsx` — a button posting to a server action that calls
  `signInWithOAuth({ provider: 'azure', options: { redirectTo, scopes: 'openid email profile' } })`
  and redirects to the returned URL.
- `app/auth/callback/route.js` — `exchangeCodeForSession(code)`, set cookies,
  redirect to `/`.
- `app/auth/signout/route.js` — `signOut()`, redirect to `/login`.
- A signed-in user with **no `app_users` row** gets a page naming who to ask.
  Not a blank denial — that reads as a bug and generates a support message.

---

## 9. `middleware.js`

One gate. Matcher covers everything except `/login`, `/auth/*`, `/_next/*`,
`/favicon.ico` and static assets. It refreshes the session cookie and redirects
to `/login` when there is no valid session.

**Do not query `app_users` in middleware.** It runs on every request including
assets; the lookup belongs in `currentUser()` where React's `cache()` dedupes it.
Middleware answers only "is there a session".

`app/layout.jsx` is already `force-dynamic`, so no static cache has to be broken
to make room for a session.

---

## 10. Lock the database

Order matters: **step 7 must be deployed and working before this runs**, or the
app loses its read access the moment the revoke lands.

```sql
revoke all on all tables    in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all sequences in schema public from anon;
```

The 35 `public read` policies can stay — with anon's grants gone they are
unreachable, and leaving them makes a future move to real RLS a rewrite of
policies rather than a re-creation from nothing.

Then **rotate the anon key** (Supabase → Settings → API). It is in git history
and in the working tree. Rotating invalidates the leaked one.

Also remove the literal fallbacks at `lib/db.js:6-9`
(`process.env.X ?? "https://…"`). There is no `.env.local` in git and local dev
has been running on those literals; left in place, a missing service key would
silently fall back to anon and appear to work right up until this revoke lands
in production. The new client should **throw** on a missing key.

Consequence to note: `scripts/import_call_list.mjs:235` falls back to the anon
key for reads and will need `SUPABASE_SERVICE_ROLE_KEY` after this. It fails as
"no rows", not as an error, so it is easy to miss.

---

## 11. Attribution and scoping

**11a. Actor from the session.** Every `p_rep` / `p_logged_by` argument stops
coming from `formData` and starts coming from `currentUser().rep_name`. Delete
the hidden rep inputs from the forms. The rep dropdown at
`app/meetings/page.jsx:147` becomes a line of text.

The **function signatures do not change**. A check inside the function would add
nothing: on a service-role connection `auth.jwt()` is null, so the database
would be trusting an argument either way. The check belongs where the identity
actually is — in the server action.

**11b. Calls ownership.** In `app/calls/actions.js`, after `requireUser()`:
resolve the contact's campaign owner and require it to equal the user's
`rep_name`, **or** the user's role to be `admin`. On refusal use the existing
`done(formData, new Error(...))` path so the rep gets a sentence on the row they
were working, consistent with every other refusal in that file.

Read side untouched. `/calls/[rep]` still opens for anyone, and
`app/calls/[rep]/page.jsx:15` already separates `mine` from `others`. Only the
buttons disappear.

**11c. Nulls stay null.** 3 `phone_calls` with no rep, 3 `meetings` with no
`logged_by`, 1 `campaign_group` with no owner. Do not backfill — putting a name
on a call nobody can vouch for is the exact failure this change exists to stop.

**11d. Nav.** `components/nav.jsx` takes the role and drops what the user cannot
reach. A rep sees eight items instead of twelve.

---

## 12. Gotchas

**12.1 — The dev server runs on port 3117, not 3000.** Port 3000 is a WhatsApp
bridge. Redirect allowlists and any curl-based verification must use 3117.

**12.2 — Never run `next build` while the dev server is up.** The build and the
dev server write the same `.next` directory; the build wipes the cache out from
under the running server and every page 500s until it is restarted. This has
already cost time once. Check first:
`lsof -nP -iTCP -sTCP:LISTEN | grep node`. Verify by curling the dev server.

**12.3 — `node scripts/foo.mjs` will stop working without env.** `lib/db.js`
currently carries inline credentials, so bare node scripts can query with no
setup. After step 10 they need `SUPABASE_SERVICE_ROLE_KEY` in the environment.

**12.4 — A parallel session is building the inbound restart button.** It owns
`app/inbound/controls.jsx` and `app/inbound/actions.js`; this work must stay off
both. It is adding `inbound_rerun_requests` and
`inbound_request_rerun(p_company uuid, p_stage int, p_actor text)`, granting
execute to `authenticated` and `service_role` only — never `anon`. Its
`RestartButton` carries a TODO pointing at `requireAdmin()`; wire that during
step 11d. A restart button that spends OpenRouter money is machinery, so it is
admin-only.

**12.5 — Service role bypasses RLS completely.** After step 10 the policies on
those 35 tables protect nothing, because the only client is service role. That
is the intended design, but it means a page that forgets `requireUser()` leaks
with no second line of defence. Do not later assume RLS is covering anything.

---

## 13. Verification

- Signed out, `/` redirects to `/login`. So do `/calls`, `/health`, `/inbound`.
- Signed in as `justin@`: `/health`, `/inboxes`, `/conflicts` and
  `/inbound/system` all 404. Those four items are absent from the nav.
- Signed in as `justin@`: `/calls/Mark%20Vasu` opens and shows his campaigns
  read-only; the log/edit buttons are gone. Attempting the POST directly is
  refused with a sentence.
- Signed in as `tanay@`: all pages open; a call can be logged on Mark's campaign.
- Log a call as `mark.vasu@` with the browser devtools open; confirm no `rep`
  field is posted and the row lands with `rep = 'Mark Vasu'`.
- A QEA address with no `app_users` row signs in with Microsoft successfully and
  lands on the "ask Tanay" page, not the dashboard.
- After step 10, from a machine with the **old** anon key:
  `curl "$SUPABASE_URL/rest/v1/replies?select=*" -H "apikey: <old key>"`
  returns no rows.
- The 30-minute sync still runs green (`/health`, or `sync_runs`).
- The inbound pipeline's next GitHub Actions run still writes.

---

## 14. Immediate, independent of all the above

`https://qea-campaign-hq.vercel.app` currently returns **200 with the full
dashboard** to an unauthenticated request. Every client name, contact email,
reply and meeting is on the open internet at a guessable URL.

Vercel Authentication only covers production on Pro plans, so it may not be
available on this account. The fastest real fix is a `middleware.js` holding one
shared password — about twenty lines, five minutes, and not throwaway: it is the
same file that step 9 replaces the contents of.

**This should go up before waiting on IT.**

---

## 15. Deliberately not built

- **RLS policies scoped to the user.** Would need a per-request client carrying
  the user's JWT, `security_invoker` on every view, and owner checks inside all
  12 functions. Real isolation, but a rewrite of the data layer for zero
  incremental safety while the server is the only client. This is the upgrade
  path the day someone outside the team — a client, a contractor — gets a login.
- **An `/admin/people` page.** Four rows in the Supabase Table Editor. Build it
  when editing that table becomes annoying, not before.
- **A third role.** One word in one column plus a few conditionals, whenever a
  real need appears.
- **Inbound ownership.** See section 3.
- **Backfilling the null reps.** See 11c.
