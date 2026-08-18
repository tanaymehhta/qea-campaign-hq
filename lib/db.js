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
 * Defaults to all time. `range` accepts today | 7 | 30 | 90 | all.
 */
export function windowFrom(searchParams = {}) {
  const t = today();
  const range = searchParams.range;
  if (searchParams.d) return { from: searchParams.d, to: searchParams.d, label: "day", range: "day" };
  if (range === "today") return { from: t, to: t, label: "Today", range: "today" };
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
      .select("campaign_id, source, metric_date, sent, contacted, new_leads_contacted, delivered, bounced, opened, replied, replies_automatic, clicked, linkedin_sent, linkedin_accepted")
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
  contacted:         { label: "Leads contacted", table: "people", dateField: "first_contacted_at",
                       note: "First touch per person — the moment they entered a sequence, not a follow-up." },
  linkedin_sent:     { label: "LinkedIn requests sent", table: "activities", event: "linkedin_sent",
                       note: "Connection requests only. Profile views are not counted." },
  linkedin_accepted: { label: "LinkedIn accepted", table: "activities", event: "linkedin_accepted",
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
  opened:            { label: "Emails opened", table: "people", counter: "opened_count",
                       note: "A tracking pixel loaded. Neither tool timestamps an open, so this list is lifetime, not windowed. Two-thirds of campaigns run with open tracking off and can never register one." },
  clicked:           { label: "Links clicked", table: "people", counter: "clicked_count",
                       note: "Someone clicked a link in the email. Only campaigns with link tracking on can register this." },
  replied:           { label: "Emails replied", table: "replies",
                       note: "Every inbound, including out-of-office. A floor, not a ceiling: replies sent outside the sequence never reach the tool." },
  auto_reply:        { label: "Out-of-office replies", table: "replies", sentiment: "auto_reply",
                       note: "Counted apart from real replies so they don't inflate the number that matters." },
  meetings:          { label: "Meetings booked", table: "meetings", dateField: "meeting_date",
                       note: "Logged by hand — no tool records this." },
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

/** Build the querystring for a drill-down link, dropping empty values. */
export function listHref(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") q.set(k, String(v));
  return `/list?${q}`;
}
