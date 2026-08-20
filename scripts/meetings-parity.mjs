#!/usr/bin/env node
/**
 * Every meetings number on the dashboard, against the pile behind its own click.
 *
 * This is §7 of the handoff made executable. The faults it was written for were
 * all found by hand the same way: read a tile, follow that tile's own href,
 * count the rows, notice they differ. Doing that by hand finds one; doing it
 * across every scope and every window finds the class.
 *
 * Three invariants, checked over every scope the interface can produce:
 *
 *   1 · PARTITION   per-rep totals sum to the all-reps total, exactly.
 *                   This is the one the 20 Aug rep strip failed: 7 + 0 + 1
 *                   against a total of 9.
 *   2 · TILE=CLICK  meeting_counts equals the length of meeting_rows over the
 *                   identical arguments. A tile cannot print a number its own
 *                   drill-down does not open.
 *   3 · AGREEMENT   v_group_summary.meetings equals meeting_rows for that
 *                   group. The summary is a hand-written subquery for speed;
 *                   this is what stops it drifting from the definition.
 *
 * Read-only. Safe to run against production, which is the point — it asks the
 * same questions the pages ask, through the same anon key.
 *
 *   node scripts/meetings-parity.mjs
 *
 * Exit 0 = every scope agrees. Exit 1 = at least one does not, and it says
 * which, with both numbers.
 */

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
async function rpc(fn, args) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: H, body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`${fn} → ${r.status} ${await r.text()}`);
  return r.json();
}

/** The same five-plus-one the pages send. */
const args = (o = {}) => ({
  p_from: o.from ?? null,
  p_to: o.to ?? null,
  p_campaigns: o.campaigns?.length ? o.campaigns : null,
  p_groups: o.groups?.length ? o.groups : null,
  p_rep: o.rep && o.rep !== "all" ? o.rep : null,
  p_status: o.status ?? "counted",
});

// The dashboard's timezone, not the runner's — the same rule as lib/db.js.
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const shift = (iso, d) => {
  const t = new Date(`${iso}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
};

const t = today();
const WINDOWS = [
  { label: "all time", from: null, to: null },
  { label: "today", from: t, to: t },
  { label: "last 7", from: shift(t, -6), to: t },
  { label: "last 30", from: shift(t, -29), to: t },
  { label: "last 90", from: shift(t, -89), to: t },
];

let checks = 0;
const failures = [];
function assert(ok, what, got, want) {
  checks++;
  if (!ok) failures.push({ what, got, want });
}

const run = async () => {
  const [groups, members] = await Promise.all([
    rest("campaign_groups?select=id,slug,display_name,owner&order=sort_order"),
    rest("campaign_group_members?select=campaign_id,group_id"),
  ]);
  const summary = await rest("v_group_summary?select=slug,id,meetings");
  const reps = [...new Set(groups.map((g) => g.owner?.trim()).filter(Boolean))];
  const campaignsOf = (gid) =>
    members.filter((m) => m.group_id === gid).map((m) => m.campaign_id);

  console.log(`meetings parity · ${reps.length} reps · ${groups.length} groups · ` +
              `${members.length} sub-campaigns · ${WINDOWS.length} windows\n`);

  for (const w of WINDOWS) {
    // ---- 1 · PARTITION -------------------------------------------------
    const total = (await rpc("meeting_counts", args(w)))[0].meetings;
    let summed = 0;
    for (const rep of reps) {
      summed += (await rpc("meeting_counts", args({ ...w, rep })))[0].meetings;
    }
    assert(summed === total, `partition · ${w.label} · reps sum to all-reps`, summed, total);

    // ---- 2 · TILE = CLICK ----------------------------------------------
    const scopes = [
      { name: "all reps", a: args(w) },
      ...reps.map((rep) => ({ name: `rep ${rep}`, a: args({ ...w, rep }) })),
      ...groups.map((g) => ({
        name: `group ${g.slug}`,
        a: args({ ...w, groups: [g.id], campaigns: campaignsOf(g.id) }),
      })),
      ...members.map((m) => ({
        name: `sub-campaign ${m.campaign_id.slice(0, 8)}`,
        a: args({ ...w, campaigns: [m.campaign_id] }),
      })),
    ];
    for (const s of scopes) {
      const [count, rows] = await Promise.all([
        rpc("meeting_counts", s.a),
        rpc("meeting_rows", s.a),
      ]);
      assert(count[0].meetings === rows.length,
        `tile=click · ${w.label} · ${s.name}`, count[0].meetings, rows.length);
    }
  }

  // ---- 3 · AGREEMENT ---------------------------------------------------
  // All time only: the summary view carries no date window, so windowing it
  // would be comparing two different questions.
  for (const g of groups) {
    const rows = await rpc("meeting_rows",
      args({ groups: [g.id], campaigns: campaignsOf(g.id) }));
    const view = Number(summary.find((s) => s.id === g.id)?.meetings ?? -1);
    assert(view === rows.length, `agreement · v_group_summary ${g.slug}`, view, rows.length);
  }

  // ---- report ----------------------------------------------------------
  if (!failures.length) {
    console.log(`PASS — ${checks} checks, every scope agrees with its own click.`);
    process.exit(0);
  }
  console.log(`FAIL — ${failures.length} of ${checks} checks disagree:\n`);
  for (const f of failures) console.log(`  ${f.what}\n    reads ${f.got}, should read ${f.want}`);
  process.exit(1);
};

run().catch((e) => { console.error("could not run:", e.message); process.exit(2); });
