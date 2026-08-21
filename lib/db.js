import { createClient } from "@supabase/supabase-js";

// The anon key is a public, read-only credential: every table is behind RLS with
// a select-only policy, and all writes go through the service role, which lives
// only inside the Supabase edge function. Safe to ship in a public bundle.
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://yfnqszwlyoyfhuwfmcyl.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmbnFzendseW95Zmh1d2ZtY3lsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyNDUzODQsImV4cCI6MjEwMDgyMTM4NH0.alMDnxA7VQff3A0veYqwu2sdzW7BRvTdHFjP7f4TO-A";

// Next's fetch Data Cache would otherwise store every PostgREST GET on disk and
// keep serving it after a write — a call logged in /calls stayed invisible on
// that page while the Overview tile (an explicitly revalidated path) moved.
// This database is written by the sync job and by server actions, never by a
// render, so no read here is ever safely cacheable.
export const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
  global: { fetch: (url, opts) => fetch(url, { ...opts, cache: "no-store" }) },
});

export const TZ = "America/New_York";

/** Today in the company's timezone, not the server's. */
export function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

export function shift(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function prettyDate(iso) {
  if (!iso) return "—";
  const d = new Date(`${iso}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC", weekday: "short", day: "numeric", month: "short",
  }).format(d);
}

export function prettyWhen(ts) {
  if (!ts) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(new Date(ts));
}

/**
 * A number for the screen. **Null is not zero.**
 *
 * This used to be `(n ?? 0).toLocaleString()`, the last of the three layers that
 * turned an unknown into a confident 0 — schema default, then `addInto`, then
 * here. All three had to go together: fixing the column default alone would have
 * changed nothing on screen, because these two put the zero back.
 *
 * A caller that means zero should pass zero. One that has nothing to say passes
 * null and gets an em dash.
 */
export const num = (n) => (n == null ? "—" : n.toLocaleString("en-US"));

export function pct(part, whole) {
  if (!whole) return null;
  return Math.round((1000 * part) / whole) / 10;
}

/**
 * Resolve the ?from / ?to window from search params.
 * Defaults to all time. `range` accepts today | 2 | 7 | 30 | 90 | all.
 */
export function windowFrom(searchParams = {}) {
  const t = today();
  const range = searchParams.range;
  if (searchParams.d) return { from: searchParams.d, to: searchParams.d, label: "day", range: "day" };
  if (range === "today") return { from: t, to: t, label: "Today", range: "today" };
  // Two days, added for /meetings 21 Aug. "Today" on a page whose whole subject
  // is booked five times a month is almost always a zero; yesterday-and-today is
  // the shortest window that ever has something in it.
  if (range === "2") return { from: shift(t, -1), to: t, label: "Last 2 days", range: "2" };
  if (range === "7") return { from: shift(t, -6), to: t, label: "Last 7 days", range: "7" };
  if (range === "30") return { from: shift(t, -29), to: t, label: "Last 30 days", range: "30" };
  if (range === "90") return { from: shift(t, -89), to: t, label: "Last 90 days", range: "90" };
  return { from: "2020-01-01", to: t, label: "All time", range: "all" };
}

/**
 * Every row, not the first thousand.
 *
 * PostgREST caps a response at 1,000 rows whatever `.limit()` asks for. Takes a
 * factory rather than a query because a Supabase builder cannot be awaited
 * twice. Lived in lib/inbound/queue.js, which imports this file — moved here so
 * both sides can reach it without a cycle. queue.js re-exports it, so its own
 * callers are unchanged.
 *
 * Order the query you pass in. Without one, paging a table twice can return the
 * same row twice and miss another.
 */
export async function everyRow(build, size = 1000) {
  const out = [];
  for (let from = 0; ; from += size) {
    const { data } = await build().range(from, from + size - 1);
    out.push(...(data ?? []));
    if (!data || data.length < size) return out;
  }
}

/**
 * The daily notebook over a window, one row per campaign per day.
 *
 * Reads `v_daily_facts`, not `daily_metrics`. Two differences, both deliberate:
 * an Instantly campaign-day `bounced` is NULL there rather than the 0 the column
 * default invented, and the company-wide Instantly bounce arrives as extra
 * **overlay rows carrying no campaign_id**. A caller that keys on campaign_id
 * skips those rows and must add the company figure itself — app/page.jsx does;
 * /health only reads `sent` and is unaffected. See the view for why the number
 * cannot be placed on a campaign.
 *
 * Paged, because this is the source of every Overview tile and the chart, and
 * `daily_metrics` was at 521 of the 1,000-row cap growing 13-28 rows a sending
 * day. Past it there is no error — the days at one end simply stop arriving and
 * every number gets quietly smaller.
 */
export async function dailyRange(from, to) {
  return everyRow(() =>
    db
      .from("v_daily_facts")
      .select("campaign_id, source, metric_date, sent, contacted, new_leads_contacted, delivered, bounced, opened, unique_opened, replied, replies_automatic, clicked, linkedin_sent, linkedin_accepted")
      .gte("metric_date", from)
      .lte("metric_date", to)
      .order("metric_date")
      .order("campaign_id", { nullsFirst: true })
  );
}

export const EMPTY = {
  sent: 0, contacted: 0, new_leads_contacted: 0, delivered: 0, bounced: 0,
  opened: 0, replied: 0, replies_automatic: 0, clicked: 0,
  linkedin_sent: 0, linkedin_accepted: 0,
};

/**
 * Add one day-row into a running total.
 *
 * A null contributes nothing and is not read as a zero. `(row[k] ?? 0)` is what
 * this line used to say, and it is the middle of the three layers that made
 * "we never copied this" arrive on screen as "it was zero" — the accumulator
 * would coerce the unknown before any renderer had a chance to notice it.
 *
 * Known limitation, stated rather than papered over: the accumulator is seeded
 * from EMPTY, which is all zeros, so a total assembled *entirely* from nulls
 * still reads 0 rather than "—". Seeding with null instead would fix that and
 * would also make a group with no rows at all print "—" for sent, which is a
 * different lie — those two cases need telling apart first. The one metric where
 * this matters today, bounce, is handled explicitly in app/page.jsx.
 */
export function addInto(acc, row) {
  for (const k of Object.keys(EMPTY)) {
    const v = row[k];
    if (v == null) continue;
    acc[k] = (acc[k] ?? 0) + v;
  }
  return acc;
}

// --------------------------------------------------------------------- reps

/** Two letters for an avatar. "Mark Vasu" → MV, "Cher" → CH. */
export function initials(name) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Avatar colours, handed out in group order so a rep keeps the same one
// on every page rather than shifting with whatever is on screen.
const REP_TINTS = [
  { tint: "var(--tint-1)", ink: "var(--s1)" },
  { tint: "var(--tint-2)", ink: "var(--s2)" },
  { tint: "var(--tint-3)", ink: "var(--good)" },
  { tint: "var(--tint-4)", ink: "var(--warn-ink)" },
  { tint: "var(--tint-5)", ink: "var(--serious)" },
  { tint: "var(--tint-n)", ink: "var(--ink-1)" },
];

/**
 * The reps, derived from who owns each campaign group — there is no rep table,
 * and inventing one would put a second version of the truth next to the first.
 * A rep owning several groups gets the group count as their subtitle; a rep
 * owning one gets its geography, which is what actually distinguishes them.
 */
export async function repList() {
  // v_group_summary, not campaign_groups, for one column: `actual_status`.
  // `status` is what somebody typed at group creation and no code has ever
  // updated — it records intent and is allowed to be stale. Reading the table
  // here while /campaigns read the view would put the two pages back to
  // disagreeing about a word, which is the whole fault this work exists to fix.
  const { data } = await db
    .from("v_group_summary")
    .select("id, slug, display_name, status, actual_status, owner, geography, sort_order, running_count, last_sent_on")
    .order("sort_order");
  const groups = data ?? [];
  const byOwner = new Map();
  for (const g of groups) {
    const o = g.owner?.trim();
    if (!o) continue;
    if (!byOwner.has(o)) byOwner.set(o, []);
    byOwner.get(o).push(g);
  }
  const reps = [...byOwner.entries()].map(([name, gs], i) => ({
    id: name,
    name,
    initials: initials(name),
    role: gs.length > 1 ? `${gs.length} groups` : gs[0].geography || gs[0].display_name,
    groupIds: gs.map((g) => g.id),
    ...REP_TINTS[i % REP_TINTS.length],
  }));
  return { groups, reps };
}

/** Campaign ids owned by a rep, for scoping a drill-down. groupIds ride
 *  along because meetings can be logged against a group with no campaign. */
export async function campaignIdsForRep(rep) {
  const { data: gs } = await db.from("campaign_groups").select("id").eq("owner", rep);
  if (!gs?.length) return { label: null, ids: [], groupIds: [] };
  const groupIds = gs.map((g) => g.id);
  const { data: m } = await db
    .from("campaign_group_members")
    .select("campaign_id")
    .in("group_id", groupIds);
  return { label: rep, ids: (m ?? []).map((r) => r.campaign_id), groupIds };
}

// --------------------------------------------------------------- drill-downs

export const PAGE_SIZES = [25, 50, 100];

/**
 * Every clickable number on the dashboard, and where the people behind it live.
 *
 * `table` picks the query shape:
 *   activities — a dated event stream, so a date window filters it exactly.
 *   people     — lifetime per-person state. Instantly never timestamps an open
 *                or a click, so those two can only ever be answered this way.
 *   replies / meetings / proposals — the hand-kept tables, which already hold
 *                the richest version of the record.
 */
export const METRICS = {
  sent:              { label: "Emails sent", table: "activities", event: "sent",
                       note: "One row per send. Instantly reports only a lead's most recent send, so its history is thinner than lemlist's." },
  // The only metric whose list is a function rather than a table. `people` is
  // keyed per campaign and its Instantly dates were overwritten by follow-ups
  // until 6 Aug; `reached_people` fixes both — one row per human, dated by the
  // earliest evidence either tool still holds — and the Overview tile counts
  // that same function. Number and click cannot drift because there is one of
  // them. See migration 20260820200000.
  contacted:         { label: "People reached", table: "people", rpc: "reached_people",
                       dateField: "first_contacted_at",
                       note: "First touch per person — the moment they entered a sequence, not a follow-up — across both email tools and the phone. A dial counts whatever came of it; a voicemail is still a reach. Instantly never exposes first-touch, so a July date can read up to a week late; lemlist's are exact and a call's is the day it was made." },
  linkedin_sent:     { label: "LinkedIn requests sent", table: "activities", event: "linkedin_sent", unit: ["request", "requests"],
                       note: "Connection requests only. Profile views are not counted." },
  linkedin_accepted: { label: "LinkedIn accepted", table: "activities", event: "linkedin_accepted", unit: ["acceptance", "acceptances"],
                       note: "lemlist multichannel only." },
  // Reads `people`, not `activities`. The event stream holds 77 bounce rows,
  // all lemlist: the Instantly sync writes no bounce activity at all, so a list
  // built from it could only ever show half the people and would look complete.
  // `people.bounced` is per-person lifetime state and carries all 149 — the same
  // 149 the lifetime notebook counts. The cost is that this list cannot honour a
  // date window, which the page already says out loud, the way it does for
  // opened and clicked.
  bounced:           { label: "Emails bounced", table: "people", altFilter: { bounced: true },
                       note: "Rejected by the receiving server — these addresses never reached a human. Lifetime, not windowed: neither tool timestamps a bounce per campaign-day." },
  // Opens and clicks are properties of a person we reached, not piles of their
  // own, so both filter `reached_people` on a column it already returns — the
  // same move `PILES` makes over `response_people`. The window therefore selects
  // on the date we reached them, because neither tool timestamps an open or a
  // click per person; the note says so, and so does the tile.
  opened:            { label: "People who opened", table: "people", rpc: "reached_people",
                       counter: "opened_count", dateField: "first_contacted_at",
                       note: "A tracking pixel loaded at least once, both tools. Neither tool dates an open per person, so a window here means the people reached in it who have since opened. 902 of the people we reached are in campaigns with no pixel and can never register one." },
  clicked:           { label: "People who clicked", table: "people", rpc: "reached_people",
                       counter: "clicked_count", dateField: "first_contacted_at",
                       note: "Clicked a link at least once, both tools. Dated like opens — by when we reached the person, not by when they clicked, which neither tool records." },
  replied:           { label: "Emails replied", table: "replies",
                       note: "Every inbound, including out-of-office. A floor, not a ceiling: replies sent outside the sequence never reach the tool." },
  auto_reply:        { label: "Out-of-office replies", table: "replies", sentiment: "auto_reply",
                       note: "Counted apart from real replies so they don't inflate the number that matters." },
  // No `meetings` metric. It had one until 21 Aug and it was a second Meetings
  // page: the Overview tile opened a table here while the Meetings tab opened
  // /meetings, two screens for one pile. /meetings is the only one now and
  // every tile that counts a meeting links to it. An old ?metric=meetings URL
  // falls through to the "Unknown metric" screen, which is honest.
  proposals:         { label: "Proposals sent", table: "proposals", dateField: "sent_date",
                       note: "Logged by hand — no tool records this." },
};

/** Campaign ids belonging to a group slug, for scoping a drill-down. */
export async function campaignIdsForGroup(slug) {
  const { data: g } = await db.from("campaign_groups").select("id, display_name").eq("slug", slug).single();
  if (!g) return { group: null, ids: [] };
  const { data: m } = await db.from("campaign_group_members").select("campaign_id").eq("group_id", g.id);
  return { group: g, ids: (m ?? []).map((r) => r.campaign_id) };
}

/**
 * The hub for one human. Emails are stored lowercase everywhere (verified: no
 * row in `people` differs from its own lowercase), so the address is both the
 * key and the URL.
 *
 * A person has no single parent page — they turn up under a campaign, a list, a
 * meeting and a reply — so there is no breadcrumb on the far side. Browser back
 * is the honest answer, and it is native.
 */
export const personHref = (email) =>
  email ? `/person/${encodeURIComponent(email.toLowerCase())}` : null;

/** Clamp ?size to one of the offered page sizes. */
export const pageSize = (v) => (PAGE_SIZES.includes(Number(v)) ? Number(v) : 25);

/**
 * The Meetings form, opened with what is already known about a person.
 *
 * Decision 0.6, and the reason it is worth building: retyping a name from a
 * reply into the meetings form is exactly how the audit's three-rows-for-one-
 * conversation was made. Nothing here writes anything — it fills boxes, and
 * `log_meeting` validates every one of them whatever the URL said.
 */
export const logMeetingHref = ({ name, email, company, campaign } = {}) => {
  const q = new URLSearchParams();
  if (name) q.set("name", name);
  if (email) q.set("email", email);
  if (company) q.set("company", company);
  if (campaign) q.set("campaign", campaign);
  return `/meetings${q.size ? `?${q}` : ""}`;
};

/** Build the querystring for a drill-down link, dropping empty values. */
export function listHref(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") q.set(k, String(v));
  return `/list?${q}`;
}

/**
 * Instantly's per-mailbox daily notebook over a window.
 *
 * The only dated bounce either vendor gives up. `campaigns/analytics/daily` has
 * no bounce field at all, and `campaigns/analytics` has one but only lifetime.
 * This table is keyed (source, email, metric_date) and carries no campaign, so
 * a caller has to supply the edge from mailbox to campaign group itself —
 * app/page.jsx builds it from `campaigns.sender_emails`.
 *
 * Paged for the same reason dailyRange is: 23 mailboxes times a sending day is
 * well inside 1,000 today and will not be in a year, and past the cap PostgREST
 * does not error, it just returns fewer days.
 */
export async function mailboxRange(from, to) {
  return everyRow(() =>
    db
      .from("email_account_daily")
      .select("email, metric_date, sent, bounced")
      .eq("source", "instantly")
      .gte("metric_date", from)
      .lte("metric_date", to)
      .order("metric_date")
      .order("email")
  );
}

// ------------------------------------------------------------ the response pile
//
// One question — "who wrote back?" — asked in one place.
//
// The homepage tile and the /replies list used to answer it separately: the
// tile uniqued Instantly emails in JavaScript after dropping robots and
// refusals, the page listed every inbound row from both vendors all time. The
// tile said 3 and the click opened 193 rows, and both were computed honestly.
// Two answers to one question is F2 in TRUST.md, and it comes back every time
// the rule lives anywhere a second reader cannot reach.
//
// So the rule is in Postgres now — `response_people` / `response_counts`, added
// by 20260820120000 — and these two helpers are the only way into it. A caller
// picks the window, the campaigns and the vendor; it does not get to pick what
// "responded" means.
//
// Both functions take the same four arguments, which is what makes the tile and
// the list the same pile:
//
//   from, to     inclusive calendar dates in New York, or null for all time.
//                Null rather than "2020-01-01" — an unbounded window should ask
//                for nothing, not for a date that happens to predate the data.
//   campaignIds  null means every campaign the anon key can see. A rep's scope
//                is resolved to ids first, because a rep owns groups and only
//                `campaignIdsForRep` should know that.
//   source       'instantly' for anything carrying a rate — lemlist has never
//                written `new_leads_contacted`, so a lemlist person cannot be
//                divided by people reached. null means both, for "All inbound".

/**
 * The piles, as filters over the flags `response_people` returns.
 *
 * "Not interested" has no flag of its own and must not get one. A person who
 * answered either said yes or did not, so it is `responded && !interested` —
 * derived from the same two booleans the tile adds up. Give it a third flag and
 * the day someone is both `interested` and `not_interested` on different
 * messages, the parts stop summing to the whole and nobody finds out.
 */
export const PILES = {
  responded:      { label: "Total responses", where: (q) => q.eq("responded", true) },
  interested:     { label: "Interested",      where: (q) => q.eq("interested", true) },
  not_interested: { label: "Not interested",  where: (q) => q.eq("responded", true).eq("interested", false) },
  needs_label:    { label: "Still to read",   where: (q) => q.eq("needs_label", true) },
  all:            { label: "Everything",      where: (q) => q },
};

export const pileArgs = ({ from, to, campaignIds, source = "instantly" }) => ({
  p_from: from ?? null,
  p_to: to ?? null,
  p_campaigns: campaignIds ?? null,
  p_source: source,
});

/**
 * The tile numbers. One row: people, responded, interested, needs_label,
 * robot_only — counted in Postgres, so nothing here depends on how many rows
 * PostgREST was willing to hand over.
 */
export async function responseCounts(scope) {
  const { data, error } = await db.rpc("response_counts", pileArgs(scope));
  // A failed call is not a count of zero. Returning zeros here would put "nobody
  // wrote back" on a tile whose real answer is "the question did not reach the
  // database" — the same sentence the COALESCE(…, 0) in v_campaign_summary was
  // telling, which is the fault the whole 18 August review exists to end.
  // `num(null)` is an em dash, so a null propagates to the screen as one.
  if (error || !data?.[0]) {
    return { people: null, responded: null, interested: null, needs_label: null, robot_only: null };
  }
  return data[0];
}

/**
 * The people behind one of those numbers, newest conversation first.
 *
 * `pile` is a key of PILES. Paging is `.range()`, which this version of
 * postgrest-js sends as `offset`/`limit` query params — the `Range` header is
 * ignored on an RPC (measured 20 Aug 2026), so do not reach for it. Leave the
 * select alone as well: ordering by a column that is not in `select` fails on a
 * set-returning function, and the default select is every column.
 */
export async function responsePeople(
  scope,
  { pile = "responded", limit = 200, offset = 0, tag = null, search = "" } = {}
) {
  let q = db.rpc("response_people", pileArgs(scope));
  q = (PILES[pile] ?? PILES.responded).where(q);
  // `labels` is an array of every sentiment across the person's thread, so this
  // asks "did they ever say this", which is the same shape as the flags above.
  if (tag) q = q.contains("labels", [tag]);
  if (search) {
    const s = search.replace(/[,()%*]/g, "");
    q = q.or(`lead_email.ilike.*${s}*,lead_name.ilike.*${s}*,company.ilike.*${s}*`);
  }
  const { data } = await q.order("last_at", { ascending: false }).range(offset, offset + limit - 1);
  return data ?? [];
}

// ------------------------------------------------------------ the reached pile
//
// "Who have we actually emailed?" — the other end of the same funnel, and the
// same story as the response pile one section up.
//
// The tile said 1,839 and its own href opened 2,393 people. Both were honest:
// the number was `new_leads_contacted` from the daily notebook, which lemlist
// has never written, and the list was `people`, which both vendors do write.
// The gap was lemlist's 554, and it sat in the first tile of the funnel.
//
// Only `people` can produce a list — a campaign-day count has no names in it —
// so the number moved to the pile that can be listed, and the rule went into
// Postgres where a second reader can reach it: `reached_people` /
// `reached_counts`, migration 20260820200000. Same four arguments as the
// response pair, on purpose, so a tile and its drill-down are scoped the same
// way on both sides of the funnel.
//
// `source` defaults to null — both vendors — where the response pair defaults
// to Instantly. That default is there because a *rate* needed an Instantly
// denominator, and this is that denominator.

/**
 * The tile numbers for both ends of the reached pile:
 * {people, instantly, lemlist, opened, trackable}. Nulls on error, never zeros.
 *
 * `opened` and `trackable` are the two halves of the open rate and both are
 * headcounts of the same people, which is the whole reason they live here
 * rather than being assembled from the notebook next to the tile.
 */
/**
 * The reached pile's arguments. `pileArgs` plus `p_rep`, and the rep is not
 * decoration: since 20 Aug this pile includes people we have only phoned, and a
 * phoned person has no campaign_id to be scoped by. Without the rep they would
 * sit in the all-reps total and in nobody's own view — the same hole that put a
 * call-booked meeting in the tile and not in its own click. Migration
 * 20260820999000.
 *
 * Kept separate from `pileArgs` because `response_people` has no `p_rep` and
 * PostgREST rejects an argument a function does not declare.
 */
export const reachedArgs = (scope) => ({
  ...pileArgs({ ...scope, source: scope.source ?? null }),
  p_rep: scope.rep && scope.rep !== "all" ? scope.rep : null,
});

export async function reachedCounts(scope) {
  const { data, error } = await db.rpc("reached_counts", reachedArgs(scope));
  // Same reasoning as responseCounts: a failed read is not "we emailed nobody".
  if (error || !data?.[0]) {
    return { people: null, instantly: null, lemlist: null, calls: null, opened: null, trackable: null };
  }
  return data[0];
}

// ----------------------------------------------------------- the meeting pile
//
// "Whose meeting is this, and when was it booked?" — asked once, in SQL, for
// the same reason the two piles above are.
//
// Three files each answered the first question differently, and one of them
// could not see a call-booked meeting at all: /?rep=Mark Vasu said 5 and the
// tile's own href opened 4. A meeting that came off the phone has no campaign
// and no group, because the calls workspace belongs to neither. Migration
// 20260820174533 has the measurement.
//
// The second question is new. `booked_on` is the day the meeting was agreed;
// `meeting_date` is the day it happens, and until now the two were forced to
// be the same day. A window on this pile means *booked in this window* —
// `scope_date` is `coalesce(booked_on, meeting_date)`, so the four hand-typed
// rows that predate the column keep dating exactly as they do today.

/** The five args every meeting reader asks with. Campaigns AND groups AND the
 *  rep's own name: a meeting can arrive through any of the three doors, and a
 *  reader that passes only one of them is a reader that loses a pile. */
/**
 * `p_rep`, when given, is the whole scope — the campaign and group arrays are
 * ignored, because the rep `meeting_rows` returns already encodes all three
 * doors a meeting can arrive through. Callers may keep passing all three; the
 * function documents which one wins. See migration 20260821000000.
 *
 * `status` is "counted" (booked + held — what every KPI counts) or "all"
 * (every status, which /meetings lists so a cancellation stays readable).
 */
export const meetingArgs = ({ from, to, campaignIds, groupIds, rep, status }) => ({
  p_from: from ?? null,
  p_to: to ?? null,
  p_campaigns: campaignIds?.length ? campaignIds : null,
  p_groups: groupIds?.length ? groupIds : null,
  p_rep: rep && rep !== "all" ? rep : null,
  p_status: status ?? "counted",
});

/** {meetings, people, from_calls}. Nulls on error, never zeros — same reason
 *  as responseCounts: "the question did not reach the database" must not reach
 *  a screen as "nobody booked anything". */
export async function meetingCounts(scope) {
  const { data, error } = await db.rpc("meeting_counts", meetingArgs(scope));
  if (error || !data?.[0]) return { meetings: null, people: null, from_calls: null };
  return data[0];
}
