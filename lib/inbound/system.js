import { db } from "../db.js";
import { nodeErrors } from "../pipeline.js";
import { errorReason } from "./words.js";
import { loadQueue, timeline, DOTS, tally, everyRow } from "./queue.js";

/**
 * The whole system, end to end, in one page of numbers.
 *
 * The queue answers "what do I work this morning". This answers the question
 * behind it — of everything that has ever arrived, how much came out the other
 * end, and where the rest of it stopped. Those are different questions and the
 * queue was the wrong shape for the second: it filters to a rep and a window by
 * design, and this one deliberately never filters at all.
 *
 * It is built on `loadQueue` rather than beside it. Every company-level figure
 * here — the 87 in the queue, the people found, the drafts, the spend — is the
 * queue's own array counted a second way, so the two pages cannot drift apart.
 * Only the three things the queue never loads are fetched again: why a webhook
 * was dropped, which stage each run belongs to, and what the nodes recorded.
 */

/** The webhook's own error, in the words a person would use for it. */
const DROP_REASONS = [
  [/no company name or domain/i, "RB2B could not identify the visitor's company"],
  [/vendor|test payload/i, "a test post from RB2B itself"],
  [/duplicate key/i, "the company was already on file under that domain"],
];
export const dropReason = (text) =>
  DROP_REASONS.find(([re]) => re.test(text ?? ""))?.[1] ?? (text || "no reason recorded");

/**
 * Every stage of every company, counted by what actually happened to it.
 *
 * Per company the states come from `timeline` — the same function, with the
 * same arguments, that draws the four dots on that company's own page. A number
 * here and the dots there are therefore the same claim, which is the entire
 * point: a summary that computes its own version of "did research work" is a
 * second opinion nobody asked for and the first thing to go stale.
 */
function stages(leads, runsByCompany, nodesByRun) {
  return DOTS.filter((d) => d.stage > 0).map(({ stage, label, work }) => {
    const row = { stage, label, work, ok: 0, bad: 0, none: 0, todo: 0, retried: 0 };
    for (const lead of leads) {
      const runs = runsByCompany.get(lead.id) ?? [];
      const dot = timeline(
        lead.company?.first_seen_at ?? lead.lastVisit?.seen_at ?? null,
        runs, nodesByRun,
        { 2: lead.contacts.length, 3: lead.draftCount },
      )[stage];
      row[dot.state] += 1;
      if (dot.attempts > 1) row.retried += 1;
    }
    return row;
  });
}

export async function loadSystem() {
  const queue = await loadQueue();

  const [webhooks, runs, nodes] = await Promise.all([
    db.from("inbound_webhook_events").select("parse_status,error,received_at")
      .then((r) => r.data ?? []),
    // Newest first: `latestByStage`, which `timeline` calls, takes the first row
    // it sees for a stage and trusts the order to have put the latest there.
    db.from("inbound_graph_runs")
      .select("id,company_id,graph_name,stage_no,status,started_at,finished_at,total_cost_usd,apollo_credits,error")
      .order("started_at", { ascending: false }).then((r) => r.data ?? []),
    // 4,687 rows against a 1,000-row ceiling, so paged. `output_summary` is
    // narrowed to the two keys `nodeErrors` reads: the whole column is 570KB per
    // thousand rows and 167KB per thousand this way, which is the difference
    // between a page that loads and one nobody opens twice.
    everyRow(() => db.from("inbound_graph_node_events")
      .select("run_id,node_name,status,error,errors:output_summary->errors,write_failed:output_summary->write_failed")
      .order("run_id", { ascending: true })),
  ]);

  const runsByCompany = new Map();
  for (const r of runs) {
    if (!r.company_id) continue;
    if (!runsByCompany.has(r.company_id)) runsByCompany.set(r.company_id, []);
    runsByCompany.get(r.company_id).push(r);
  }
  const nodesByRun = new Map();
  for (const n of nodes) {
    // `nodeErrors` reads `output_summary.errors` and `.write_failed`; the select
    // above aliased those two out of the column, so put the shape back.
    const node = { ...n, output_summary: { errors: n.errors, write_failed: n.write_failed } };
    if (!nodesByRun.has(n.run_id)) nodesByRun.set(n.run_id, []);
    nodesByRun.get(n.run_id).push(node);
  }

  // What actually stopped the pipeline, commonest first. Grouped by the plain
  // sentence rather than the raw text: 46 Apollo 422s differ in their HTML and
  // are one problem, and listing them as 46 distinct strings hides that.
  const blockers = new Map();
  for (const list of nodesByRun.values()) {
    for (const n of list) {
      for (const raw of nodeErrors(n)) {
        const key = errorReason(raw);
        const at = blockers.get(key) ?? { reason: key, n: 0, nodes: new Set(), sample: raw };
        at.n += 1;
        at.nodes.add(n.node_name);
        blockers.set(key, at);
      }
    }
  }

  const drops = new Map();
  for (const w of webhooks) {
    if (w.parse_status !== "failed") continue;
    const key = dropReason(w.error);
    drops.set(key, (drops.get(key) ?? 0) + 1);
  }

  const stats = tally(queue.companies);
  const inQueue = new Set(queue.companies.map((l) => l.id));
  return {
    stats,
    // The funnel, in the order it happens. Each step's total is the step above
    // it, so a reader can check the page against itself.
    traffic: {
      posts: webhooks.length,
      parsed: webhooks.filter((w) => w.parse_status !== "failed").length,
      dropped: webhooks.filter((w) => w.parse_status === "failed").length,
      first: webhooks.reduce((t, w) => (!t || w.received_at < t ? w.received_at : t), null),
      last: webhooks.reduce((t, w) => (!t || w.received_at > t ? w.received_at : t), null),
      drops: [...drops.entries()].sort((a, b) => b[1] - a[1]),
    },
    companies: {
      inQueue: queue.companies.length,
      excluded: queue.excluded,
      withPeople: queue.companies.filter((l) => l.contacts.length).length,
      withDrafts: queue.companies.filter((l) => l.draftCount).length,
    },
    stages: stages(queue.companies, runsByCompany, nodesByRun),
    // Scoped to the companies this page is about, and only then compared to
    // everything. Dividing the all-runs total by the in-queue company count gave
    // a cost per company that was 15% too high: 538 runs cover 94 companies —
    // six of them excluded from the queue, and one run carries no company at all
    // — while the count underneath it was the 90 on this page. `stats.spent` and
    // `stats.credits` are already the queue's own totals, counted by `tally`
    // from the same rows, so the funnel and this section cannot disagree.
    runs: {
      total: runs.filter((r) => inQueue.has(r.company_id)).length,
      spent: stats.spent,
      credits: stats.credits,
      // Money that is real but belongs to companies this page leaves out.
      elsewhere: {
        runs: runs.length - runs.filter((r) => inQueue.has(r.company_id)).length,
        spent: runs.reduce((t, r) => t + Number(r.total_cost_usd ?? 0), 0) - stats.spent,
        companies: new Set(runs.map((r) => r.company_id).filter((id) => id && !inQueue.has(id))).size,
      },
    },
    blockers: [...blockers.values()]
      .map((b) => ({ ...b, nodes: [...b.nodes].sort() }))
      .sort((a, b) => b.n - a.n),
  };
}
