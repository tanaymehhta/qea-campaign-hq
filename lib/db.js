import { createClient } from "@supabase/supabase-js";

// The anon key is a public, read-only credential: every table is behind RLS with
// a select-only policy, and all writes go through the service role, which lives
// only inside the Supabase edge function. Safe to ship in a public bundle.
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://yfnqszwlyoyfhuwfmcyl.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmbnFzendseW95Zmh1d2ZtY3lsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyNDUzODQsImV4cCI6MjEwMDgyMTM4NH0.alMDnxA7VQff3A0veYqwu2sdzW7BRvTdHFjP7f4TO-A";

export const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
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
 * Defaults to today. `range` accepts today | 7 | 30 | 90 | all.
 */
export function windowFrom(searchParams = {}) {
  const t = today();
  const range = searchParams.range;
  if (searchParams.d) return { from: searchParams.d, to: searchParams.d, label: "day", range: "day" };
  if (range === "all") return { from: "2020-01-01", to: t, label: "All time", range: "all" };
  if (range === "7") return { from: shift(t, -6), to: t, label: "Last 7 days", range: "7" };
  if (range === "30") return { from: shift(t, -29), to: t, label: "Last 30 days", range: "30" };
  if (range === "90") return { from: shift(t, -89), to: t, label: "Last 90 days", range: "90" };
  return { from: t, to: t, label: "Today", range: "today" };
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
