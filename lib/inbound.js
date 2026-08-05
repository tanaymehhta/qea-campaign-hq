import { db } from "./db";

/**
 * The inbound research pipeline, read-only.
 *
 * Three stages, each a separate LangGraph writing its own `inbound_graph_runs` row.
 * Rows belonging to one end-to-end execution share a `pipeline_id`; the stages of a
 * company researched over several sessions do not, so a company's history is read by
 * company_id and grouped by stage rather than by pipeline.
 */

export const STAGES = [
  { no: 1, graph: "research", label: "Research the company",
    blurb: "ICP gate, buildings, compliance, intent signals" },
  { no: 2, graph: "people", label: "Find people + emails",
    blurb: "Apollo sweep, persona gate, verified emails" },
  { no: 3, graph: "outreach", label: "Write + send",
    blurb: "Assemble from the copy tables, validate, push" },
];

/** A stage's row for a company: the most recent run of that graph. */
export function latestByStage(runs) {
  const out = new Map();
  for (const r of runs ?? []) {
    const no = r.stage_no ?? STAGES.find((s) => s.graph === r.graph_name)?.no;
    if (!no) continue;
    if (!out.has(no)) out.set(no, r); // runs arrive newest-first
  }
  return out;
}

/**
 * Errors a node recorded, from either place they can hide.
 *
 * `error` is the node's own column. `output_summary.errors` is where a tool that
 * caught its own failure puts them — Apollo running out of credits returns 422s
 * that land there while the node still reports ok. Barings looked like 32 clean
 * nodes on this dashboard while stage 2 revealed nothing.
 */
export function nodeErrors(n) {
  const out = [];
  if (n.error) out.push(String(n.error));
  const s = n.output_summary;
  if (s && typeof s === "object" && Array.isArray(s.errors)) {
    for (const e of s.errors) out.push(typeof e === "string" ? e : JSON.stringify(e));
  }
  if (s && typeof s === "object" && s.write_failed) out.push("wrote 0 rows");
  return out;
}

/**
 * A node "failed" when it recorded an error, even if its status says ok.
 * That combination is the one that used to read as a clean run while writing
 * nothing, so it gets its own state rather than being folded into ok.
 */
export function nodeState(n) {
  const errs = nodeErrors(n);
  if (errs.length) return n.status === "error" ? "error" : "degraded";
  if (n.status === "started") return "running";
  return n.status === "ok" ? "ok" : n.status || "unknown";
}

/** The numbers worth reading off a node, in the order you'd scan them. */
export function nodeFacts(n, limit = 4) {
  const s = n.output_summary;
  if (!s || typeof s !== "object") return [];
  const out = [];
  for (const [k, v] of Object.entries(s)) {
    if (k === "error" || v == null || v === "" ) continue;
    if (typeof v === "number" || typeof v === "boolean") out.push([k, String(v)]);
    else if (typeof v === "string" && v.length <= 28) out.push([k, v]);
    if (out.length >= limit) break;
  }
  return out;
}

export async function inboundOverview() {
  const [{ data: companies }, { data: events }, { data: runs }] = await Promise.all([
    db.from("inbound_companies")
      .select("id,name,domain,vertical,account_type,research_status,last_visited_at,created_at,needs_human_review")
      .order("last_visited_at", { ascending: false, nullsFirst: false })
      .limit(100),
    db.from("inbound_webhook_events")
      .select("id,received_at,source,parse_status,company_id,person_id,error,raw")
      .order("received_at", { ascending: false })
      .limit(40),
    db.from("inbound_graph_runs")
      .select("id,company_id,graph_name,stage_no,status,started_at,finished_at,total_cost_usd,error,excel_path,pipeline_id")
      .order("started_at", { ascending: false })
      .limit(300),
  ]);

  const runsByCompany = new Map();
  for (const r of runs ?? []) {
    if (!r.company_id) continue;
    if (!runsByCompany.has(r.company_id)) runsByCompany.set(r.company_id, []);
    runsByCompany.get(r.company_id).push(r);
  }
  return { companies: companies ?? [], events: events ?? [], runs: runs ?? [], runsByCompany };
}

export async function companyDetail(companyId) {
  const [{ data: company }, { data: runs }, { data: people }, { data: buildings },
         { data: signals }, { data: hits }, { data: emails }, { data: visits }] =
    await Promise.all([
      db.from("inbound_companies").select("*").eq("id", companyId).maybeSingle(),
      db.from("inbound_graph_runs").select("*").eq("company_id", companyId)
        .order("started_at", { ascending: false }),
      db.from("inbound_people").select("*").eq("company_id", companyId)
        .order("priority", { ascending: true }),
      db.from("inbound_buildings").select("*").eq("company_id", companyId),
      db.from("inbound_intent_signals").select("*").eq("company_id", companyId),
      db.from("inbound_compliance_hits").select("*").eq("company_id", companyId),
      db.from("inbound_emails").select("*").eq("company_id", companyId),
      db.from("inbound_visits").select("*").eq("company_id", companyId)
        .order("seen_at", { ascending: false }),
    ]);

  const ids = (runs ?? []).map((r) => r.id);
  let nodes = [];
  if (ids.length) {
    const { data } = await db.from("inbound_graph_node_events")
      .select("*").in("run_id", ids).order("sequence");
    nodes = data ?? [];
  }
  const nodesByRun = new Map();
  for (const n of nodes) {
    if (!nodesByRun.has(n.run_id)) nodesByRun.set(n.run_id, []);
    nodesByRun.get(n.run_id).push(n);
  }

  return {
    company, runs: runs ?? [], nodesByRun,
    people: people ?? [], buildings: buildings ?? [], signals: signals ?? [],
    hits: hits ?? [], emails: emails ?? [], visits: visits ?? [],
  };
}

export const money = (v) =>
  v == null ? "—" : `$${Number(v) < 0.01 ? Number(v).toFixed(4) : Number(v).toFixed(2)}`;

export const secs = (ms) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)}s`);
