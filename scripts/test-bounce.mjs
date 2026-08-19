/**
 * The Overview's bounce number, checked against the raw tables it is built from.
 *
 * Instantly reports bounce per mailbox per day and never per campaign-day, so
 * app/page.jsx infers the placement through campaigns.sender_emails -> group.
 * That inference is the thing worth a check: it is arithmetic over two tables
 * that no view enforces, and it is wrong silently rather than loudly.
 *
 * Recomputes the expected figure straight from daily_metrics and
 * email_account_daily — never from v_daily_facts, so a fault in the view cannot
 * agree with itself — and asserts the rendered tile matches, for every rep and
 * every range the picker offers.
 *
 *   node scripts/test-bounce.mjs [baseUrl]      default http://localhost:3000
 */
import assert from "node:assert";

const BASE = process.argv[2] ?? "http://localhost:3000";
const U = "https://yfnqszwlyoyfhuwfmcyl.supabase.co/rest/v1";
const K = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmbnFzendseW95Zmh1d2ZtY3lsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyNDUzODQsImV4cCI6MjEwMDgyMTM4NH0.alMDnxA7VQff3A0veYqwu2sdzW7BRvTdHFjP7f4TO-A";
const h = { apikey: K };
const q = async (p) => (await fetch(U + p, { headers: h })).json();
const paged = async (p) => {
  const out = [];
  for (let f = 0; ; f += 1000) {
    const r = await q(`${p}&offset=${f}&limit=1000`);
    out.push(...r);
    if (r.length < 1000) return out;
  }
};
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const shift = (i, n) => { const d = new Date(`${i}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const [camps, mem, grps, dm, ead] = await Promise.all([
  q("/campaigns?select=id,source,sender_emails"),
  q("/campaign_group_members?select=campaign_id,group_id"),
  q("/campaign_groups?select=id,display_name,owner"),
  paged("/daily_metrics?select=campaign_id,metric_date,sent,bounced"),
  paged("/email_account_daily?select=email,source,metric_date,bounced"),
]);
const cById = new Map(camps.map((c) => [c.id, c]));
const groupOf = new Map(mem.map((m) => [m.campaign_id, m.group_id]));

// mailbox -> group, refusing any box that reaches two (the same rule the page applies)
const box = new Map();
for (const c of camps) {
  if (c.source !== "instantly") continue;
  const gid = groupOf.get(c.id) ?? null;
  for (const e of c.sender_emails ?? []) {
    if (!box.has(e)) box.set(e, gid);
    else if (box.get(e) !== gid) box.set(e, null);
  }
}

const owners = new Map();
for (const g of grps) { const o = g.owner?.trim(); if (!o) continue; if (!owners.has(o)) owners.set(o, new Set()); owners.get(o).add(g.id); }

const t = today();
const RANGES = { today: [t, t], 7: [shift(t, -6), t], 30: [shift(t, -29), t], 90: [shift(t, -89), t], all: ["2020-01-01", t] };

function expected(scope, [from, to]) {
  const ok = (gid) => !scope || (gid && scope.has(gid));
  let sent = 0, bounced = 0;
  const instDays = new Set();
  for (const r of dm) {
    if (r.metric_date < from || r.metric_date > to) continue;
    const c = cById.get(r.campaign_id); if (!c) continue;
    const gid = groupOf.get(r.campaign_id); if (!ok(gid)) continue;
    sent += r.sent ?? 0;
    if (c.source === "instantly") { if (r.sent) instDays.add(r.metric_date); }
    else bounced += r.bounced ?? 0;
  }
  const mbDates = new Set();
  for (const r of ead) {
    if (r.source !== "instantly" || r.metric_date < from || r.metric_date > to) continue;
    mbDates.add(r.metric_date);
    const gid = box.get(r.email) ?? null;
    if (r.bounced == null) continue;
    if (ok(gid)) bounced += r.bounced;
    else if (!scope && !gid) bounced += r.bounced; // unplaceable: company total only
  }
  const covered = [...instDays].filter((d) => mbDates.has(d));
  const unknown = instDays.size > 0 && covered.length === 0;
  return { sent, bounced: unknown ? null : bounced };
}

// The tile prints its raw value into data-count; "—" prints no data-count at all.
function rendered(html, label) {
  const i = html.indexOf(`>${label}<`);
  assert.ok(i > 0, `tile "${label}" not on the page`);
  const m = html.slice(i, i + 400).match(/class="val[^"]*"(?: data-count="(\d+)")?[^>]*>([^<]*)</);
  assert.ok(m, `could not read the "${label}" tile`);
  return m[1] === undefined ? null : Number(m[1]);
}

let checked = 0, bad = 0;
for (const [rep, scope] of [["all", null], ...owners]) {
  for (const [rk, win] of Object.entries(RANGES)) {
    const qs = new URLSearchParams({ range: rk });
    if (rep !== "all") qs.set("rep", rep);
    const html = await (await fetch(`${BASE}/?${qs}`)).text();
    const exp = expected(scope, win);
    const gotB = rendered(html, "Emails bounced");
    const gotS = rendered(html, "Emails sent");
    const line = `${rep} / ${rk}`.padEnd(24);
    if (gotB !== exp.bounced || gotS !== exp.sent) {
      bad++;
      console.log(`FAIL ${line} sent ${gotS} (want ${exp.sent})  bounced ${gotB} (want ${exp.bounced})`);
    } else {
      console.log(`ok   ${line} sent ${String(gotS).padStart(5)}  bounced ${String(gotB).padStart(4)}`);
    }
    checked++;
  }
}

// Every rep's slice must add up to the company figure, at every range. This is
// what "company-wide, not per rep" used to cost: a total nobody could partition.
for (const [rk, win] of Object.entries(RANGES)) {
  const whole = expected(null, win);
  const parts = [...owners.values()].reduce((a, s) => a + (expected(s, win).bounced ?? 0), 0);
  assert.strictEqual(parts, whole.bounced ?? 0, `${rk}: reps sum to ${parts}, company is ${whole.bounced}`);
}
console.log(`\n${checked} combinations checked, ${bad} wrong. Rep slices partition the company total at every range.`);
process.exit(bad ? 1 : 0);
