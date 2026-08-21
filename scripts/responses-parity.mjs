#!/usr/bin/env node
/**
 * Every Responses number on the dashboard, against the pile behind its own click.
 *
 * The sibling of scripts/meetings-parity.mjs, for the other half of the funnel
 * and the fault that ran alongside it: the Overview tile read 33 and the table
 * under it totalled 41, /meetings said 41, /campaigns said 41. All of them were
 * `campaign_totals.replied` — the vendor's own reply counter, message-grain and
 * filtered by the vendor's idea of a robot — printed under the same word as
 * `response_counts`, which counts people who wrote an answer.
 *
 * Four invariants:
 *
 *   1 · PARTITION    per-group totals sum to the all-groups total, and per-rep
 *                    totals sum to the all-reps total, in every window. This is
 *                    the one that can genuinely break: `response_people` counts
 *                    a person once, so somebody answering inside two groups is
 *                    one row in the total and one row in each of two columns.
 *   2 · TILE=CLICK   response_counts equals the number of people
 *                    response_people returns over identical arguments. A tile
 *                    cannot print a number its own drill-down does not open.
 *   3 · PARTS SUM    responded = interested + (responded − interested), and
 *                    people = responded + needs_label + robot_only. The tile
 *                    prints its own breakdown; the parts have to be a partition.
 *   4 · NO VENDOR    no page reads `.replied` off a summary view. This is the
 *                    rule the database cannot check for itself, and it is the
 *                    one that was broken: the definition was right in Postgres
 *                    the whole time and six pages went around it.
 *
 * Read-only. Safe against production, which is the point — it asks the same
 * questions the pages ask, through the same anon key.
 *
 *   node scripts/responses-parity.mjs
 *
 * Exit 0 = everything agrees. Exit 1 = something does not, and it says what,
 * with both numbers.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://yfnqszwlyoyfhuwfmcyl.supabase.co";
const KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmbnFzendseW95Zmh1d2ZtY3lsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyNDUzODQsImV4cCI6MjEwMDgyMTM4NH0.alMDnxA7VQff3A0veYqwu2sdzW7BRvTdHFjP7f4TO-A";

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function rest(path) {
  const r = await fetch(`${URL}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`);
  return r.json();
}
async function rpc(fn, body, qs = "") {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}${qs}`, {
    method: "POST", headers: H, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${fn} → ${r.status} ${await r.text()}`);
  return r.json();
}

const args = (from, to, campaigns) => ({
  p_from: from, p_to: to, p_campaigns: campaigns ?? null, p_source: null,
});

let checks = 0;
const failures = [];
const assert = (ok, what, got, want) => {
  checks++;
  if (!ok) failures.push({ what, got, want });
};

// The same five the range picker offers. `windowFrom` in lib/db.js turns these
// into the same pair of dates; all-time asks for nothing rather than for a date
// that happens to predate the data.
function windows() {
  const t = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const back = (n) => {
    const d = new Date(`${t}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };
  return [
    { label: "all time", from: null, to: null },
    { label: "today", from: t, to: t },
    { label: "7 days", from: back(6), to: t },
    { label: "30 days", from: back(29), to: t },
    { label: "90 days", from: back(89), to: t },
  ];
}

const run = async () => {
  const [groups, subs] = await Promise.all([
    rest("campaign_groups?select=id,slug,display_name,owner&order=slug"),
    rest("v_campaign_summary?select=campaign_id,group_id"),
  ]);
  const campaignsOf = (gid) => subs.filter((s) => s.group_id === gid).map((s) => s.campaign_id);
  const grouped = [...new Set(subs.filter((s) => s.group_id).map((s) => s.campaign_id))];
  const reps = [...new Set(groups.map((g) => g.owner).filter(Boolean))];
  const campaignsOfRep = (owner) =>
    groups.filter((g) => g.owner === owner).flatMap((g) => campaignsOf(g.id));

  for (const w of windows()) {
    // ---- 1 · PARTITION, by group -----------------------------------------
    // Both sides over grouped campaigns only: an ungrouped campaign is
    // v_invariants' `response_belongs_to_no_group`, not this rule's business.
    const whole = (await rpc("response_counts", args(w.from, w.to, grouped)))[0];
    let sum = 0;
    for (const g of groups) {
      const c = (await rpc("response_counts", args(w.from, w.to, campaignsOf(g.id))))[0];
      sum += c.responded;

      // ---- 2 · TILE=CLICK ------------------------------------------------
      const people = await rpc(
        "response_people", args(w.from, w.to, campaignsOf(g.id)),
        "?responded=eq.true&select=lead_email"
      );
      assert(c.responded === people.length,
        `tile=click · ${w.label} · /campaigns/${g.slug}`, c.responded, people.length);

      // ---- 3 · PARTS SUM -------------------------------------------------
      assert(c.people === c.responded + c.needs_label + c.robot_only,
        `parts sum · ${w.label} · ${g.slug}`,
        c.people, c.responded + c.needs_label + c.robot_only);
      assert(c.interested <= c.responded,
        `interested inside responded · ${w.label} · ${g.slug}`, c.interested, c.responded);
    }
    assert(sum === whole.responded,
      `partition by group · ${w.label}`, sum, whole.responded);

    // ---- 1b · PARTITION, by rep -------------------------------------------
    // A rep owns groups, so their campaigns are their groups' campaigns — the
    // same resolution campaignIdsForRep makes. /meetings scopes its tile this
    // way, and the rep strip has to sum to the all-reps number the same way
    // the group columns sum to the Total.
    let repSum = 0;
    for (const r of reps) {
      const c = (await rpc("response_counts", args(w.from, w.to, campaignsOfRep(r))))[0];
      repSum += c.responded;
    }
    assert(repSum === whole.responded,
      `partition by rep · ${w.label}`, repSum, whole.responded);
  }

  // ---- 4 · NO VENDOR -------------------------------------------------------
  // Two reads survive on purpose and are named here rather than left to a
  // reviewer's memory:
  //
  //   c/[id] step stats     `step_metrics.replied`, the only reply number that
  //                         exists per step. Our labels attach to a message,
  //                         not to the email that provoked it. Rendered with
  //                         the word "vendor" beside it.
  //   person/[email]        `people.replied_count`, per person and per
  //                         campaign — a different question, not a second
  //                         answer to this one.
  const ALLOWED = new Set(["app/c/[id]/page.jsx", "app/person/[email]/page.jsx"]);
  const walk = (dir) =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) return f === "node_modules" ? [] : walk(p);
      return /\.(jsx?|tsx?)$/.test(f) ? [p] : [];
    });
  for (const file of [...walk("app"), ...walk("components")]) {
    if (ALLOWED.has(file)) continue;
    const offending = readFileSync(file, "utf8")
      .split("\n")
      .map((line, i) => [i + 1, line])
      // Comments are how the old readings are explained; only live code counts.
      .filter(([, l]) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .filter(([, l]) => /\.replied\b/.test(l) && !/replied_count/.test(l));
    for (const [n, l] of offending) {
      assert(false, `no vendor · ${file}:${n}`, l.trim().slice(0, 70), "response_counts");
    }
    checks++;
  }

  if (!failures.length) {
    console.log(`PASS — ${checks} checks. One definition of a response, on every page.`);
    process.exit(0);
  }
  console.log(`FAIL — ${failures.length} of ${checks} checks disagree:\n`);
  for (const f of failures) console.log(`  ${f.what}\n    reads ${f.got}, should read ${f.want}`);
  process.exit(1);
};

run().catch((e) => { console.error("could not run:", e.message); process.exit(2); });
