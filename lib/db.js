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

export const num = (n) => (n ?? 0).toLocaleString("en-US");

export function pct(part, whole, digits = 1) {
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

/** Sum daily_metrics over a window, grouped by whatever key you pass. */
export async function dailyRange(from, to) {
  const { data } = await db
    .from("daily_metrics")
    .select("campaign_id, metric_date, sent, contacted, new_leads_contacted, delivered, bounced, opened, replied, replies_automatic, clicked, linkedin_sent, linkedin_accepted")
    .gte("metric_date", from)
    .lte("metric_date", to);
  return data ?? [];
}

export const EMPTY = {
  sent: 0, contacted: 0, new_leads_contacted: 0, delivered: 0, bounced: 0,
  opened: 0, replied: 0, replies_automatic: 0, clicked: 0,
  linkedin_sent: 0, linkedin_accepted: 0,
};

export function addInto(acc, row) {
  for (const k of Object.keys(EMPTY)) acc[k] = (acc[k] ?? 0) + (row[k] ?? 0);
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
  const { data } = await db
    .from("campaign_groups")
    .select("id, slug, display_name, status, owner, geography, sort_order")
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

/** Campaign ids owned by a rep, for scoping a drill-down. */
export async function campaignIdsForRep(rep) {
  const { data: gs } = await db.from("campaign_groups").select("id").eq("owner", rep);
  if (!gs?.length) return { label: null, ids: [] };
  const { data: m } = await db
    .from("campaign_group_members")
    .select("campaign_id")
    .in("group_id", gs.map((g) => g.id));
  return { label: rep, ids: (m ?? []).map((r) => r.campaign_id) };
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
  bounced:           { label: "Emails bounced", table: "activities", event: "bounced",
                       altTable: "people", altFilter: { bounced: true },
                       note: "Rejected by the receiving server — these addresses never reached a human." },
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
